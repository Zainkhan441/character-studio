import { describe, expect, it } from "vitest";
import {
  MAX_SHOT_SECONDS,
  buildStoryboard,
  formatDuration,
  isTitleCard,
  lineToShots,
  parseDialogue,
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

  it("a named cut-away beats 'buried' — igloo, not soil (QA 2026-11-05)", () => {
    const s = suggestScene(
      "The winter snow buried the camp, but inside the igloo the fire kept them warm.",
      0,
      CAST,
    );
    expect(s.cutaway).toBe("igloo");
    expect(s.background).toBe("snow");
  });

  it("'walked across the plain, following the horse herds' is savanna + horse (QA 2026-11-05)", () => {
    const s = suggestScene(
      "When morning came, they walked across the plain, following the horse herds for miles.",
      0,
      CAST,
    );
    expect(s.background).toBe("savanna");
    expect(s.pose).toBe("walk");
    expect(s.animal?.species).toBe("horse");
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
    // "They walked on." is no longer plain — "walked" matches the
    // travel rule and pins every shot to savanna.
    const bgs = [0, 1, 2, 3].map((i) => suggestScene("They kept going.", i, CAST).background);
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

describe("semantic exact-match (M3 advance, 2026-11-05)", () => {
  // One line per semantic axis; every line is <= 11 words so it
  // stays a single shot (11 words = 4.4s at 150 wpm).
  const SCRIPT = [
    "They gathered around the fire under the stars.",
    "Snow fell all winter, and the cold froze the river.",
    "They hid deep inside the cave, away from the storm.",
    "The king stood before his people in the great city.",
    "The soldiers fought the battle at dawn, swords raised.",
    "They rode the horse across the desert, travelling for days.",
    "At night they slept on soft mats, dreaming of home.",
    "They cooked the meat and ate together, sharing the food.",
    "Why did they leave? He wondered, thinking about the question.",
    'John: "We must leave before dawn, or the cold finds us."',
  ].join("\n");

  it("produces the right background / pose / prop for at least 8 of 10 lines", () => {
    const board = buildStoryboard(SCRIPT, CAST);
    expect(board.shots).toHaveLength(10);
    const [nightFire, snow, cave, king, battle, travel, sleep, food, think, dialogue] = board.shots.map(
      (s) => s.scene,
    );

    // 1. night + fire: hut camp, fire lighting, fire prop, night.
    expect(nightFire.background).toBe("hut");
    expect(nightFire.lighting).toBe("fire");
    expect(nightFire.props.some((p) => p.prop === "fire")).toBe(true);
    expect(nightFire.variant).toBe("night");

    // 2. snow / cold: snow background (river has no matching
    // background — noted in the reason, not silently wrong).
    expect(snow.background).toBe("snow");
    expect(snow.reason).toContain("river");

    // 3. cave: cave background.
    expect(cave.background).toBe("cave");

    // 4. city / king: city background, standing pose.
    expect(king.background).toBe("city");
    expect(king.pose).toBe("stand");

    // 5. battle: fighting stance, angry expression.
    expect(battle.pose).toBe("aim");
    expect(battle.expression).toBe("angry");

    // 6. travel + horse + desert: desert background, horse, walk.
    expect(travel.background).toBe("desert");
    expect(travel.animal?.species).toBe("horse");
    expect(travel.pose).toBe("walk");

    // 7. sleep: lying pose, night variant.
    expect(sleep.pose).toBe("lie");
    expect(sleep.variant).toBe("night");

    // 8. food / eating: holding pose, basket prop.
    expect(food.pose).toBe("hold");
    expect(food.props.some((p) => p.prop === "basket")).toBe(true);

    // 9. thinking / question: think pose, thinking expression.
    expect(think.pose).toBe("think");
    expect(think.expression).toBe("thinking");

    // 10. dialogue: close-up camera, point (talking) pose.
    expect(dialogue.camera).toBe("closeup");
    expect(dialogue.pose).toBe("point");
  });

  it("every shot carries a non-empty reason naming what it matched", () => {
    const board = buildStoryboard(SCRIPT, CAST);
    for (const shot of board.shots) {
      expect(shot.scene.reason.length).toBeGreaterThan(0);
      expect(shot.scene.reason).toContain("→");
    }
    // The night+fire reason names the matched words and the result.
    expect(board.shots[0].scene.reason).toContain('"fire"');
    expect(board.shots[0].scene.reason).toContain("hut background");
    expect(board.shots[0].scene.reason).toContain("fire lighting");
  });

  it("plain lines still rotate and still get a reason", () => {
    const bgs = [0, 1, 2, 3].map((i) => suggestScene("They kept going.", i, CAST));
    expect(new Set(bgs.map((s) => s.background)).size).toBe(4);
    for (const s of bgs) {
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.reason).toContain("no strong keyword match");
    }
  });

  it("title cards get a reason too, and are not dialogue", () => {
    const s = suggestScene("THE FIRST NIGHT", 0, CAST);
    expect(s.reason).toContain("Title card");
    expect(s.textCard?.title).toBe("THE FIRST NIGHT");
    expect(parseDialogue("THE FIRST NIGHT")).toBeNull();
    // ...but a colon title is not dialogue either.
    expect(parseDialogue("Fire: The First Night")).toBeNull();
    expect(isTitleCard("Fire: The First Night")).toBe(true);
  });
});

describe("dialogue detection", () => {
  it("detects Name: \"...\" lines with the speaker", () => {
    expect(parseDialogue('John: "We must leave before dawn."')).toEqual({ speaker: "John" });
  });

  it("detects bare quoted lines with no speaker", () => {
    expect(parseDialogue('"We must leave before dawn."')).toEqual({ speaker: null });
  });

  it("does not flag normal narration or titles as dialogue", () => {
    expect(parseDialogue("They gathered around the fire at night.")).toBeNull();
    expect(parseDialogue("Chapter 1: Fire")).toBeNull();
  });

  it("dialogue lines get a close-up or medium camera, never wide", () => {
    const board = buildStoryboard('John: "We must leave before dawn."\n"We go now," she said.', CAST);
    for (const shot of board.shots) {
      expect(["closeup", "medium"]).toContain(shot.scene.camera);
      expect(shot.scene.pose).toBe("point");
    }
  });
});

describe("new semantic rules", () => {
  it("dusk lines get the dusk variant, dawn lines stay day", () => {
    expect(suggestScene("The sun set at dusk over the plain.", 0, CAST).variant).toBe("dusk");
    expect(suggestScene("At dawn the sun rose over the plain.", 0, CAST).variant).toBe("day");
  });

  it("run / sit / dig / throw map to their poses", () => {
    expect(suggestScene("They ran from the storm.", 0, CAST).pose).toBe("run");
    expect(suggestScene("They sat on the rock.", 0, CAST).pose).toBe("sit");
    expect(suggestScene("They dug into the hard ground.", 0, CAST).pose).toBe("dig");
    expect(suggestScene("He threw the spear far.", 0, CAST).pose).toBe("throw");
  });

  it("emotion words map to expressions", () => {
    expect(suggestScene("She was afraid of the dark.", 0, CAST).expression).toBe("scared");
    expect(suggestScene("He was worried about the winter.", 0, CAST).expression).toBe("worried");
    expect(suggestScene("They were surprised by the storm.", 0, CAST).expression).toBe("surprised");
  });

  it("a named location beats the travel rule's savanna", () => {
    const s = suggestScene("They walked through the dark forest for days.", 0, CAST);
    expect(s.background).toBe("forest");
    expect(s.pose).toBe("walk");
  });

  it("a named location beats the hunt rule too", () => {
    const s = suggestScene("They hunted deer in the forest.", 0, CAST);
    expect(s.background).toBe("forest");
    expect(s.pose).toBe("aim");
  });

  it("torch and lamp lines get the matching prop and lighting", () => {
    const torch = suggestScene("He raised the torch in the cave.", 0, CAST);
    expect(torch.props.some((p) => p.prop === "torch")).toBe(true);
    expect(torch.lighting).toBe("fire");
    const lamp = suggestScene("The lamp burned in the house.", 0, CAST);
    expect(lamp.props.some((p) => p.prop === "lamp")).toBe(true);
    expect(lamp.lighting).toBe("lamp");
  });

  it("split long lines recompute the reason for part 2", () => {
    const shots = lineToShots(
      "Ancient humans did not sleep the way we do today, they gathered around the fire in small groups and told stories until the stars came out.",
      0,
      CAST,
    );
    expect(shots).toHaveLength(2);
    expect(shots[0].scene.reason.length).toBeGreaterThan(0);
    expect(shots[1].scene.reason.length).toBeGreaterThan(0);
    expect(shots[1].scene.reason).toContain("→");
    // Part 2 has a different camera, and its reason says so.
    expect(shots[1].scene.camera).not.toBe(shots[0].scene.camera);
  });
});
