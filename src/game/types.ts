/*
 * Grandmer — domain model (FEAT-001 rework).
 *
 * Pure, DOM-free typed model for the "error hunt" grammar detective game.
 * The player is an examiner grading student papers. Each question presents a
 * student's answer broken into tokens with a hidden set of tagged errors.
 *
 * The interaction model is now CIRCLE-ONLY with DEFERRED grading: the student
 * circles (lassos) suspected errors and gets NO instant feedback. Correctness
 * is only computed at grading time as:
 *  - HIT: a circle landed on a token that is a real error,
 *  - FALSE ALARM: a circle landed on a token that is NOT an error,
 *  - MISS: a real error that was never circled (a DERIVED grading concept, not
 *    a recorded action).
 * The UI (later features) renders and captures these; nothing here touches the
 * DOM.
 */

/** The five grammar skill categories the game trains. */
export type ErrorCategory =
  | "preposition"
  | "tense"
  | "spelling"
  | "punctuation"
  | "sentence-structure";

/**
 * Legacy correction "kind" that only served the removed click-to-fix UI. It is
 * no longer used for grading (grading keys purely off which tokens are errors)
 * and is kept optional so existing data and not-yet-replaced screens compile.
 */
export type ErrorKind = "spelling" | "punctuation" | "word";

/** A pointer to where a resource explaining the topic can be found. */
export interface ResourceReference {
  /** Human-friendly title of the reference. */
  title: string;
  /** A URL or a "where-to-learn" hint (section of a book, lesson name, etc.). */
  url: string;
}

/**
 * A single hidden error embedded in a student's answer.
 *
 * `tokenIndex` is the position within the question's `tokens` array that the
 * student must circle. `category`, `explanation` and `resource` are the answer
 * key plus teaching content used by grading and retry-learning.
 *
 * `kind`, `fix` and `options` are LEGACY fields that only served the removed
 * correction UI. They are optional now and never consulted by grading; a spot
 * is a real error purely by virtue of its `tokenIndex` being listed here.
 */
export interface GrammarError {
  id: string;
  category: ErrorCategory;
  /** Index into Question.tokens that this error applies to. */
  tokenIndex: number;
  /** Short, non-shaming explanation of the correction. */
  explanation: string;
  /** Where to brush up on the underlying topic. */
  resource: ResourceReference;
  /** LEGACY (unused by grading): the old correction kind. */
  kind?: ErrorKind;
  /** LEGACY (unused by grading): the old canonical fix. */
  fix?: string;
  /** LEGACY (unused by grading): the old spelling dropdown options. */
  options?: readonly string[];
}

/** A selectable chunk of the student's answer that the player can circle. */
export interface Token {
  /** Position in the answer, matches GrammarError.tokenIndex. */
  index: number;
  /** The text shown for this token (a word, or "" for a missing-mark gap). */
  text: string;
  /**
   * True when this token represents a gap where punctuation is missing rather
   * than an existing word. A gap is still a circle-able target. Purely
   * presentational metadata for the UI.
   */
  isGap?: boolean;
}

/** A standard question with a known, hidden set of tagged errors. */
export interface Question {
  kind: "standard";
  id: string;
  /** Section label, e.g. "Section A — Prepositions". */
  section: string;
  /** A short prompt / the exam question the student was answering. */
  prompt: string;
  /** The student's answer broken into selectable tokens. */
  tokens: readonly Token[];
  /** The hidden errors the player is hunting for (the answer key). */
  errors: readonly GrammarError[];
}

/**
 * The final essay question: a "free-for-all" open-marking exercise with no
 * single hidden-error set. Circles on the essay are ungraded (it contributes
 * no gradable errors to the run).
 */
export interface EssayQuestion {
  kind: "essay";
  id: string;
  section: string;
  prompt: string;
  /** The student's essay text (rendered as handwriting by the UI). */
  text: string;
  /** Marked true so the UI/session treat it as open marking. */
  freeForAll: true;
  /**
   * Suggested focus areas the examiner might comment on. Purely advisory —
   * there is no single correct answer for the essay.
   */
  focusAreas: readonly ErrorCategory[];
}

/** Any question the game can present. */
export type AnyQuestion = Question | EssayQuestion;

/**
 * The resolved outcome of a single recorded circle:
 * - "hit": the circle enclosed a token that is a real error.
 * - "false-alarm": the circle enclosed a token that is NOT an error.
 *
 * A MISS (a real error the student never circled) is a DERIVED grading concept
 * computed from the answer key vs the recorded circles; it is never a recorded
 * action.
 */
export type CircleOutcome = "hit" | "false-alarm";

/**
 * Extra, non-grading action outcomes.
 *  - "note": an ungraded circle on the essay free-for-all (no answer key), kept
 *    for the record and for speed timing but excluded from scored metrics.
 *  - "correct" / "incorrect" / "miss": legacy literals from the removed
 *    instant-check model, retained only so the existing scoring/session unit
 *    tests keep exercising the metric helpers. Grading no longer produces them
 *    from live play.
 */
export type LegacyActionOutcome = "correct" | "incorrect" | "miss" | "note";

/**
 * The outcome recorded against a token. Circle-based runs use "hit" /
 * "false-alarm"; the essay records an inert "note" (see LegacyActionOutcome).
 */
export type ActionOutcome = CircleOutcome | LegacyActionOutcome;

/**
 * A recorded circle. `tokenIndex` is the token the student lassoed. `outcome`
 * is "hit" when that token is a real error and "false-alarm" otherwise.
 * `category` carries the error's category on a hit and is null for a false
 * alarm (no error there). `errorId` is set only when the circle targets a real
 * error. `timestamp` is milliseconds and is used to compute speed.
 */
export interface RecordedAction {
  questionId: string;
  /** Category of the circled error; null for a false alarm (no error there). */
  category: ErrorCategory | null;
  outcome: ActionOutcome;
  /** The token the student circled. */
  tokenIndex?: number;
  /** When the circle happened, in milliseconds. */
  timestamp: number;
  /** The error involved, when the circle landed on a real error. */
  errorId?: string;
}

/** A single entry in the retry-learning list shown on the report card. */
export interface RetryLearningItem {
  questionId: string;
  section: string;
  category: ErrorCategory;
  /** Plain description of what went wrong (missed error or false alarm). */
  whatWasWrong: string;
  explanation: string;
  resource: ResourceReference;
}

/** Per-section score summary (hits caught vs total errors in the section). */
export interface SectionScore {
  section: string;
  /** Errors caught (hits) in this section. */
  correct: number;
  /** Total errors present in this section. */
  attempts: number;
  /** 0..100 percentage of errors caught in the section. */
  percent: number;
}

/** A letter grade plus its word label, e.g. { grade: "C-", label: "Poor" }. */
export interface Grade {
  grade: string;
  label: string;
}

/** Per-category hit rate, used to pick strongest/weakest topics. */
export interface TopicStrength {
  category: ErrorCategory;
  /** Errors caught (hits) in this category. */
  correct: number;
  /** Total errors present in this category. */
  attempts: number;
  /** correct / attempts in 0..1. */
  accuracy: number;
}

/** The final signed report card produced at the end of a session. */
export interface ReportCard {
  sectionScores: readonly SectionScore[];
  totalScore: number;
  overallPercent: number;
  overallGrade: Grade;
  accuracy: number;
  /** Average milliseconds per action. */
  speedMsPerAction: number;
  bestCombo: number;
  comboBonus: number;
  strongestTopic: ErrorCategory | null;
  weakestTopic: ErrorCategory | null;
  retryLearning: readonly RetryLearningItem[];
  /** Real errors the student circled correctly. */
  hits: number;
  /** Real errors the student never circled. */
  misses: number;
  /** Circles on tokens that were not errors. */
  falseAlarms: number;
  /** Filled in by the student on the UI; empty until signed. */
  studentSignature: string;
}
