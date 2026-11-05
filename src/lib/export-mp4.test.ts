/**
 * Tests for MP4 export (M3).
 *
 * The frame plan is pure and fully tested. The mux test uses
 * mp4-muxer with hand-built chunks (addVideoChunkRaw) so it runs
 * in vitest's node environment — no WebCodecs needed. Real
 * WebCodecs encoding is covered by the headless-browser QA pass.
 */
import { describe, expect, it } from "vitest";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { buildStoryboard } from "./story";
import { planMp4Frames } from "./export-mp4";
import { renderThumbnailSvg, splitTitle, THUMBNAIL_VARIANTS, THUMBNAIL_YELLOW } from "./thumbnail";
import { starterCast } from "./cast";

describe("planMp4Frames", () => {
  it("plans one frame per shot with cumulative timestamps", () => {
    const board = buildStoryboard("Ancient humans gathered around the fire.\nThe snow buried the camp.\nA king rose in the city.", []);
    expect(board.shots.length).toBe(3);
    const frames = planMp4Frames(board);
    expect(frames.length).toBe(3);
    expect(frames[0].timestampUs).toBe(0);
    expect(frames[1].timestampUs).toBe(frames[0].durationUs);
    expect(frames[2].timestampUs).toBe(frames[0].durationUs + frames[1].durationUs);
    for (const f of frames) expect(f.durationUs).toBeGreaterThan(0);
    const totalUs = frames.reduce((s, f) => s + f.durationUs, 0);
    expect(totalUs).toBeCloseTo(board.totalSec * 1_000_000, -3);
  });

  it("returns no frames for an empty board", () => {
    expect(planMp4Frames({ shots: [], totalSec: 0, lineCount: 0, shotsPerMinute: 0 })).toEqual([]);
  });
});

describe("mp4-muxer (raw chunks)", () => {
  it("muxes 3 fake keyframes into a file starting with an ftyp box", () => {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width: 1280, height: 720 },
      fastStart: "in-memory",
    });
    // Minimal AVCDecoderConfigurationRecord (avcC): profile High,
    // one fake SPS + one fake PPS. The muxer copies it verbatim
    // into the avcC box; it does not decode the video itself.
    const avcC = new Uint8Array([
      0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x0d, 0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0x84,
      0x01, 0x00, 0x04, 0x68, 0xeb, 0xe3, 0xcb,
    ]);
    const fakeNal = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, 0x00, 0x00, 0x03, 0x00]);
    const meta = {
      decoderConfig: {
        codec: "avc1.64001f",
        codedWidth: 1280,
        codedHeight: 720,
        description: avcC,
      },
    };
    muxer.addVideoChunkRaw(fakeNal, "key", 0, 2_000_000, meta);
    muxer.addVideoChunkRaw(fakeNal, "key", 2_000_000, 3_000_000, meta);
    muxer.addVideoChunkRaw(fakeNal, "key", 5_000_000, 2_500_000, meta);
    muxer.finalize();
    const buf = new Uint8Array(target.buffer);
    expect(buf.length).toBeGreaterThan(100);
    // Box 1: size (4 bytes) + 'ftyp'.
    expect(String.fromCharCode(buf[4], buf[5], buf[6], buf[7])).toBe("ftyp");
    // The file must contain an mdat box with our frames.
    const text = new TextDecoder("latin1").decode(buf);
    expect(text).toContain("mdat");
    expect(text).toContain("avcC");
  });
});

describe("splitTitle", () => {
  it("keeps short titles on one line", () => {
    expect(splitTitle("FIRE")).toEqual(["FIRE"]);
  });
  it("splits long titles at a word boundary", () => {
    const lines = splitTitle("THE FIRST NIGHT EVER");
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toBe("THE FIRST NIGHT EVER");
    expect(lines[0].length).toBeLessThanOrEqual(12);
  });
});

describe("renderThumbnailSvg", () => {
  const cast = starterCast();
  const arjun = cast[0];

  it("renders 1280x720 with the big yellow title", () => {
    const svg = renderThumbnailSvg({
      character: arjun,
      pose: "point",
      expression: "happy",
      background: "savanna",
      variant: "day",
      title: "FIRE",
      variantId: "bottom-left",
    });
    expect(svg).toContain('width="1280"');
    expect(svg).toContain('height="720"');
    expect(svg).toContain(THUMBNAIL_YELLOW);
    expect(svg).toContain("FIRE");
    expect(svg).toContain("paint-order=\"stroke\"");
  });

  it("renders without a character (diagram thumbnail)", () => {
    const svg = renderThumbnailSvg({
      character: null,
      pose: "stand",
      expression: "neutral",
      background: "cave",
      variant: "night",
      title: "CAVE",
      variantId: "top-center",
      sub: "deep inside",
    });
    expect(svg).toContain("CAVE");
    expect(svg).toContain("DEEP INSIDE");
  });

  it("produces different SVGs for the 3 variants", () => {
    const svgs = THUMBNAIL_VARIANTS.map((v) =>
      renderThumbnailSvg({
        character: arjun,
        pose: "stand",
        expression: "neutral",
        background: "hut",
        variant: "dusk",
        title: "NIGHT",
        variantId: v.id,
      }),
    );
    expect(new Set(svgs).size).toBe(3);
  });
});
