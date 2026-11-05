/**
 * Narration voice (M3) — free in-browser TTS with Kokoro-82M.
 *
 * kokoro-js 1.2.1 (Apache-2.0, verified latest 2026-11-05),
 * model `onnx-community/Kokoro-82M-v1.0-ONNX`, dtype q8 (~86 MB,
 * downloaded once from the Hugging Face Hub, cached by the
 * browser). No API key, no server, no cost — the voice runs
 * entirely in the user's browser.
 *
 * The key product rule: EACH SHOT LASTS EXACTLY AS LONG AS ITS
 * NARRATION. The storyboard timing comes from the real TTS audio
 * duration (retimeBoard), not the 150 wpm estimate. Split lines
 * share one line's clip, split proportionally by word count.
 * Title cards have no narration — they keep their estimate and
 * play over silence.
 *
 * Browser-only (dynamic import). The pure helpers (retiming,
 * PCM/WAV) are unit-tested; synthesis itself is covered by the
 * headless-browser QA pass.
 */
import type { Shot, Storyboard } from "./story";
import { wordsIn } from "./story";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_SAMPLE_RATE = 24000;

/** The four voices offered in the picker (Kokoro-82M voice ids). */
export type VoiceId = "af_heart" | "af_bella" | "am_fenrir" | "am_michael";

export interface VoiceOption {
  id: VoiceId;
  name: string;
  gender: string;
  note: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "af_heart", name: "Heart", gender: "Female", note: "Warm narrator — the default voice." },
  { id: "af_bella", name: "Bella", gender: "Female", note: "Bright and clear." },
  { id: "am_fenrir", name: "Fenrir", gender: "Male", note: "Deep and steady." },
  { id: "am_michael", name: "Michael", gender: "Male", note: "Calm documentary voice." },
];

export const DEFAULT_VOICE: VoiceId = "af_heart";

export interface VoiceProgress {
  stage: "loading-model" | "synthesizing" | "done";
  percent: number;
  note: string;
}

export interface VoiceClip {
  /** Shot id this clip belongs to (one clip per script line). */
  shotId: string;
  /** Raw PCM, mono, 24 kHz. */
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function audioDurationSec(samples: Float32Array, sampleRate: number): number {
  return samples.length / sampleRate;
}

/** Float32 [-1,1] → 16-bit PCM, little-endian. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

/** Concatenate clips (with optional silence gaps) into one timeline. */
export function concatenateClips(
  clips: Array<{ samples: Float32Array; sampleRate: number }>,
): Float32Array {
  const total = clips.reduce((s, c) => s + c.samples.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of clips) {
    out.set(c.samples, offset);
    offset += c.samples.length;
  }
  return out;
}

/** Silence of the given duration at the given sample rate. */
export function silence(durationSec: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(durationSec * sampleRate)));
}

/**
 * Encode mono Float32 PCM as a 16-bit WAV blob (for download /
 * per-line replay). Pure.
 */
export function pcmToWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = floatToPcm16(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Re-time a storyboard from real narration durations. `durations`
 * maps shot id → seconds of audio for that shot's LINE. Split
 * lines (part 1/2 of one line) share the line's duration,
 * proportionally by word count. Title-card shots (no clip) keep
 * their estimated duration.
 *
 * Returns a new storyboard (never mutates the input) with totalSec
 * and shotsPerMinute recomputed.
 */
export function retimeBoard(board: Storyboard, durations: Map<string, number>): Storyboard {
  const shots: Shot[] = board.shots.map((shot) => {
    const lineDuration = durations.get(shot.id);
    if (lineDuration === undefined) return shot;
    // The caller stores the per-SHOT duration in the map (split
    // lines are split by word count first — see splitLineDuration),
    // so this is a straight replacement with a minimum hold time.
    return { ...shot, durationSec: Math.max(0.8, lineDuration) };
  });
  const totalSec = shots.reduce((s, x) => s + x.durationSec, 0);
  return {
    ...board,
    shots,
    totalSec,
    shotsPerMinute: totalSec > 0 ? (shots.length / totalSec) * 60 : 0,
  };
}

/**
 * Build the full narration timeline for a storyboard from per-LINE
 * clips (keyed by the first shot id of each line). Pure.
 *
 * - Split lines (part 1/2) share one clip, sliced by word-count
 *   proportions; each slice is padded with silence to EXACTLY the
 *   shot's duration, so audio and video can never drift.
 * - Title-card shots have no narration — silence for their duration.
 * - A line with no clip (synthesis skipped/failed) is silence.
 *
 * Returns the concatenated PCM timeline plus the per-shot
 * durations map (feed it to retimeBoard).
 */
export function buildNarrationTimeline(
  board: Storyboard,
  lineClips: Map<string, VoiceClip>,
): { samples: Float32Array; sampleRate: number; durations: Map<string, number> } {
  const durations = new Map<string, number>();
  const segments: Array<{ samples: Float32Array; sampleRate: number }> = [];
  const shots = board.shots;
  let i = 0;
  while (i < shots.length) {
    const first = shots[i];
    const second = first.ofParts === 2 && shots[i + 1] ? shots[i + 1] : null;
    const group = second ? [first, second] : [first];
    const clip = lineClips.get(first.id);
    const sampleRate = clip?.sampleRate ?? KOKORO_SAMPLE_RATE;
    if (first.scene.textCard || !clip) {
      // Title card or missing clip: silence, keep the estimate.
      for (const s of group) {
        const dur = s.durationSec;
        durations.set(s.id, dur);
        segments.push({ samples: silence(dur, sampleRate), sampleRate });
      }
    } else if (group.length === 1) {
      const dur = Math.max(0.8, clip.durationSec);
      durations.set(first.id, dur);
      const seg = clip.samples;
      const want = Math.round(dur * sampleRate);
      segments.push({
        samples: seg.length >= want ? seg.slice(0, want) : concatWithSilence(seg, want - seg.length),
        sampleRate,
      });
    } else {
      // group.length === 2 here, so the second half exists.
      const secondShot = second;
      if (!secondShot) throw new Error("A split line is missing its second half.");
      const [d1, d2] = splitLineDuration(clip.durationSec, first.text, secondShot.text);
      durations.set(first.id, d1);
      durations.set(second.id, d2);
      const total = clip.samples.length;
      const cut = Math.round((total * d1) / (d1 + d2));
      const part1 = clip.samples.slice(0, cut);
      const part2 = clip.samples.slice(cut);
      for (const [seg, dur] of [
        [part1, d1],
        [part2, d2],
      ] as const) {
        const want = Math.round(dur * sampleRate);
        segments.push({
          samples: seg.length >= want ? seg.slice(0, want) : concatWithSilence(seg, want - seg.length),
          sampleRate,
        });
      }
    }
    i += group.length;
  }
  const samples = concatenateClips(segments);
  return { samples, sampleRate: KOKORO_SAMPLE_RATE, durations };
}

function concatWithSilence(samples: Float32Array, silenceSamples: number): Float32Array {
  const out = new Float32Array(samples.length + silenceSamples);
  out.set(samples, 0);
  return out;
}
/**
 * Split a line's full audio duration across its two shot halves,
 * proportionally by word count. Pure — used when one TTS clip
 * covers a split line.
 */
export function splitLineDuration(
  fullDurationSec: number,
  firstText: string,
  secondText: string,
): [number, number] {
  const w1 = Math.max(1, wordsIn(firstText));
  const w2 = Math.max(1, wordsIn(secondText));
  const total = w1 + w2;
  return [
    Math.max(0.8, (fullDurationSec * w1) / total),
    Math.max(0.8, (fullDurationSec * w2) / total),
  ];
}

/* ------------------------------------------------------------------ */
/* Browser TTS (Kokoro)                                                */
/* ------------------------------------------------------------------ */

export interface KokoroTts {
  generate(
    text: string,
    options: { voice: VoiceId; speed: number },
  ): Promise<{ data: Float32Array; sampling_rate: number }>;
}

let cachedTts: KokoroTts | null = null;
let cachedTtsPromise: Promise<KokoroTts> | null = null;

/** Load Kokoro once (module-level cache). Throws VoiceError. */
export async function loadVoice(
  onProgress?: (p: VoiceProgress) => void,
): Promise<KokoroTts> {
  if (cachedTts) return cachedTts;
  if (cachedTtsPromise) return cachedTtsPromise;
  cachedTtsPromise = (async () => {
    onProgress?.({ stage: "loading-model", percent: 0, note: "Loading the narration voice (~86 MB, first time only)…" });
    // NOTE: kokoro-js's package "exports" map points bundlers at
    // the NODE build (dist/kokoro.js → onnxruntime-node native
    // binaries, which webpack cannot bundle). The package ships a
    // self-contained browser build at dist/kokoro.web.js; next.config
    // aliases the package to it. Types still come from the package.
    let mod: typeof import("kokoro-js");
    try {
      mod = await import("kokoro-js");
    } catch {
      throw new VoiceError(
        "The voice library could not be loaded. Check your connection, or export the silent timed video instead.",
      );
    }
    try {
      const tts = await mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype: "q8",
        progress_callback: (progress: { status: string; progress?: number }) => {
          const pct = typeof progress.progress === "number" ? Math.round(progress.progress) : -1;
          onProgress?.({
            stage: "loading-model",
            percent: pct,
            note:
              progress.status === "downloading"
                ? `Downloading voice… ${pct >= 0 ? `${pct}%` : ""}`
                : progress.status === "ready"
                  ? "Voice ready."
                  : `Voice: ${progress.status}`,
          });
        },
      });
      const wrapped: KokoroTts = {
        generate: (text, options) => tts.generate(text, options) as unknown as Promise<{ data: Float32Array; sampling_rate: number }>,
      };
      cachedTts = wrapped;
      onProgress?.({ stage: "done", percent: 100, note: "Voice ready." });
      return wrapped;
    } catch (err) {
      cachedTtsPromise = null;
      if (err instanceof VoiceError) throw err;
      throw new VoiceError(
        "The voice model could not be downloaded (it needs internet the first time, ~86 MB). The silent timed export still works.",
      );
    }
  })();
  return cachedTtsPromise;
}

/** Synthesize one line. Returns the clip with its real duration. */
export async function synthesizeLine(
  tts: KokoroTts,
  text: string,
  voice: VoiceId,
  shotId: string,
): Promise<VoiceClip> {
  const audio = await tts.generate(text, { voice, speed: 1 });
  const samples = audio.data;
  return {
    shotId,
    samples,
    sampleRate: audio.sampling_rate || KOKORO_SAMPLE_RATE,
    durationSec: audioDurationSec(samples, audio.sampling_rate || KOKORO_SAMPLE_RATE),
  };
}
