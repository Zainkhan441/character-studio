/**
 * Tests for the voice helpers (M3). Synthesis itself needs a
 * browser + an ~86 MB model download, so it is covered by the
 * headless-browser QA pass. Everything pure is tested here.
 */
import { describe, expect, it } from "vitest";
import {
  audioDurationSec,
  buildNarrationTimeline,
  concatenateClips,
  floatToPcm16,
  KOKORO_MODEL_ID,
  KOKORO_SAMPLE_RATE,
  pcmToWav,
  retimeBoard,
  silence,
  splitLineDuration,
  VOICE_OPTIONS,
  type VoiceClip,
} from "./voice";
import { buildStoryboard } from "./story";

describe("KOKORO_MODEL_ID", () => {
  it("is the Apache-2.0 onnx-community model", () => {
    expect(KOKORO_MODEL_ID).toBe("onnx-community/Kokoro-82M-v1.0-ONNX");
  });
});

describe("VOICE_OPTIONS", () => {
  it("offers at least 4 voices, male and female", () => {
    expect(VOICE_OPTIONS.length).toBeGreaterThanOrEqual(4);
    const genders = new Set(VOICE_OPTIONS.map((v) => v.gender));
    expect(genders.has("Female")).toBe(true);
    expect(genders.has("Male")).toBe(true);
    expect(VOICE_OPTIONS.some((v) => v.id === "af_heart")).toBe(true);
  });
});

describe("audioDurationSec", () => {
  it("computes seconds from samples and rate", () => {
    expect(audioDurationSec(new Float32Array(48000), 24000)).toBe(2);
    expect(audioDurationSec(new Float32Array(12000), 24000)).toBe(0.5);
  });
});

describe("floatToPcm16", () => {
  it("clamps and scales to 16-bit", () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(16384);
    expect(pcm[4]).toBe(-16384);
    expect(pcm[5]).toBe(32767);
    expect(pcm[6]).toBe(-32768);
  });
});

describe("concatenateClips", () => {
  it("joins clips in order", () => {
    const out = concatenateClips([
      { samples: new Float32Array([1, 2]), sampleRate: 24000 },
      { samples: new Float32Array([3]), sampleRate: 24000 },
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("silence is the right length", () => {
    expect(silence(2, 24000).length).toBe(48000);
    expect(silence(0, 24000).length).toBe(0);
  });
});

describe("pcmToWav", () => {
  it("produces a valid 16-bit WAV header", async () => {
    const blob = pcmToWav(new Float32Array([0, 0.5, -0.5, 0]), 24000);
    expect(blob.type).toBe("audio/wav");
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...buf.slice(36, 40))).toBe("data");
    // 44-byte header + 4 samples * 2 bytes.
    expect(buf.length).toBe(52);
  });
});

describe("splitLineDuration", () => {
  it("splits a line's audio by word count", () => {
    const [a, b] = splitLineDuration(10, "one two three", "four five six seven eight nine");
    expect(a + b).toBeCloseTo(10, 6);
    expect(a).toBeCloseTo(10 * (3 / 9), 6);
    expect(b).toBeCloseTo(10 * (6 / 9), 6);
  });

  it("never goes below the 0.8s minimum hold", () => {
    const [a, b] = splitLineDuration(1, "one", "two three four five six seven eight nine ten");
    expect(a).toBeGreaterThanOrEqual(0.8);
    expect(b).toBeGreaterThanOrEqual(0.8);
  });
});

describe("buildNarrationTimeline", () => {
  const clip = (seconds: number): VoiceClip => ({
    shotId: "x",
    samples: new Float32Array(Math.round(seconds * KOKORO_SAMPLE_RATE)).fill(0.5),
    sampleRate: KOKORO_SAMPLE_RATE,
    durationSec: seconds,
  });

  it("builds a timeline whose length equals the retimed video length", () => {
    const board = buildStoryboard("Ancient humans gathered around the fire.\nThe snow buried the camp.", []);
    const clips = new Map<string, VoiceClip>([
      [board.shots[0].id, clip(3.2)],
      [board.shots[1].id, clip(1.5)],
    ]);
    const { samples, durations } = buildNarrationTimeline(board, clips);
    const retimed = retimeBoard(board, durations);
    expect(samples.length).toBe(Math.round(retimed.totalSec * KOKORO_SAMPLE_RATE));
    expect(retimed.shots[0].durationSec).toBe(3.2);
    expect(retimed.shots[1].durationSec).toBe(1.5);
  });

  it("splits one clip across a split line and pads to exact shot lengths", () => {
    const board = buildStoryboard(
      "Ancient humans gathered around the fire at night and told long stories while the stars came out over the hills.",
      [],
    );
    expect(board.shots.length).toBe(2); // long line splits
    const clips = new Map<string, VoiceClip>([[board.shots[0].id, clip(6)]]);
    const { samples, durations } = buildNarrationTimeline(board, clips);
    const retimed = retimeBoard(board, durations);
    expect(samples.length).toBe(Math.round(retimed.totalSec * KOKORO_SAMPLE_RATE));
    // Both halves got a real duration (word-count split, min 0.8s).
    expect(retimed.shots[0].durationSec).toBeGreaterThanOrEqual(0.8);
    expect(retimed.shots[1].durationSec).toBeGreaterThanOrEqual(0.8);
  });

  it("leaves title cards silent at their estimated duration", () => {
    const board = buildStoryboard("THE FIRST NIGHT\nAncient humans gathered around the fire.", []);
    const titleShot = board.shots.find((s) => s.scene.textCard)!;
    const narrated = board.shots.find((s) => !s.scene.textCard)!;
    const clips = new Map<string, VoiceClip>([[narrated.id, clip(2.5)]]);
    const { samples, durations } = buildNarrationTimeline(board, clips);
    expect(durations.get(titleShot.id)).toBe(titleShot.durationSec);
    // Timeline length = title duration + 2.5s of narration.
    expect(samples.length).toBe(Math.round((titleShot.durationSec + 2.5) * KOKORO_SAMPLE_RATE));
  });

  it("falls back to silence when a line has no clip", () => {
    const board = buildStoryboard("Ancient humans gathered around the fire.", []);
    const { samples } = buildNarrationTimeline(board, new Map());
    expect(samples.length).toBe(Math.round(board.shots[0].durationSec * KOKORO_SAMPLE_RATE));
    expect(samples.every((v) => v === 0)).toBe(true);
  });
});

describe("retimeBoard", () => {
  it("replaces shot durations with real narration durations", () => {
    const board = buildStoryboard("Ancient humans gathered around the fire.\nThe snow buried the camp.", []);
    expect(board.shots.length).toBe(2);
    const durations = new Map<string, number>([
      [board.shots[0].id, 3.2],
      [board.shots[1].id, 1.5],
    ]);
    const retimed = retimeBoard(board, durations);
    expect(retimed.shots[0].durationSec).toBe(3.2);
    expect(retimed.shots[1].durationSec).toBe(1.5);
    expect(retimed.totalSec).toBeCloseTo(4.7, 6);
    // The input board is untouched.
    expect(board.shots[0].durationSec).not.toBe(3.2);
  });

  it("keeps estimated durations for shots with no clip (title cards)", () => {
    const board = buildStoryboard("THE FIRST NIGHT\nAncient humans gathered around the fire.", []);
    const titleShot = board.shots.find((s) => s.scene.textCard);
    expect(titleShot).toBeDefined();
    const durations = new Map<string, number>([[board.shots[1].id, 2.5]]);
    const retimed = retimeBoard(board, durations);
    const kept = retimed.shots.find((s) => s.id === titleShot!.id);
    expect(kept!.durationSec).toBe(titleShot!.durationSec);
  });

  it("recomputes shots per minute", () => {
    const board = buildStoryboard("One line here, spoken slowly.", []);
    const retimed = retimeBoard(board, new Map([[board.shots[0].id, 10]]));
    expect(retimed.shotsPerMinute).toBeCloseTo(6, 6);
  });
});
