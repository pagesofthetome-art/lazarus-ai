/**
 * The example path shown in the trainer's own install-target field.
 *
 * K5 Blocker 1 (Opus review of `4fda5a0a`): the old placeholder suggested
 * `~/Lazarus-Trainer` on Mac and Linux, and `install_character_trainer` on the
 * Rust side never resolves a leading `~` -- it goes straight into
 * `PathBuf::from`. A customer who typed exactly what the field offered ended
 * up with a folder literally named `~`, not one in their home directory.
 * Absolute examples only, one per platform family, mirrored on the Rust
 * side by `example_trainer_path` in `commands/trainer.rs` (kept in sync by
 * `k5-trainer-path-honesty.test.tsx`).
 */
export function trainerPathPlaceholder(onWindows: boolean, onMac: boolean): string {
  if (onWindows) return 'D:\\Lazarus-Trainer'
  if (onMac) return '/Users/you/Lazarus-Trainer'
  return '/home/you/Lazarus-Trainer'
}
