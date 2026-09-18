/*
 * Grandmer — mocked leaderboard & rank flavour (FEAT-002).
 *
 * A ranked list of fictional examiners plus positive, non-discouraging flavour
 * text. Competitive without shaming students who are behind: a low rank gets
 * encouragement, a high rank gets celebration.
 */

/** One row on the leaderboard. */
export interface LeaderboardEntry {
  name: string;
  score: number;
  /** True for the human player's freshly inserted row. */
  isPlayer?: boolean;
}

/** A leaderboard row with its computed 1-based rank. */
export interface RankedEntry extends LeaderboardEntry {
  rank: number;
}

/** The mocked base leaderboard (fictional examiners), unsorted-safe. */
export const BASE_LEADERBOARD: readonly LeaderboardEntry[] = [
  { name: "Ms. Quillsworth", score: 245 },
  { name: "Inspector Inkwell", score: 220 },
  { name: "Prof. Parchment", score: 205 },
  { name: "Dr. Redpen", score: 180 },
  { name: "Mr. Marginalia", score: 155 },
  { name: "Ms. Footnote", score: 130 },
  { name: "Cadet Comma", score: 95 },
  { name: "Rookie Scribbles", score: 60 },
];

/** Sort a list of entries into a ranked leaderboard (highest score = rank 1). */
export function rankLeaderboard(
  entries: readonly LeaderboardEntry[],
): RankedEntry[] {
  return [...entries]
    .sort((a, b) => b.score - a.score)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Insert the player's final score into the mocked leaderboard and return the
 * fully ranked list. The player's row is flagged with `isPlayer`.
 */
export function insertPlayerScore(
  score: number,
  playerName = "You",
  base: readonly LeaderboardEntry[] = BASE_LEADERBOARD,
): RankedEntry[] {
  const withPlayer: LeaderboardEntry[] = [
    ...base,
    { name: playerName, score, isPlayer: true },
  ];
  return rankLeaderboard(withPlayer);
}

/** Look up the player's ranked row after inserting their score. */
export function computePlayerRank(
  score: number,
  playerName = "You",
  base: readonly LeaderboardEntry[] = BASE_LEADERBOARD,
): RankedEntry {
  const ranked = insertPlayerScore(score, playerName, base);
  // The freshly inserted player row is the one flagged isPlayer.
  return ranked.find((e) => e.isPlayer)!;
}

/**
 * Positive, non-discouraging flavour text for a given rank out of `total`.
 * - Top of the board  -> exact string "Must be nice!"
 * - Bottom of the board -> exact string "This is just the beginning"
 * - In between         -> encouraging, progress-focused messages.
 *
 * Thresholds use the fractional position so they scale with leaderboard size.
 */
export function getRankFlavor(rank: number, total: number): string {
  if (total <= 0) return "This is just the beginning";

  // Rank 1 (or a tie at the very top) always celebrates.
  if (rank <= 1) return "Must be nice!";
  // The literal last place always gets the gentle encouragement.
  if (rank >= total) return "This is just the beginning";

  const position = rank / total; // 0 (top) .. 1 (bottom)

  if (position <= 0.25) return "Top marks — the staff room is impressed!";
  if (position <= 0.5) return "Climbing fast. The top spot is in reach.";
  if (position <= 0.75) return "Solid work — keep sharpening that red pen.";
  return "Every expert started here. Onwards!";
}
