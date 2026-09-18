/*
 * Grandmer — scoring & metrics engine (FEAT-002).
 *
 * Pure, DOM-free functions that turn a stream of recorded player actions into
 * the numbers shown on the Report Card: per-section scores, grade banding,
 * best combo + bonus, accuracy, speed, strongest/weakest topic, and the
 * retry-learning list. Replaces the FEAT-001 placeholder.
 */

import type {
  AnyQuestion,
  ErrorCategory,
  Grade,
  GrammarError,
  Question,
  RecordedAction,
  RetryLearningItem,
  SectionScore,
  TopicStrength,
} from "./types";

/** Points awarded for a single correct action. */
export const POINTS_PER_CORRECT = 10;
/** Bonus points added for each error in the longest correct streak. */
export const COMBO_BONUS_PER_STREAK = 5;

/**
 * Record a new action onto an existing list, returning a NEW array (pure).
 * The category is carried on the action so per-category stats are cheap.
 */
export function recordAction(
  actions: readonly RecordedAction[],
  action: RecordedAction,
): RecordedAction[] {
  return [...actions, action];
}

/** Raw score from correct actions only (before combo bonus). */
export function baseScore(actions: readonly RecordedAction[]): number {
  return actions.filter((a) => a.outcome === "correct").length *
    POINTS_PER_CORRECT;
}

/**
 * Per-section score summary. Attempts count "correct" and "incorrect"; a
 * pure "miss" (clicking an empty spot) is tracked separately for accuracy and
 * is NOT attributed to any section.
 */
export function computeSectionScores(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): SectionScore[] {
  const byQuestion = new Map<string, string>();
  for (const q of questions) {
    byQuestion.set(q.id, q.section);
  }

  const totals = new Map<string, { correct: number; attempts: number }>();
  for (const a of actions) {
    // Misses target no error; notes are ungraded essay marks. Neither counts
    // toward a section's correct/attempts totals.
    if (a.outcome === "miss" || a.outcome === "note") continue;
    const section = byQuestion.get(a.questionId);
    if (!section) continue;
    const entry = totals.get(section) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.outcome === "correct") entry.correct += 1;
    totals.set(section, entry);
  }

  // Preserve question/section order for stable output.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const q of questions) {
    if (!seen.has(q.section)) {
      seen.add(q.section);
      order.push(q.section);
    }
  }

  return order
    .filter((section) => totals.has(section))
    .map((section) => {
      const { correct, attempts } = totals.get(section)!;
      return {
        section,
        correct,
        attempts,
        percent: attempts === 0 ? 0 : Math.round((correct / attempts) * 100),
      };
    });
}

/**
 * The full grade band. Each entry is the minimum percent (inclusive) that
 * earns the grade, evaluated from highest to lowest.
 */
const GRADE_BANDS: ReadonlyArray<{ min: number } & Grade> = [
  { min: 97, grade: "A+", label: "Outstanding" },
  { min: 93, grade: "A", label: "Excellent" },
  { min: 90, grade: "A-", label: "Great" },
  { min: 87, grade: "B+", label: "Very Good" },
  { min: 83, grade: "B", label: "Good" },
  { min: 80, grade: "B-", label: "Solid" },
  { min: 77, grade: "C+", label: "Fair" },
  { min: 73, grade: "C", label: "Okay" },
  { min: 70, grade: "C-", label: "Poor" },
  { min: 67, grade: "D+", label: "Weak" },
  { min: 60, grade: "D", label: "Needs Work" },
  { min: 0, grade: "F", label: "Keep Practising" },
];

/** Map a 0..100 percentage to a letter grade and word label. */
export function assignGrade(scorePercent: number): Grade {
  const clamped = Math.max(0, Math.min(100, scorePercent));
  const band = GRADE_BANDS.find((b) => clamped >= b.min)!;
  return { grade: band.grade, label: band.label };
}

/**
 * Longest run of consecutive "correct" actions and the bonus it earns.
 * "incorrect" and "miss" both break a streak.
 */
export function computeBestCombo(
  actionsInOrder: readonly RecordedAction[],
): { bestCombo: number; bonus: number } {
  let best = 0;
  let current = 0;
  for (const a of actionsInOrder) {
    // Ungraded essay notes are neutral: they neither extend nor break a
    // streak, so a spam-clicked essay can't manufacture a best combo.
    if (a.outcome === "note") continue;
    if (a.outcome === "correct") {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return { bestCombo: best, bonus: best * COMBO_BONUS_PER_STREAK };
}

/** Total score = base score + best-combo bonus. */
export function computeTotalScore(
  actionsInOrder: readonly RecordedAction[],
): number {
  return baseScore(actionsInOrder) + computeBestCombo(actionsInOrder).bonus;
}

/**
 * Accuracy = correct / total attempts (0..1). Misses count as attempts so that
 * clicking empty spots gently lowers accuracy without any harsher penalty.
 */
export function computeAccuracy(actions: readonly RecordedAction[]): number {
  // Ungraded essay "notes" have no right/wrong answer, so they neither count as
  // correct nor as attempts — they must not move accuracy in either direction.
  const graded = actions.filter((a) => a.outcome !== "note");
  if (graded.length === 0) return 0;
  const correct = graded.filter((a) => a.outcome === "correct").length;
  return correct / graded.length;
}

/**
 * Average time per action in milliseconds, derived from consecutive
 * timestamps. Needs at least two actions to measure an interval; returns 0
 * otherwise. Actions are sorted by timestamp first so ordering is robust.
 */
export function computeSpeed(actions: readonly RecordedAction[]): number {
  if (actions.length < 2) return 0;
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
  const span = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  const intervals = sorted.length - 1;
  return span / intervals;
}

/** Per-category accuracy across all recorded (non-miss-targeted) actions. */
export function computeTopicStrengths(
  actions: readonly RecordedAction[],
): TopicStrength[] {
  const byCat = new Map<ErrorCategory, { correct: number; attempts: number }>();
  for (const a of actions) {
    if (a.category === null) continue; // pure miss, no category
    if (a.outcome === "note") continue; // ungraded essay mark — not a topic stat
    const entry = byCat.get(a.category) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.outcome === "correct") entry.correct += 1;
    byCat.set(a.category, entry);
  }
  return [...byCat.entries()].map(([category, { correct, attempts }]) => ({
    category,
    correct,
    attempts,
    accuracy: attempts === 0 ? 0 : correct / attempts,
  }));
}

/** The category the player did best at (highest accuracy), or null. */
export function strongestTopic(
  actions: readonly RecordedAction[],
): ErrorCategory | null {
  const strengths = computeTopicStrengths(actions);
  if (strengths.length === 0) return null;
  return strengths.reduce((best, s) => (s.accuracy > best.accuracy ? s : best))
    .category;
}

/** The category the player struggled with most (lowest accuracy), or null. */
export function weakestTopic(
  actions: readonly RecordedAction[],
): ErrorCategory | null {
  const strengths = computeTopicStrengths(actions);
  if (strengths.length === 0) return null;
  return strengths.reduce((worst, s) => (s.accuracy < worst.accuracy ? s : worst))
    .category;
}

/**
 * Build the retry-learning list: ONLY the wrong answers, each paired with an
 * explanation and a resource so the player knows where to brush up. Correct
 * actions and pure misses are excluded (a miss targets no specific error).
 */
export function buildRetryLearning(
  wrongActions: readonly RecordedAction[],
  questions: readonly AnyQuestion[],
): RetryLearningItem[] {
  const standard = questions.filter(
    (q): q is Question => q.kind === "standard",
  );
  const errorIndex = new Map<string, { error: GrammarError; question: Question }>();
  for (const q of standard) {
    for (const e of q.errors) {
      errorIndex.set(e.id, { error: e, question: q });
    }
  }

  const items: RetryLearningItem[] = [];
  for (const a of wrongActions) {
    if (a.outcome !== "incorrect") continue; // only wrong answers
    if (!a.errorId) continue;
    const found = errorIndex.get(a.errorId);
    if (!found) continue;
    const { error, question } = found;
    items.push({
      questionId: question.id,
      section: question.section,
      category: error.category,
      whatWasWrong: `The correct fix was "${error.fix}".`,
      explanation: error.explanation,
      resource: error.resource,
    });
  }
  return items;
}
