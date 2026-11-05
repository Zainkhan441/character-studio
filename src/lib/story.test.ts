import { describe, expect, it } from "vitest";
import {
  MAX_SHOT_SECONDS,
  buildStoryboard,
  formatDuration,
  isTitleCard,
  lineToShots,
  parseScript,
  secondsForText,
  secondsForWords,
  shotToScene,
  splitLine,
  suggestScene,
  vocabCheck,
  wordsIn,
} from "./story";

const CAST = ["cast-arjun", "cast-asha"];

describe("timing (style guide R16: median 2.3s, 73% ≤ 3s)", () => {
  it("words count and seconds follow 150 wpm", () => {
    expect(wordsIn("one two three")).toBe(3);
    expect(secondsForWords(15)).toBeCloseTo(6, 5);
    expect(secondsForWords(6)).toBeCloseTo(2.4, 5);
  });

  it("a 6-word line is ~2.4s — the reference median", () => {
    expect(secondsForText("Ancient humans slept around the fire")).toBeCloseTo(2.4, 5);
  });

  it("short lines clamp to the 1.2s minimum, very long lines to 20s", () => {
    expect(secondsForText("Hi.")).toBe(1.2);
    expect(secondsForText("word ".repeat(200))).toBe(20);
  });
});

describe("splitLine", () => {
  it("a short line does not split", () => {
    expect(splitLine("Ancient humans slept around the fire.")).toBeNull();
  });

  it("a long line splits into two halves at a boundary", () => {
    const line =
      "Ancient humans did not sleep the way we do today, they gathered around the fire in small groups and told stories until the stars came out.";
    const split = splitLine(line);
    expect(split).not.toBeNull();
    const [a, b] = split as [string, string];
    expect(wordsIn(a)).toBeGreaterThanOrEqual(3);
    expect(wordsIn(b)).toBeGreaterThanOrEqual(3);
    expect(`${a} ${b}`).toBe(line);
    expect(secondsForText(a)).toBeLessThanOrEqual(MAX_SHOT_SECONDS + 0.5);
  });

  it("lineToShots gives a long line two shots with DIFFERENT scenes", () => {
    const line =
      "Ancient humans did not sleep the way we do today, they gathered around the fire in small groups and told stories until the stars came out.";
    const shots = lineToShots(line, 0, CAST);
    expect(shots).toHaveLength(2);
    expect(shots[0].part).toBe(1);
    expect(shots[0].ofParts).toBe(2);
    expect(shots[1].part).toBe(2);
    // The second shot must not be the same frame: different camera.
    expect(shots[1].scene.camera).not.toBe(shots[0].scene.camera);
  });

  it("a short line is exactly one shot", () => {
    const shots = lineToShots("They gathered around the fire.", 0, CAST);
    expect(shots).toHaveLength(1);
    expect(shots[0].ofParts).toBe(1);
  });
});

describe("isTitleCard", () => {
  it("detects all-caps headers and colon headers", () => {
    expect(isTitleCard("HOOK")).toBe(true);
    expect(isTitleCard("THE FIRST NIGHT")).toBe(true);
    expect(isTitleCard("Chapter 1: Fire")).toBe(true);
  });

  it("does not flag normal narration", () => {
    expect(isTitleCard("Ancient humans slept around the fire.")).toBe(false);
    expect(isTitleCard("They gathered around the fire and told stories.")).toBe(false);
  });
});

describe("suggestScene", () => {
  it("is deterministic for the same line + index + cast", () => {
    expect(suggestScene("They slept by the fire.", 2, CAST)).toEqual(suggestScene("They slept by the fire.", 2, CAST));
  });

  it("fire lines get fire lighting and a fire prop", () => {
    const s = suggestScene("They gathered around the fire at night.", 0, CAST);
    expect(s.lighting).toBe("fire");
    expect(s.props.some((p) => p.prop === "fire")).toBe(true);
  });

  it("night lines get the night variant", () => {
    expect(suggestScene("The stars came out at night.", 0, CAST).variant).toBe("night");
  });

  it("snow lines get the snow background", () => {
    expect(suggestScene("The winter snow buried the camp.", 0, CAST).background).toBe("snow");
  });

  it("cave lines get the cave background", () => {
    expect(suggestScene("They hid inside the cave.", 0, CAST).background).toBe("cave");
  });

  it("underground lines get the soil cut-away", () => {
    expect(suggestScene("Below the surface, layers of soil tell the story.", 0, CAST).cutaway).toBe("soil");
  });

  it("igloo lines get the igloo cut-away", () => {
    expect(suggestScene("Inside the igloo, the fire kept them warm.", 0, CAST).cutaway).toBe("igloo");
  });

  it("horse lines add a horse", () => {
    const s = suggestScene("The horse carried them across the plain.", 0, CAST);
    expect(s.animal?.species).toBe("horse");
  });

  it("title cards become text-card shots with no character", () => {
    const s = suggestScene("THE FIRST NIGHT", 0, CAST);
    expect(s.textCard?.title).toBe("THE FIRST NIGHT");
    expect(s.characterId).toBeNull();
  });

  it("consecutive plain lines rotate backgrounds so shots never repeat", () => {
    const bgs = [0, 1, 2, 3].map((i) => suggestScene("They walked on.", i, CAST).background);
    expect(new Set(bgs).size).toBe(4);
  });

  it("cast members rotate across shots", () => {
    const ids = [0, 1, 2].map((i) => suggestScene("They walked on.", i, CAST).characterId);
    expect(ids).toEqual(["cast-arjun", "cast-asha", "cast-arjun"]);
  });
});

describe("buildStoryboard", () => {
  const script = [
    "HOOK",
    "Ancient humans did not sleep the way we do today.",
    "They gathered around the fire at night and told stories.",
    "The winter snow buried the camp, but the igloo kept them warm.",
  ].join("\n");

  it("parses lines, builds shots, totals the runtime", () => {
    const board = buildStoryboard(script, CAST);
    expect(board.lineCount).toBe(4);
    expect(board.shots.length).toBeGreaterThanOrEqual(4);
    expect(board.totalSec).toBeGreaterThan(0);
    expect(board.totalSec).toBeCloseTo(board.shots.reduce((s, x) => s + x.durationSec, 0), 5);
  });

  it("parseScript strips numbering and blank lines", () => {
    expect(parseScript("1. First line\n\n2) Second line\n- Third line\n")).toEqual([
      "First line",
      "Second line",
      "Third line",
    ]);
  });

  it("shot ids are unique", () => {
    const board = buildStoryboard(script, CAST);
    const ids = board.shots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shots-per-minute is in the reference range for a normal script", () => {
    const board = buildStoryboard(
      Array.from({ length: 20 }, (_, i) => `They walked across the plain on day ${i + 1}.`).join("\n"),
      CAST,
    );
    // ~20 lines of ~8 words ≈ 3.2s each => ~19 shots/min; long lines split more.
    expect(board.shotsPerMinute).toBeGreaterThan(10);
    expect(board.shotsPerMinute).toBeLessThan(40);
  });
});

describe("formatDuration and shotToScene", () => {
  it("formats m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(602)).toBe("10:02");
  });

  it("shotToScene produces a renderable scene with the shot's character", () => {
    const board = buildStoryboard("They gathered around the fire at night.", CAST);
    const scene = shotToScene(board.shots[0], 7);
    expect(scene.background).toBe("hut");
    expect(scene.lighting).toBe("fire");
    expect(scene.placements).toHaveLength(1);
    expect(scene.placements[0].characterId).toBe("cast-arjun");
    expect(scene.seed).toBe(7);
  });

  it("vocab is fully wired", () => {
    const v = vocabCheck();
    expect(v.backgrounds).toBe(11);
    expect(v.poses).toBe(21);
    expect(v.faces).toBe(13);
    expect(v.animals).toBe(4);
  });
});
