import { useCallback, useEffect, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import {
  recheckWhisperAvailable,
  recheckTtsAvailable,
  synthesizeNeural,
  synthesizeExternal,
  playNeuralAudio,
  stopNeuralAudio,
  isSpeechSynthesisSupported,
  speak,
  speakStreaming,
  stopSpeaking as stopSpeakingApi,
  getVoicesAsync,
  createAudioRecorder,
  transcribeAudio,
  getLastTtsStatus,
  LocalSttError,
  type AudioRecorder,
} from "../api/voice";
import { isTauri } from "../api/backend";
import { log } from "../lib/logger";
import { registerAutoSpeak } from "../lib/ttsBridge";

// Honest, actionable copy for dictation failures.
export function sttErrorMessage(err: unknown): string {
  // A refused /local-api call, or the whisper handler's own report. Both
  // already say what went wrong in English (#115): "Transcription request
  // refused (HTTP 415): Unsupported Media Type...", "Whisper not available".
  // These used to arrive as a bare Error and were replaced by the microphone
  // hint, which sent people looking at their mic instead of the real cause.
  if (err instanceof LocalSttError && err.message.trim()) return err.message.trim();
  // Local Whisper rejects with the Rust error STRING, and those are written for
  // the user ("Speech-to-text needs faster-whisper, which is not installed…").
  // Swallowing them behind the microphone hint sent people looking in entirely
  // the wrong place. A real JS Error keeps the generic line — its message is
  // for us, not for them.
  if (typeof err === "string" && err.trim()) return err.trim();
  return "Transcription failed, check the microphone and try again";
}

/** What to tell the user when a take came back with no words in it.
 *
 * B4 Gegenprobe, 29.08.: a silent recording ended in nothing at all. No text,
 * no hint, the composer simply unchanged, and the user with no way to tell a
 * silent room from a broken microphone. Whisper answers a silent clip with an
 * empty transcript and a 200, which is not a failure, so nothing on the error
 * path ever fired.
 *
 * Returns null when there IS something to insert, so the caller can hand the
 * answer straight to setSttError.
 *
 * Whisper itself sometimes invents a word on silence, usually "You". That is
 * the model, not this code, and a transcript of "You" is indistinguishable
 * from someone actually saying it, so it is left alone.
 */
export function noSpeechMessage(transcript: string): string | null {
  return transcript.trim() ? null : "No speech detected, try again";
}

// Speak-generation counter + abort plumbing, module-scoped (NOT per hook
// instance) because playback is a process-wide singleton (one HTMLAudioElement
// in api/voice): every SpeakerButton mounts its own useVoice, and a Stop click
// from ANY bubble must invalidate the running synthesis. A per-instance
// counter let another button's Stop merely settle the current clip's await,
// after which the loop kept synthesizing — and billing — the next chunks.
// Same singleton pattern as other app-wide background work.
let speakGen = 0;
let speakAbort: AbortController | null = null;

// #77 (ElBiggus): the boot probe (App.tsx) can lose a cold-start race against
// resolve_lu_python and leave store.ttsAvailable stuck false, so read-aloud
// silently used the Windows SAPI voice and Piper never spoke. When we're about
// to concede to SAPI in local Piper mode, re-probe availability a bounded
// number of times per session (module-scoped so the whole app shares the
// budget across every SpeakerButton). A machine that really has Piper flips
// the store true on the first successful re-probe; a machine without it pays
// at most MAX_LAZY_TTS_REPROBES cheap find_spec spawns for the whole session.
let lazyTtsReprobes = 0;
const MAX_LAZY_TTS_REPROBES = 3;

function stopSpeechPlayback(): void {
  // Invalidate the running speak generation and abort any in-flight synthesis.
  speakGen++;
  speakAbort?.abort();
  speakAbort = null;
  stopNeuralAudio();
  stopSpeakingApi();
  useVoiceStore.getState().setSpeaking(false);
}

export function useVoice() {
  const store = useVoiceStore();
  const recorderRef = useRef<AudioRecorder | null>(null);
  // Streaming-dictation plumbing: a polling timer that transcribes the
  // audio-so-far while recording, and a single-in-flight guard so slow
  // (CPU Whisper) transcriptions never pile up.
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interimBusyRef = useRef(false);

  // Unmount teardown (e.g. view switch mid-dictation): kill the interim
  // transcribe interval and stop the recorder — recorder.stop() releases the
  // mic tracks and closes the AudioContext. Without this the leaked interval
  // keeps POSTing WAV snapshots forever, the mic stays hot, and the stuck
  // store.isRecording can never be cleared.
  useEffect(
    () => () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec?.isRecording()) {
        void rec.stop().catch(() => {});
        useVoiceStore.getState().setRecording(false);
      }
    },
    [],
  );

  // Close-to-tray teardown: main.rs intercepts CloseRequested with hide(), so
  // the webview stays fully alive — without this, read-aloud keeps talking and
  // a running dictation keeps the mic hot (and the PCM take growing) behind a
  // window the user believes is closed. main.rs emits `app:hidden` right
  // before hiding; stop global playback and this instance's recorder.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen("app:hidden", () => {
        stopSpeechPlayback();
        if (streamTimerRef.current) {
          clearInterval(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        interimBusyRef.current = false;
        const rec = recorderRef.current;
        recorderRef.current = null;
        if (rec?.isRecording()) {
          void rec.stop().catch(() => {});
          useVoiceStore.getState().setRecording(false);
        }
      });
      if (disposed) stop();
      else unlisten = stop;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Reactive: the source of truth is the store flag set by the startup probe
  // (App.tsx) and the in-app install (Settings). Reading a module-level boolean
  // here was the bug — it never re-rendered when Whisper came up.
  const sttSupported = store.sttAvailable;
  const ttsSupported = isSpeechSynthesisSupported();

  // Reactive neural-TTS availability (Piper), same model as sttAvailable.
  const ttsAvailable = store.ttsAvailable;

  // External HTTP TTS engine configured + selected (#58). Lets the read-aloud
  // button light up even on a machine without Piper or browser voices.
  const ttsExternalReady = store.ttsMode === "external" && !!store.externalTtsUrl.trim();

  // Re-probe Whisper on demand (mic mount / after install) and sync the store.
  const recheckStt = useCallback(async (): Promise<boolean> => {
    const ok = await recheckWhisperAvailable();
    store.setSttAvailable(ok);
    return ok;
  }, [store]);

  // Re-probe neural TTS on demand (after install) and sync the store.
  const recheckTts = useCallback(async (): Promise<boolean> => {
    const ok = await recheckTtsAvailable(store.piperVoice);
    store.setTtsAvailable(ok);
    return ok;
  }, [store]);

  /**
   * Start dictation. If `onInterim` is supplied, the audio captured so far is
   * transcribed on a ~1.4 s cadence and streamed back so the input grows live
   * (Whisper isn't truly real-time, so this is chunked, not word-by-word). A
   * single-in-flight guard skips ticks while a transcription is still running,
   * so slow CPU transcriptions never queue up.
   */
  const startRecording = useCallback(
    async (onInterim?: (text: string) => void): Promise<boolean> => {
      if (recorderRef.current?.isRecording()) return true;

      store.setSttError(null);
      const recorder = createAudioRecorder();
      recorderRef.current = recorder;

      try {
        await recorder.start();
        store.setRecording(true);
        store.setTranscript("");

        if (onInterim) {
          streamTimerRef.current = setInterval(async () => {
            const rec = recorderRef.current;
            if (!rec?.isRecording() || interimBusyRef.current) return;
            const snap = rec.snapshot();
            // ~0.4 s of 16 kHz / 16-bit mono ≈ 12.8 KB — wait for a little audio.
            if (!snap || snap.size < 12000) return;
            interimBusyRef.current = true;
            try {
              const partial = await transcribeAudio(snap);
              if (recorderRef.current?.isRecording() && partial.trim()) {
                store.setTranscript(partial.trim());
                onInterim(partial.trim());
              }
            } catch {
              /* interim failures are non-fatal — the final transcribe still runs */
            } finally {
              interimBusyRef.current = false;
            }
          }, 1400);
        }
        return true;
      } catch (err) {
        log.error("Failed to start recording", { err });
        if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
        interimBusyRef.current = false;
        recorderRef.current = null;
        store.setSttError("Microphone unavailable, check mic permissions for Lazarus in System Settings");
        return false;
      }
    },
    [store],
  );

  const stopRecording = useCallback(async (): Promise<string> => {
    if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
    interimBusyRef.current = false;
    if (!recorderRef.current) {
      // A leaked take (recorder lost to an unmount) can leave the flag stuck —
      // clear it so the mic button doesn't stay red forever.
      store.setRecording(false);
      return "";
    }

    try {
      // Stop recording and get the final WAV of the whole take.
      const blob = await recorderRef.current.stop();
      store.setRecording(false);
      recorderRef.current = null;

      if (blob.size === 0) return "";

      // Final full-take transcription — more accurate than the interim chunks.
      store.setTranscribing(true);
      try {
        const transcript = await transcribeAudio(blob);
        store.setTranscript(transcript);
        // A silent take is not an error, but it must not be silence in the UI
        // too: the bubble says so and clears itself after six seconds.
        const nothingHeard = noSpeechMessage(transcript);
        if (nothingHeard) store.setSttError(nothingHeard);
        return transcript;
      } catch (err) {
        log.error("Whisper transcription error", { err });
        store.setSttError(sttErrorMessage(err));
        return "";
      } finally {
        store.setTranscribing(false);
      }
    } catch (err) {
      log.error("Failed to stop recording", { err });
      store.setRecording(false);
      store.setTranscribing(false);
      recorderRef.current = null;
      store.setSttError("Recording failed, try again");
      return "";
    }
  }, [store]);

  // Speak `text`. Prefers local neural TTS (Piper) when installed; otherwise
  // falls back to the browser's SpeechSynthesis voices. `streaming` only
  // affects the browser path (sentence-by-sentence so it starts sooner) —
  // neural always synthesizes the whole utterance in one local call.
  const speakInternal = useCallback(
    async (text: string, streaming: boolean) => {
      if (!store.ttsEnabled) return;
      // An external HTTP engine (#58) needs a configured URL; Piper needs to be
      // installed; the browser path needs SpeechSynthesis. Bail only if none
      // of them can speak.
      const externalReady = store.ttsMode === "external" && !!store.externalTtsUrl.trim();
      if (!externalReady && !store.ttsAvailable && !ttsSupported) return;

      const gen = ++speakGen;
      // A new read-aloud (from any bubble) supersedes a running one — abort
      // its in-flight synthesis un-metered instead of leapfrogging playback.
      speakAbort?.abort();
      const controller = new AbortController();
      speakAbort = controller;
      const stopped = () => gen !== speakGen;

      store.setSpeaking(true);
      try {
        // External HTTP TTS engine takes precedence when selected + configured.
        if (externalReady) {
          try {
            const url = await synthesizeExternal(text, store.externalTtsUrl.trim(), store.externalTtsVoice || undefined);
            if (stopped()) return;
            await playNeuralAudio(url);
            return;
          } catch (err) {
            if (stopped()) return;
            log.error("External TTS failed, falling back to browser voices", { err });
          }
        } else {
          // Local neural (Piper). Trust the cached availability flag, but if it
          // is false while we're in local Piper mode, re-probe (bounded) before
          // conceding to the browser SAPI fallback — a racy boot probe must not
          // permanently silence Piper (#77, ElBiggus). A positive re-probe is
          // written back to the store so later reads skip straight to Piper.
          let piperReady = store.ttsAvailable;
          if (!piperReady && lazyTtsReprobes < MAX_LAZY_TTS_REPROBES && store.ttsMode !== "external") {
            lazyTtsReprobes++;
            piperReady = await recheckTtsAvailable(store.piperVoice);
            if (stopped()) return;
            if (piperReady) store.setTtsAvailable(true);
          }
          if (piperReady) {
            try {
              const url = await synthesizeNeural(text, store.piperVoice);
              if (stopped()) return;
              await playNeuralAudio(url);
              store.setTtsFallbackReason(null);
              return;
            } catch (err) {
              if (stopped()) return;
              log.error("Neural TTS failed, falling back to browser voices", { err });
              // #77 (ElBiggus): this fallback was invisible — Piper installed
              // AND selected, yet every read-aloud spoke the system voice and
              // nothing in the app said why. Record the reason for Settings.
              store.setTtsFallbackReason(
                `Piper failed to speak (${err instanceof Error ? err.message : String(err)}). Read-aloud used the system voice instead.`,
              );
            }
          } else if (store.ttsMode !== "external") {
            // Say which of the three things is actually missing. The old text
            // asserted "installed but not responding" for all of them, so a
            // user who had never set Piper up was sent looking for a fault
            // that did not exist.
            const st = getLastTtsStatus();
            store.setTtsFallbackReason(
              st.piper === false
                ? "Neural TTS (Piper) is not set up yet, so read-aloud used the system voice. Install it in Settings → Voice."
                : st.voice === false
                  ? "No Piper voice is fully downloaded yet, so read-aloud used the system voice. Pick one in Settings → Voice."
                  : "Piper is installed but not responding, so read-aloud used the system voice instead.",
            );
          }
        }
        if (!ttsSupported || stopped()) return;
        let voice: SpeechSynthesisVoice | undefined;
        if (store.ttsVoice) {
          const voices = await getVoicesAsync();
          voice = voices.find((v) => v.name === store.ttsVoice);
        }
        if (stopped()) return;
        if (streaming) {
          await speakStreaming(text, voice, store.ttsRate, store.ttsPitch);
        } else {
          await speak(text, voice, store.ttsRate, store.ttsPitch);
        }
      } catch (err) {
        log.error("Speech synthesis error", { err });
      } finally {
        // A newer speak/stop already owns the flag — don't clobber it.
        if (!stopped()) store.setSpeaking(false);
      }
    },
    [store, ttsSupported]
  );

  const speakText = useCallback((text: string) => speakInternal(text, false), [speakInternal]);
  const speakTextStreaming = useCallback((text: string) => speakInternal(text, true), [speakInternal]);

  // Publish the current streaming-speak fn so useChat/useAgentChat can auto-read
  // finished responses (#77) without subscribing to this store. Re-runs whenever
  // the fn is re-memoized (i.e. voice settings changed), keeping it fresh.
  useEffect(() => {
    registerAutoSpeak(speakTextStreaming);
  }, [speakTextStreaming]);

  // Module-scoped singleton — any instance's Stop halts the global playback.
  const stopSpeaking = useCallback(() => stopSpeechPlayback(), []);

  const clearSttError = useCallback(() => store.setSttError(null), [store]);

  return {
    isRecording: store.isRecording,
    isTranscribing: store.isTranscribing,
    isSpeaking: store.isSpeaking,
    transcript: store.transcript,
    sttError: store.sttError,
    clearSttError,
    sttSupported,
    ttsSupported,
    ttsAvailable,
    ttsExternalReady,
    ttsEnabled: store.ttsEnabled,
    /** No fixed client-side duration cap for local dictation. */
    maxRecordingMs: null,
    startRecording,
    stopRecording,
    recheckStt,
    recheckTts,
    speakText,
    speakTextStreaming,
    stopSpeaking,
  };
}
