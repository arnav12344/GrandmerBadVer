/*
 * Grandmer — scoring & metrics engine (FEAT-001 rework).
 *
 * Pure, DOM-free functions that turn a run's recorded circles (plus the
 * question answer keys) into the numbers on the Report Card. Grading is
 * DEFERRED: nothing is judged as the student circles. At grading time each
 * circle resolves to a HIT (circled a real error) or a FALSE ALARM (circled a
 * correct token), and a MISS is derived (a real error never circled).
 *
 * The grade band table + assignGrade are preserved byte-for-byte; only the
 * percentage that feeds them changed (caught errors vs total errors).
 */

import type {
  AnyQuestion,
  ErrorCategory,
  Grade,
  Question,
  RecordedAction,
  RetryLearningItem,
  SectionScore,
  TopicStrength,
} from "./types";

/** Points awarded for a single hit (caught error). */
export const POINTS_PER_HIT = 10;
/** Bonus points added for each hit in the longest hit streak. */
export const COMBO_BONUS_PER_STREAK = 5;
/**
 * Maximum speed bonus per hit, awarded in full for an instant catch and
 * tapering to zero as the average time per action approaches SPEED_CUTOFF_MS.
 * Kept small and simple so it nudges without dominating the base score.
 */
export const SPEED_BONUS_PER_HIT = 4;
/** Average ms/action at or beyond which the speed bonus is zero. */
export const SPEED_CUTOFF_MS = 10_000;

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

/** True when a recorded action is a hit (circled a real error). */
function isHit(a: RecordedAction): boolean {
  return a.outcome === "hit";
}

/** True when a recorded action is a false alarm (circled a non-error). */
function isFalseAlarm(a: RecordedAction): boolean {
  return a.outcome === "false-alarm";
}

/** Total number of hits across the recorded circles. */
export function countHits(actions: readonly RecordedAction[]): number {
  return actions.filter(isHit).length;
}

/** Total number of false alarms across the recorded circles. */
export function countFalseAlarms(actions: readonly RecordedAction[]): number {
  return actions.filter(isFalseAlarm).length;
}

/** Total errors present across every standard paper in the run. */
export function totalErrors(questions: readonly AnyQuestion[]): number {
  return questions.reduce(
    (sum, q) => sum + (q.kind === "standard" ? q.errors.length : 0),
    0,
  );
}

/**
 * Misses = real errors that were never circled. Derived from the answer keys
 * minus the distinct errors that were hit. Counts each error id at most once.
 */
export function countMisses(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): number {
  const caught = new Set<string>();
  for (const a of actions) {
    if (isHit(a) && a.errorId) caught.add(a.errorId);
  }
  return Math.max(0, totalErrors(questions) - caught.size);
}

/** Raw score from hits only (before combo / speed bonuses). */
export function baseScore(actions: readonly RecordedAction[]): number {
  return countHits(actions) * POINTS_PER_HIT;
}

/**
 * Per-section score summary: how many of the section's errors were caught out
 * of how many exist. `attempts` is the total errors in the section and
 * `correct` is the hits, so `percent` reflects catch rate, not click accuracy.
 * False alarms do not raise a section score. Essay sections have no errors and
 * are omitted.
 */
export function computeSectionScores(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): SectionScore[] {
  // Distinct caught error ids so re-circling the same error can't inflate.
  const caught = new Set<string>();
  for (const a of actions) {
    if (isHit(a) && a.errorId) caught.add(a.errorId);
  }

  const order: string[] = [];
  const totals = new Map<string, { correct: number; attempts: number }>();
  for (const q of questions) {
    if (q.kind !== "standard" || q.errors.length === 0) continue;
    if (!totals.has(q.section)) {
      totals.set(q.section, { correct: 0, attempts: 0 });
      order.push(q.section);
    }
    const entry = totals.get(q.section)!;
    for (const e of q.errors) {
      entry.attempts += 1;
      if (caught.has(e.id)) entry.correct += 1;
    }
  }

  return order.map((section) => {
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
 * Longest run of consecutive HITS and the bonus it earns. A false alarm breaks
 * the streak. Legacy non-circle outcomes (from not-yet-replaced screens) are
 * treated as breaks, and legacy ungraded "note" marks are inert.
 */
export function computeBestCombo(
  actionsInOrder: readonly RecordedAction[],
): { bestCombo: number; bonus: number } {
  let best = 0;
  let current = 0;
  for (const a of actionsInOrder) {
    // Ungraded essay notes are neutral: they neither extend nor break a streak.
    if (a.outcome === "note") continue;
    if (isHit(a)) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return { bestCombo: best, bonus: best * COMBO_BONUS_PER_STREAK };
}

/**
 * Speed weighting: faster average catches are worth a little more. Returns a
 * bonus in points that scales the per-hit speed bonus by how far the average
 * time per action is below the cutoff. Zero when there is no measurable speed.
 */
export function computeSpeedBonus(
  actionsInOrder: readonly RecordedAction[],
): number {
  const hits = countHits(actionsInOrder);
  if (hits === 0) return 0;
  const avg = computeSpeed(actionsInOrder);
  if (avg <= 0) return 0; // not enough actions to measure speed
  const factor = Math.max(0, 1 - avg / SPEED_CUTOFF_MS);
  return Math.round(hits * SPEED_BONUS_PER_HIT * factor);
}

/** Total score = base (hits) + best-combo bonus + speed bonus. */
export function computeTotalScore(
  actionsInOrder: readonly RecordedAction[],
): number {
  return (
    baseScore(actionsInOrder) +
    computeBestCombo(actionsInOrder).bonus +
    computeSpeedBonus(actionsInOrder)
  );
}

/**
 * Accuracy in 0..1 = hits / (hits + false alarms + misses). Uncaught errors
 * (misses) and circling correct tokens (false alarms) both lower it. Returns 0
 * when there is nothing to judge.
 */
export function computeAccuracy(
  actions: readonly RecordedAction[],
  questions: readonly AnyQuestion[] = [],
): number {
  const hits = countHits(actions);
  const falseAlarms = countFalseAlarms(actions);
  const misses = countMisses(questions, actions);
  const denom = hits + falseAlarms + misses;
  return denom === 0 ? 0 : hits / denom;
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

/**
 * Per-category catch rate: hits vs total errors of that category present in the
 * papers. Uncaught errors (misses) pull a category's rate down; false alarms do
 * not appear here (they belong to no real category).
 */
export function computeTopicStrengths(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): TopicStrength[] {
  const caught = new Set<string>();
  for (const a of actions) {
    if (isHit(a) && a.errorId) caught.add(a.errorId);
  }

  const byCat = new Map<ErrorCategory, { correct: number; attempts: number }>();
  const order: ErrorCategory[] = [];
  for (const q of questions) {
    if (q.kind !== "standard") continue;
    for (const e of q.errors) {
      if (!byCat.has(e.category)) {
        byCat.set(e.category, { correct: 0, attempts: 0 });
        order.push(e.category);
      }
      const entry = byCat.get(e.category)!;
      entry.attempts += 1;
      if (caught.has(e.id)) entry.correct += 1;
    }
  }

  return order.map((category) => {
    const { correct, attempts } = byCat.get(category)!;
    return {
      category,
      correct,
      attempts,
      accuracy: attempts === 0 ? 0 : correct / attempts,
    };
  });
}

/** The category the player caught best (highest catch rate), or null. */
export function strongestTopic(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): ErrorCategory | null {
  const strengths = computeTopicStrengths(questions, actions);
  if (strengths.length === 0) return null;
  return strengths.reduce((best, s) => (s.accuracy > best.accuracy ? s : best))
    .category;
}

/** The category the player caught least (lowest catch rate), or null. */
export function weakestTopic(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): ErrorCategory | null {
  const strengths = computeTopicStrengths(questions, actions);
  if (strengths.length === 0) return null;
  return strengths.reduce((worst, s) =>
    s.accuracy < worst.accuracy ? s : worst,
  ).category;
}

/**
 * Build the retry-learning list: every real error the student did NOT catch,
 * so they know where to brush up. That is exactly the MISSED errors (real
 * errors that were never circled). False alarms (circling a correct token) are
 * not real errors and so produce no learning item here; they only lower
 * accuracy. Each item carries the explanation + resource, and its
 * `whatWasWrong` text reflects that the error went uncircled.
 */
export function buildRetryLearning(
  questions: readonly AnyQuestion[],
  actions: readonly RecordedAction[],
): RetryLearningItem[] {
  const standard = questions.filter(
    (q): q is Question => q.kind === "standard",
  );

  // Which real errors were caught (hit).
  const caught = new Set<string>();
  for (const a of actions) {
    if (isHit(a) && a.errorId) caught.add(a.errorId);
  }

  const items: RetryLearningItem[] = [];
  for (const q of standard) {
    for (const e of q.errors) {
      if (caught.has(e.id)) continue; // caught cleanly, nothing to review
      items.push({
        questionId: q.id,
        section: q.section,
        category: e.category,
        whatWasWrong: `A ${e.category} error here went uncircled.`,
        explanation: e.explanation,
        resource: e.resource,
      });
    }
  }
  return items;
}
