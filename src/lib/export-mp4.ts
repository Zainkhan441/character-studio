/**
 * MP4 export (M3, browser-only).
 *
 * The format is a slideshow of stills with hard cuts (style guide
 * §5: median shot 2.3s, frames pixel-identical inside a shot), so
 * the video is: one keyframe per shot, held for the shot's timed
 * duration. No motion, no delta frames — one VideoFrame per shot
 * with a duration is exactly the format.
 *
 * Stack (all free, all in-browser, no server):
 * - WebCodecs VideoEncoder (native, no download) → H.264
 * - mp4-muxer 5.2.2 (MIT) → .mp4 container
 * Deliberately NOT ffmpeg.wasm (~30 MB + COOP/COEP headers).
 *
 * No audio track in M3 — the page says the video is silent and
 * ready for narration (voice is M4). If the browser has no
 * VideoEncoder, exportMp4 throws Mp4UnsupportedError and the UI
 * offers PNG stills instead — never a silent failure.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Shot, Storyboard } from "./story";
import { renderScene } from "./scene";
import { shotToScene } from "./story";
import type { Character } from "./character";
import { svgToCanvas } from "./export-image";

export class Mp4UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4UnsupportedError";
  }
}

/** True when this browser can encode video (WebCodecs VideoEncoder). */
export function isMp4ExportSupported(): boolean {
  return typeof VideoEncoder !== "undefined";
}

/** True when this browser can also encode an AAC audio track. */
export function isAudioExportSupported(): boolean {
  return typeof AudioEncoder !== "undefined";
}

export interface Mp4FramePlan {
  shotId: string;
  /** Presentation timestamp, microseconds. */
  timestampUs: number;
  /** How long the still is held, microseconds. */
  durationUs: number;
}

/**
 * One frame per shot, timestamps cumulative. Pure — unit-tested.
 * A 3-shot board of 2s + 3s + 2.5s plans frames at 0, 2_000_000,
 * 5_000_000 µs.
 */
export function planMp4Frames(board: Storyboard): Mp4FramePlan[] {
  const frames: Mp4FramePlan[] = [];
  let t = 0;
  for (const shot of board.shots) {
    const durationUs = Math.max(1, Math.round(shot.durationSec * 1_000_000));
    frames.push({ shotId: shot.id, timestampUs: t, durationUs });
    t += durationUs;
  }
  return frames;
}

export interface Mp4Progress {
  done: number;
  total: number;
  stage: string;
}

const AVC_CODECS = ["avc1.640033", "avc1.640032", "avc1.4d0032", "avc1.42001e"];

/** Pick the first H.264 codec this browser's encoder supports. */
export async function pickAvcCodec(width: number, height: number): Promise<string> {
  for (const codec of AVC_CODECS) {
    try {
      const supported = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 8_000_000,
        framerate: 30,
      });
      if (supported.supported) return codec;
    } catch {
      // Try the next codec.
    }
  }
  throw new Mp4UnsupportedError("This browser's video encoder has no supported H.264 codec.");
}

export interface Mp4ExportResult {
  blob: Blob;
  /** False when the video exported without narration (no AAC encoder). */
  audioIncluded: boolean;
}

/** Storyboard aspect ratios and their full export pixel sizes. Pure. */
export type AspectRatio = "16:9" | "9:16" | "1:1";

export function aspectRatioToSize(aspect: AspectRatio): { width: number; height: number } {
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
    default:
      return { width: 1920, height: 1080 };
  }
}

/**
 * Encode a storyboard to an MP4 blob (default 1920×1080, 16:9, 30 fps
 * timebase; pass opts.size for 9:16 or 1:1).
 * One keyframe per shot, held for the shot's duration. When
 * `audio` is given (the full narration timeline, same total length
 * as the video — silence included for title cards), it is encoded
 * as an AAC track with matching timestamps, so every shot lasts
 * exactly as long as its narration. Calls onProgress after each
 * shot; aborts cleanly on the AbortSignal.
 */
export async function exportStoryboardMp4(
  board: Storyboard,
  cast: Map<string, Character>,
  opts: {
    width?: number;
    height?: number;
    /** Full export size; wins over width/height when given. Default 1920×1080 (16:9). */
    size?: { width: number; height: number };
    /** Full narration timeline PCM (mono). Total length must equal the video length. */
    audio?: { samples: Float32Array; sampleRate: number };
    onProgress?: (p: Mp4Progress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Mp4ExportResult> {
  if (!isMp4ExportSupported()) {
    throw new Mp4UnsupportedError(
      "This browser cannot encode video (WebCodecs is unavailable). Download the PNG stills instead — they are the same frames.",
    );
  }
  if (board.shots.length === 0) throw new Error("There are no shots to export.");
  const width = opts.size?.width ?? opts.width ?? 1920;
  const height = opts.size?.height ?? opts.height ?? 1080;
  const frames = planMp4Frames(board);
  const codec = await pickAvcCodec(width, height);
  const target = new ArrayBufferTarget();
  const audioWanted = Boolean(opts.audio) && isAudioExportSupported();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height },
    ...(audioWanted && opts.audio
      ? { audio: { codec: "aac", sampleRate: opts.audio.sampleRate, numberOfChannels: 1 } }
      : {}),
    fastStart: "in-memory",
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw new Error(`Video encoding failed: ${err.message}`);
    },
  });
  encoder.configure({ codec, width, height, bitrate: 8_000_000, framerate: 30 });
  let audioEncoder: AudioEncoder | null = null;
  if (audioWanted && opts.audio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        throw new Error(`Audio encoding failed: ${err.message}`);
      },
    });
    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: opts.audio.sampleRate,
      numberOfChannels: 1,
      bitrate: 128_000,
    });
  }
  try {
    for (let i = 0; i < board.shots.length; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export cancelled.", "AbortError");
      const shot: Shot = board.shots[i];
      const frame = frames[i];
      opts.onProgress?.({ done: i, total: board.shots.length, stage: `Rendering shot ${i + 1} of ${board.shots.length}…` });
      const scene = shotToScene(shot, 7);
      const { svg } = renderScene(scene, cast, { width, height });
      const canvas = await svgToCanvas(svg, width, height);
      const bitmap = await createImageBitmap(canvas);
      try {
        const videoFrame = new VideoFrame(bitmap, {
          timestamp: frame.timestampUs,
          duration: frame.durationUs,
        });
        encoder.encode(videoFrame, { keyFrame: true });
        videoFrame.close();
      } finally {
        bitmap.close();
      }
    }
    // Audio: 1024-sample AAC frames, timestamps from the sample
    // index, so the narration stays sample-aligned with the shots.
    if (audioEncoder && opts.audio) {
      opts.onProgress?.({ done: board.shots.length, total: board.shots.length, stage: "Encoding narration…" });
      const { samples, sampleRate } = opts.audio;
      const FRAME = 1024;
      for (let start = 0; start < samples.length; start += FRAME) {
        if (opts.signal?.aborted) throw new DOMException("Export cancelled.", "AbortError");
        const len = Math.min(FRAME, samples.length - start);
        const chunkSamples = new Float32Array(FRAME);
        chunkSamples.set(samples.subarray(start, start + len));
        const audioData = new AudioData({
          format: "f32-planar",
          sampleRate,
          numberOfFrames: FRAME,
          numberOfChannels: 1,
          timestamp: Math.round((start / sampleRate) * 1_000_000),
          data: chunkSamples,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();
    }
    opts.onProgress?.({ done: board.shots.length, total: board.shots.length, stage: "Finishing the file…" });
    await encoder.flush();
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: "video/mp4" }), audioIncluded: audioEncoder !== null };
  } finally {
    if (encoder.state !== "closed") {
      try {
        encoder.close();
      } catch {
        // Already closed — ignore.
      }
    }
    if (audioEncoder && audioEncoder.state !== "closed") {
      try {
        audioEncoder.close();
      } catch {
        // Already closed — ignore.
      }
    }
  }
}
