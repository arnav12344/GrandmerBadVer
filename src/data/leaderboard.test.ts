import { describe, expect, it } from "vitest";
import {
  BASE_LEADERBOARD,
  computePlayerRank,
  getRankFlavor,
  insertPlayerScore,
  rankLeaderboard,
} from "./leaderboard";

describe("rankLeaderboard", () => {
  it("orders by score descending with 1-based ranks", () => {
    const ranked = rankLeaderboard([
      { name: "Low", score: 10 },
      { name: "High", score: 90 },
      { name: "Mid", score: 50 },
    ]);
    expect(ranked.map((e) => e.name)).toEqual(["High", "Mid", "Low"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });
});

describe("insertPlayerScore / computePlayerRank", () => {
  it("inserts the player and flags their row", () => {
    const ranked = insertPlayerScore(1000, "Me");
    const player = ranked.find((e) => e.isPlayer);
    expect(player?.name).toBe("Me");
    expect(player?.rank).toBe(1); // beats every mocked examiner
  });

  it("a huge score lands the player at rank 1", () => {
    expect(computePlayerRank(9999).rank).toBe(1);
  });

  it("a tiny score lands the player near the bottom", () => {
    const rank = computePlayerRank(1).rank;
    expect(rank).toBe(BASE_LEADERBOARD.length + 1);
  });

  it("mid score sorts correctly against the mocked board", () => {
    // 200 sits between Prof. Parchment (205) and Dr. Redpen (180).
    const player = computePlayerRank(200);
    expect(player.rank).toBe(4);
  });
});

describe("getRankFlavor — exact threshold strings", () => {
  it("returns 'Must be nice!' for the top rank", () => {
    expect(getRankFlavor(1, 10)).toBe("Must be nice!");
  });

  it("returns 'This is just the beginning' for the lowest rank", () => {
    expect(getRankFlavor(10, 10)).toBe("This is just the beginning");
  });

  it("returns encouraging, non-empty text in between", () => {
    for (let rank = 2; rank <= 9; rank++) {
      const flavor = getRankFlavor(rank, 10);
      expect(flavor).not.toBe("Must be nice!");
      expect(flavor).not.toBe("This is just the beginning");
      expect(flavor.length).toBeGreaterThan(0);
    }
  });

  it("handles a degenerate empty board gracefully", () => {
    expect(getRankFlavor(1, 0)).toBe("This is just the beginning");
  });
});
