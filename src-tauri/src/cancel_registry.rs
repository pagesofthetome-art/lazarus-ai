//! A registry of caller-keyed `CancellationToken`s, shared by every proxy
//! command that lets the JS side cancel an in-flight Rust request by an id it
//! minted itself (`proxy_localhost`/`cancel_proxy_call` and
//! `proxy_localhost_stream_chunked`/`cancel_proxy_stream`). One
//! implementation instead of two, so the startup-window race below is fixed
//! once for both instead of needing to be remembered twice (review
//! 2026-09-18, R3 Nachbesserung 1: "gleiche Luecke, eine gemeinsame Loesung,
//! kein Doppelbau").
//!
//! ## The race this closes
//!
//! The JS side mints an id, attaches an `AbortSignal` listener that calls the
//! cancel command, THEN calls `invoke(...)`. Between that `invoke` starting
//! and the Rust command actually reaching its registration line (after
//! `ProxyAllowList::snapshot`, `allow.check`, `guard_builtin_model`,
//! `proxy_client`, ...), a cancel can arrive for an id that is not in the map
//! yet. Before this module existed, that cancel found nothing, did nothing,
//! and the request that registered moments later ran to completion
//! regardless, the same class of bug R3 fixed for "Stop while the request is
//! already running", just shifted a few hundred microseconds earlier.
//!
//! The fix: a cancel for an unknown id leaves a *tombstone* (the instant it
//! arrived) instead of a no-op. `register` checks for one and, if found,
//! hands back an ALREADY-CANCELLED token, never the token from an older,
//! unrelated call, only ever the fresh one this exact `register` call just
//! created. Tombstones expire on their own (`TOMBSTONE_TTL`) so a cancel for
//! an id nobody ever registers (a bogus id, or a request that failed before
//! reaching registration) does not grow the map forever; the sweep runs
//! opportunistically inside every `register` call, so no background task is
//! needed for what is, in the worst case, a handful of bytes per stray id.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// How long a tombstone survives waiting for the `register` call it is
/// meant for. Generous relative to the real gap (registration follows
/// milliseconds after the JS `invoke`, never seconds), so it only ever
/// matters for ids that were never going to be registered at all.
const TOMBSTONE_TTL: Duration = Duration::from_secs(30);

/// Hard cap on total entries, the backstop the TTL sweep alone did not
/// provide (review 2026-09-18 Runde 2, "Rest, kein Blocker: keine
/// Obergrenze"): the sweep only ran inside `register`, so a caller that
/// fires `cancel(id)` for many ids that never register at all (a bogus or
/// adversarial webview script, or just a flood of stray ids) grew the map
/// for up to the whole `TOMBSTONE_TTL` window with no ceiling. 4096 is
/// generous for any real chat session (each real call registers and
/// unregisters within seconds, so the steady-state size is the number of
/// requests actually in flight, not the historical total) while still
/// bounding memory to a low number of megabytes even in the adversarial
/// case (a String key plus an `Instant` per entry).
const MAX_ENTRIES: usize = 4096;

#[derive(Clone)]
enum Entry {
    /// A live call is registered under this id; cancelling it fires this
    /// exact token.
    Active(CancellationToken),
    /// A cancel arrived before anything registered under this id, at the
    /// instant recorded here (for the TTL sweep).
    Tombstone(Instant),
}

/// Cheaply `Clone`able (an `Arc` underneath), so it can be stored directly as
/// an `AppState` field and captured into async blocks without an extra layer
/// of `Arc<Mutex<...>>` at the call site.
#[derive(Clone)]
pub struct CancelRegistry {
    entries: Arc<Mutex<HashMap<String, Entry>>>,
}

impl Default for CancelRegistry {
    fn default() -> Self {
        Self { entries: Arc::new(Mutex::new(HashMap::new())) }
    }
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Locks `entries`, healing past poisoning instead of panicking.
    ///
    /// F4 fix (review-w2rust.md): a panic while any lock holder ran would
    /// have poisoned the `std::sync::Mutex` and every later `register`/
    /// `cancel` call would then panic too, turning one bad moment into a
    /// permanently dead Stop button. Nothing under this lock can leave the
    /// map in a state worth refusing to read (`register`/`cancel` only ever
    /// do `HashMap` operations and `CancellationToken::cancel()`, see the
    /// module doc), so recovering the guard the same way the `Drop` impl
    /// already does (`if let Ok(...)`) is strictly safer than staying
    /// panicked.
    fn lock_entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Register a fresh token under `id`. The returned token is:
    ///  - already cancelled, if a `cancel(id)` arrived before this call (the
    ///    startup-window race this module exists for), the NEW token is the
    ///    one that gets cancelled, never a leftover from elsewhere;
    ///  - fresh and live otherwise.
    ///
    /// A stale `Active` entry already sitting under `id` (a previous call
    /// that registered but was never cleaned up, should not happen given
    /// the guard below, but a defensive case worth keeping, and the
    /// pre-existing behaviour this preserves) has ITS OLD token cancelled,
    /// same as before this module existed.
    ///
    /// Returns the token to race the request against, and a `Guard` whose
    /// `Drop` removes this registration, hold the guard for exactly the
    /// lifetime of the request, same shape as `CallTokenGuard` before this
    /// module, just shared instead of duplicated.
    pub fn register(&self, id: String) -> (CancellationToken, Guard) {
        let token = CancellationToken::new();
        let mut map = self.lock_entries();
        sweep_expired(&mut map);
        match map.insert(id.clone(), Entry::Active(token.clone())) {
            Some(Entry::Tombstone(_)) => token.cancel(),
            Some(Entry::Active(old)) => old.cancel(),
            None => {}
        }
        drop(map);
        (token, Guard { registry: self.clone(), id })
    }

    /// Cancel `id`. If it is registered, its token fires immediately. If it
    /// is not (yet) registered, a tombstone is left so the `register` call
    /// that follows starts already-cancelled instead of losing the cancel.
    ///
    /// This is also where the map can grow purely from tombstones (a real
    /// `Active` entry only ever comes from `register`, whose own growth is
    /// bounded by actual concurrent calls), so this is where both halves of
    /// the "Deckel plus Alterung" fix run: the same age-based sweep
    /// `register` already ran, plus the hard `MAX_ENTRIES` cap as a
    /// backstop for callers that never register at all.
    pub fn cancel(&self, id: &str) {
        let mut map = self.lock_entries();
        sweep_expired(&mut map);
        match map.get(id) {
            Some(Entry::Active(token)) => token.cancel(),
            _ => {
                evict_oldest_tombstones_to_fit(&mut map);
                map.insert(id.to_string(), Entry::Tombstone(Instant::now()));
            }
        }
    }

    /// Whether `id` currently has anything registered against it (active
    /// call or pending tombstone). Test-only: production code has no
    /// legitimate reason to ask this instead of just calling `cancel`.
    #[cfg(test)]
    fn contains(&self, id: &str) -> bool {
        self.entries.lock().unwrap().contains_key(id)
    }
}

/// Drop expired tombstones. Called opportunistically from `register` (every
/// call sweeps the WHOLE map, not just its own id) rather than from a
/// background task: the volume here is bounded by how many ids get cancelled
/// and never registered, which is rare by construction (a cancel almost
/// always follows a real `invoke` that is about to register), so a scheduled
/// sweep would be a thread for a problem that is a handful of bytes at
/// worst.
fn sweep_expired(map: &mut HashMap<String, Entry>) {
    let now = Instant::now();
    map.retain(|_, v| !matches!(v, Entry::Tombstone(at) if now.duration_since(*at) > TOMBSTONE_TTL));
}

/// Once eviction runs at all, it clears down to this fraction of the cap
/// instead of just the one slot the pending insert needs (F2 fix, review-
/// w2rust.md): a flood that holds the map AT the cap would otherwise pay
/// the full clone-and-sort cost of this function on every single further
/// `cancel`, under the same lock that every real `register`/`cancel` also
/// needs. Clearing a batch means the expensive path runs roughly once per
/// `(1 - LOW_WATERMARK_FRACTION) * MAX_ENTRIES` cancels instead of once per
/// cancel while at the cap, at the cost of evicting a few hundred more
/// (still only ever tombstones, still oldest-first) than the single slot
/// strictly needed.
const LOW_WATERMARK_FRACTION: usize = 90; // percent

/// Evict tombstones oldest-first until the map is back at or under the low
/// watermark (with room for the one entry `cancel` is about to insert).
/// Only `Tombstone`s are ever evicted here, never `Active` ones: an
/// in-flight call's own cancellation slot must never be dropped to make
/// room for someone else's stray cancel, and the number of genuinely
/// concurrent calls is bounded by how many requests a webview can have in
/// flight at once, not by anything this cap needs to police. Oldest-first
/// is what keeps the guarantee this module promises: under cap pressure,
/// the most recently arrived tombstone (the one still likely to be matched
/// by a `register` a few milliseconds behind it) survives, and only the
/// stalest, most-likely-abandoned ones are dropped first.
///
/// No-op (and therefore cheap) in the overwhelmingly common case where the
/// map is nowhere near the cap.
fn evict_oldest_tombstones_to_fit(map: &mut HashMap<String, Entry>) {
    if map.len() < MAX_ENTRIES {
        return;
    }
    let mut tombstones: Vec<(String, Instant)> = map
        .iter()
        .filter_map(|(k, v)| match v {
            Entry::Tombstone(at) => Some((k.clone(), *at)),
            Entry::Active(_) => None,
        })
        .collect();
    tombstones.sort_by_key(|(_, at)| *at);
    let low_watermark = MAX_ENTRIES * LOW_WATERMARK_FRACTION / 100;
    // +1 to make room for the entry `cancel` is about to insert; `max` so a
    // low watermark that somehow sits above the cap (a pathological
    // constant edit) still evicts at least the one slot actually needed.
    let over = (map.len() + 1).saturating_sub(low_watermark).max(map.len() + 1 - MAX_ENTRIES);
    for (key, _) in tombstones.into_iter().take(over) {
        map.remove(&key);
    }
}

/// Removes this registration from its registry on drop, the success path,
/// an early `?` return, the cancelled branch, and a panic unwinding through
/// the future all go through here, because `Drop::drop` is synchronous and
/// unconditional. Twin of the `CallTokenGuard` this replaces, generalised to
/// the streaming path too.
pub struct Guard {
    registry: CancelRegistry,
    id: String,
}

impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.registry.entries.lock() {
            // Only remove OUR entry. A `cancel(id)` that raced in after this
            // request already finished (the id got reused by a brand new,
            // unrelated call before this guard dropped, possible if the
            // caller reuses ids, which none of ours do, but nothing here
            // should assume that) may have written a fresh Tombstone or a
            // new Active entry for the SAME id; blindly removing would
            // erase that unrelated, newer information. There is no way to
            // tell "our" Active entry apart from a newer one by value alone
            // (tokens do not carry identity beyond `==` on the underlying
            // Arc, which `CancellationToken` does not expose), so this
            // accepts the same small imprecision the pre-module code had:
            // a same-id reuse race is already handled by `register`'s
            // "cancel the old token" branch, not by this guard.
            map.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── The startup-window race: cancel before register ─────────────────

    #[test]
    fn a_cancel_before_register_hands_back_an_already_cancelled_token() {
        let registry = CancelRegistry::new();
        registry.cancel("late-comer");
        let (token, _guard) = registry.register("late-comer".to_string());
        assert!(token.is_cancelled(), "the cancel that arrived first must not be lost");
    }

    #[test]
    fn the_tombstone_cancels_the_new_token_not_some_old_one() {
        // There never WAS an old token for this id: the only way this test
        // can pass is if `register` cancels the token it just created.
        let registry = CancelRegistry::new();
        registry.cancel("never-registered-before");
        let (token, _guard) = registry.register("never-registered-before".to_string());
        assert!(token.is_cancelled());
        // And the tombstone is consumed: a second, unrelated register under
        // a FRESH id is unaffected.
        let (fresh, _guard2) = registry.register("a-different-id".to_string());
        assert!(!fresh.is_cancelled());
    }

    #[test]
    fn a_cancel_after_register_still_works_as_before() {
        let registry = CancelRegistry::new();
        let (token, _guard) = registry.register("normal".to_string());
        assert!(!token.is_cancelled());
        registry.cancel("normal");
        assert!(token.is_cancelled());
    }

    #[test]
    fn registering_twice_under_the_same_id_cancels_the_old_one_not_the_new_one() {
        let registry = CancelRegistry::new();
        let (old_token, _old_guard) = registry.register("reused".to_string());
        let (new_token, _new_guard) = registry.register("reused".to_string());
        assert!(old_token.is_cancelled(), "the stale call under the reused id must be cancelled");
        assert!(!new_token.is_cancelled(), "the new call must start live");
    }

    #[test]
    fn cancelling_an_unknown_id_leaves_every_other_registration_untouched() {
        let registry = CancelRegistry::new();
        let (a, _ga) = registry.register("a".to_string());
        let (b, _gb) = registry.register("b".to_string());
        registry.cancel("does-not-exist");
        assert!(!a.is_cancelled());
        assert!(!b.is_cancelled());
    }

    // ── The registry wiring: cancel finds exactly its id (R3 Nachbesserung 2) ──

    /// Replaces the old `cancelling_one_call_does_not_touch_a_second_
    /// unrelated_call`, which built two Tokens by hand and never went
    /// through a registry at all, trivially true regardless of whether the
    /// lookup logic worked. This drives `register`/`cancel` exactly as the
    /// real commands do: two ids registered against the SAME registry, one
    /// cancelled by id, and the other proven to still be running.
    #[test]
    fn cancel_finds_exactly_its_own_call_and_leaves_a_second_registered_call_running() {
        let registry = CancelRegistry::new();
        let (call_a, _guard_a) = registry.register("call-a".to_string());
        let (call_b, _guard_b) = registry.register("call-b".to_string());

        registry.cancel("call-a");

        assert!(call_a.is_cancelled(), "cancel(\"call-a\") must reach call-a's token");
        assert!(!call_b.is_cancelled(), "cancel(\"call-a\") must not touch call-b");

        // And the reverse direction, so this is not just "the first
        // registered id always wins".
        registry.cancel("call-b");
        assert!(call_b.is_cancelled());
    }

    #[test]
    fn an_unknown_id_cancels_nothing_and_only_leaves_a_tombstone() {
        let registry = CancelRegistry::new();
        let (call_a, _guard_a) = registry.register("call-a".to_string());
        registry.cancel("totally-unrelated-id");
        assert!(!call_a.is_cancelled());
        assert!(registry.contains("totally-unrelated-id"), "the cancel must still be memoised as a tombstone");
    }

    // ── Guard cleanup ─────────────────────────────────────────────────────

    #[test]
    fn the_guard_removes_the_entry_on_drop() {
        let registry = CancelRegistry::new();
        {
            let (_token, _guard) = registry.register("temp".to_string());
            assert!(registry.contains("temp"));
        }
        assert!(!registry.contains("temp"), "the entry must be gone once the guard drops");
    }

    #[test]
    fn a_panic_while_the_guard_is_alive_still_clears_the_entry() {
        let registry = CancelRegistry::new();
        let registry_for_panic = registry.clone();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let (_token, _guard) = registry_for_panic.register("panicking".to_string());
            panic!("simulated failure mid-request");
        }));
        assert!(outcome.is_err());
        assert!(!registry.contains("panicking"));
    }

    /// F4 fix (review-w2rust.md): a panic while the lock is HELD (not the
    /// case above, where the guard was released cleanly by the time the
    /// panic happened) poisons a `std::sync::Mutex`. Before the fix,
    /// `register`/`cancel`'s `.lock().unwrap()` would then panic on every
    /// later call too, turning one bad moment into a permanently dead Stop
    /// button. This test poisons the lock directly, then proves both
    /// `register` and `cancel` keep working afterwards instead of
    /// panicking.
    #[test]
    fn a_poisoned_lock_heals_instead_of_wedging_every_later_call() {
        let registry = CancelRegistry::new();
        let for_poison = registry.clone();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = for_poison.entries.lock().unwrap();
            panic!("simulated panic while the lock is held");
        }));
        assert!(outcome.is_err(), "the setup itself must panic to poison the mutex");

        // Neither call must panic now that the mutex is poisoned.
        let (token, _guard) = registry.register("after-poison".to_string());
        assert!(!token.is_cancelled());
        registry.cancel("after-poison");
        assert!(token.is_cancelled(), "cancel must still reach the token after healing past poisoning");
    }

    // ── Tombstone TTL sweep (the "Aufraeumpfad") ─────────────────────────

    #[test]
    fn an_expired_tombstone_is_swept_and_no_longer_pre_cancels_a_later_register() {
        // Reach into a registry with an already-expired tombstone (as if
        // TOMBSTONE_TTL had elapsed) without waiting 30 real seconds in a
        // unit test: write it directly at the same key a real cancel would
        // use, backdated past the TTL.
        let registry = CancelRegistry::new();
        {
            let mut map = registry.entries.lock().unwrap();
            map.insert(
                "stale".to_string(),
                Entry::Tombstone(Instant::now() - TOMBSTONE_TTL - Duration::from_secs(1)),
            );
        }
        // The sweep runs inside register() for ANY id, not just "stale" --
        // register something unrelated first to prove the sweep is
        // registry-wide, then check "stale" was cleared.
        let (_other, _g) = registry.register("unrelated".to_string());
        assert!(!registry.contains("stale"), "an expired tombstone must not survive the next register() call");

        // And registering "stale" itself now starts live, not pre-cancelled.
        let (token, _g2) = registry.register("stale".to_string());
        assert!(!token.is_cancelled());
    }

    #[test]
    fn a_fresh_tombstone_survives_a_sweep_triggered_by_another_id() {
        let registry = CancelRegistry::new();
        registry.cancel("about-to-register");
        let (_other, _g) = registry.register("unrelated".to_string());
        assert!(registry.contains("about-to-register"), "a tombstone well within its TTL must survive");
        let (token, _g2) = registry.register("about-to-register".to_string());
        assert!(token.is_cancelled());
    }

    // ── MAX_ENTRIES cap (review 2026-09-18 Runde 2, "keine Obergrenze") ─────

    #[test]
    fn many_stray_cancels_never_grow_the_map_past_the_cap() {
        // Every one of these ids never registers, the exact shape the
        // original finding described: no upper bound existed because the
        // sweep only ran inside `register`.
        let registry = CancelRegistry::new();
        for i in 0..(MAX_ENTRIES * 2) {
            registry.cancel(&format!("stray-{i}"));
        }
        let len = registry.entries.lock().unwrap().len();
        assert!(len <= MAX_ENTRIES, "map grew to {len} entries, cap is {MAX_ENTRIES}");
    }

    /// F2 fix (review-w2rust.md): eviction at the cap clears a batch down to
    /// `LOW_WATERMARK_FRACTION`, not just the one slot the pending insert
    /// needs. Filling to exactly the cap and cancelling once more must drop
    /// the map noticeably below the cap, not merely to `MAX_ENTRIES - 1`,
    /// which is what the pre-fix, evict-one-per-call version would leave.
    #[test]
    fn eviction_at_the_cap_clears_a_batch_not_one_slot_at_a_time() {
        let registry = CancelRegistry::new();
        for i in 0..MAX_ENTRIES {
            registry.cancel(&format!("stray-{i}"));
        }
        assert_eq!(registry.entries.lock().unwrap().len(), MAX_ENTRIES);

        registry.cancel("one-more");
        let len = registry.entries.lock().unwrap().len();
        let low_watermark = MAX_ENTRIES * LOW_WATERMARK_FRACTION / 100;
        assert!(
            len <= low_watermark + 1,
            "one eviction at the cap must clear down to the low watermark \
             ({low_watermark} plus the new entry), got {len} -- an evict-one-\
             per-call regression would leave {}",
            MAX_ENTRIES,
        );
    }

    #[test]
    fn under_cap_pressure_the_most_recently_arrived_tombstone_survives() {
        // Fill exactly to the cap with older stray cancels, then one more.
        // The guarantee the module doc makes ("a late-arriving cancel for a
        // recently-ended run is still recognised") only holds if eviction
        // drops the STALEST entries, not an arbitrary one that might be the
        // newest.
        let registry = CancelRegistry::new();
        for i in 0..MAX_ENTRIES {
            registry.cancel(&format!("old-{i}"));
        }
        registry.cancel("newest");
        assert!(registry.contains("newest"), "the most recently arrived cancel must survive eviction");
        // And the id it registers under afterwards still starts pre-cancelled.
        let (token, _g) = registry.register("newest".to_string());
        assert!(token.is_cancelled());
    }

    #[test]
    fn a_live_active_call_survives_a_tombstone_flood_at_the_cap() {
        // The cap must only ever cost tombstones, never a real in-flight
        // call's own cancellation slot.
        let registry = CancelRegistry::new();
        let (token, _guard) = registry.register("live-call".to_string());
        for i in 0..(MAX_ENTRIES * 2) {
            registry.cancel(&format!("stray-{i}"));
        }
        assert!(registry.contains("live-call"), "a live Active entry must never be evicted");
        assert!(!token.is_cancelled(), "flooding stray cancels must not reach an unrelated live call");
    }
}
