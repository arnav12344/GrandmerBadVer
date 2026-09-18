/*
 * Grandmer — domain model (FEAT-002).
 *
 * Pure, DOM-free typed model for the "error hunt" grammar detective game.
 * The player is an examiner grading student papers: each question presents a
 * student's answer broken into selectable tokens, with a hidden set of tagged
 * errors. The UI (FEAT-003/004) renders these; nothing here touches the DOM.
 */

/** The five grammar skill categories the game trains. */
export type ErrorCategory =
  | "preposition"
  | "tense"
  | "spelling"
  | "punctuation"
  | "sentence-structure";

/**
 * How the player fixes a given error once its location is clicked:
 * - "spelling": a dropdown of candidate spellings (one correct + distractors).
 * - "punctuation": insert a missing mark (e.g. ".", ",", "?") at the gap.
 * - "word": replace/choose the correct word (prepositions, tenses, structure).
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
 * player must click. `fix` is the canonical correct answer used by checkFix.
 * For spelling errors, `options` provides the dropdown choices (the correct
 * spelling must be present among plausible distractors).
 */
export interface GrammarError {
  id: string;
  category: ErrorCategory;
  kind: ErrorKind;
  /** Index into Question.tokens that this error applies to. */
  tokenIndex: number;
  /** The canonical correct fix (a spelling, a mark like ".", or a word). */
  fix: string;
  /** Dropdown options for spelling errors (must include `fix`). */
  options?: readonly string[];
  /** Short, non-shaming explanation of the correction. */
  explanation: string;
  /** Where to brush up on the underlying topic. */
  resource: ResourceReference;
}

/** A selectable chunk of the student's answer that the player can click. */
export interface Token {
  /** Position in the answer, matches GrammarError.tokenIndex. */
  index: number;
  /** The text shown for this token (a word, or "" for a missing-mark gap). */
  text: string;
  /**
   * True when this token represents a gap where punctuation is missing rather
   * than an existing word. Purely presentational metadata for the UI.
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
  /** The hidden errors the player is hunting for. */
  errors: readonly GrammarError[];
}

/**
 * The final essay question: a "free-for-all" open-marking exercise with no
 * single hidden-error set. The player marks holistically; scoring is open.
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
 * The outcome of a single player action against a token.
 * - "correct" / "incorrect": a graded action against a known hidden error.
 * - "miss": clicked a location that was not an error (harmless, non-shaming;
 *   only affects accuracy).
 * - "note": an ungraded observation the player makes on the essay free-for-all,
 *   where there is no answer key. Notes are recorded for the record only and
 *   must NOT feed the scored metrics (score, accuracy, combo, topic strength).
 */
export type ActionOutcome = "correct" | "incorrect" | "miss" | "note";

/**
 * A recorded player action. `miss` means the player clicked a location that was
 * not an error (harmless, non-shaming — only affects accuracy). `note` is an
 * ungraded essay mark that does not feed the scored metrics. `timestamp` is
 * milliseconds (epoch or session-relative) used to compute speed.
 */
export interface RecordedAction {
  questionId: string;
  /** Category of the targeted error; null for a miss (no error there). */
  category: ErrorCategory | null;
  outcome: ActionOutcome;
  /** When the action happened, in milliseconds. */
  timestamp: number;
  /** The error involved, when the action targeted a real error. */
  errorId?: string;
}

/** What the UI should do after a click is resolved. */
export type ClickInteraction =
  | { type: "spelling-dropdown"; error: GrammarError; options: readonly string[] }
  | { type: "punctuation-insert"; error: GrammarError; expected: string }
  | { type: "word-correct"; error: GrammarError; expected: string }
  | { type: "miss" };

/** A single entry in the retry-learning list shown on the report card. */
export interface RetryLearningItem {
  questionId: string;
  section: string;
  category: ErrorCategory;
  /** Plain description of what the player got wrong. */
  whatWasWrong: string;
  explanation: string;
  resource: ResourceReference;
}

/** Per-section score summary. */
export interface SectionScore {
  section: string;
  correct: number;
  attempts: number;
  /** 0..100 percentage of correct actions in the section. */
  percent: number;
}

/** A letter grade plus its word label, e.g. { grade: "C-", label: "Poor" }. */
export interface Grade {
  grade: string;
  label: string;
}

/** Per-category accuracy, used to pick strongest/weakest topics. */
export interface TopicStrength {
  category: ErrorCategory;
  correct: number;
  attempts: number;
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
  /** Filled in by the student on the UI; empty until signed. */
  studentSignature: string;
}
