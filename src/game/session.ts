/*
 * Grandmer — session / game-state machine (FEAT-001 rework).
 *
 * Pure, framework-free state for a full marking run. Tracks the current paper,
 * elapsed time per paper, recorded circles with timestamps, and whether the run
 * is finished. Grading is DEFERRED: the student can flip back and forth between
 * papers and revise their circles, and nothing is graded until the run is
 * finished. Produces the final signed ReportCard.
 */

import {
  assignGrade,
  buildRetryLearning,
  computeAccuracy,
  computeBestCombo,
  computeSectionScores,
  computeSpeed,
  computeTotalScore,
  countFalseAlarms,
  countHits,
  countMisses,
  recordAction,
  totalErrors as totalRealErrors,
  strongestTopic,
  weakestTopic,
} from "./scoring";
import type {
  AnyQuestion,
  Question,
  RecordedAction,
  ReportCard,
} from "./types";

/** Immutable-ish snapshot of a marking session. */
export interface GameState {
  questions: readonly AnyQuestion[];
  /** Index into questions of the paper currently being marked / reviewed. */
  currentIndex: number;
  /** All circles recorded so far, in order. */
  actions: readonly RecordedAction[];
  /** Milliseconds spent on each paper, keyed by question id. */
  elapsedByQuestion: Readonly<Record<string, number>>;
  /** True once the run has been finished (grading happens only then). */
  finished: boolean;
}

/** Start a new session over the given question set. */
export function createSession(questions: readonly AnyQuestion[]): GameState {
  return {
    questions,
    currentIndex: 0,
    actions: [],
    elapsedByQuestion: {},
    finished: questions.length === 0,
  };
}

/** The paper currently being marked, or undefined if none. */
export function currentQuestion(state: GameState): AnyQuestion | undefined {
  return state.questions[state.currentIndex];
}

/** Record a single player action (a resolved circle), returning a new state. */
export function applyAction(
  state: GameState,
  action: RecordedAction,
): GameState {
  return { ...state, actions: recordAction(state.actions, action) };
}

/**
 * Find the error (if any) at a token index within a standard paper. Used to
 * resolve a circle to a hit or a false alarm at record time.
 */
function errorAtToken(
  question: Question,
  tokenIndex: number,
): Question["errors"][number] | undefined {
  return question.errors.find((e) => e.tokenIndex === tokenIndex);
}

/**
 * Toggle a circle on a token of the CURRENT paper. Circling revises freely:
 * circling a token that is already circled REMOVES it (revisable), otherwise it
 * records a new circle resolved to a hit or a false alarm. Returns a new state.
 * Circles on the essay (no answer key) are recorded but ungraded.
 */
export function toggleCircle(
  state: GameState,
  tokenIndex: number,
  timestamp: number = Date.now(),
): GameState {
  const question = currentQuestion(state);
  if (!question) return state;

  const existingIndex = state.actions.findIndex(
    (a) => a.questionId === question.id && a.tokenIndex === tokenIndex,
  );
  if (existingIndex !== -1) {
    // Re-circling the same token removes it.
    const actions = state.actions.filter((_, i) => i !== existingIndex);
    return { ...state, actions };
  }

  if (question.kind === "essay") {
    // The essay is ungraded; record the circle as an inert note for the record.
    return applyAction(state, {
      questionId: question.id,
      category: null,
      outcome: "note",
      tokenIndex,
      timestamp,
    });
  }

  const error = errorAtToken(question, tokenIndex);
  return applyAction(state, {
    questionId: question.id,
    category: error ? error.category : null,
    outcome: error ? "hit" : "false-alarm",
    tokenIndex,
    errorId: error?.id,
    timestamp,
  });
}

/** The token indices currently circled on the given paper. */
export function circledTokens(
  state: GameState,
  questionId: string,
): number[] {
  return state.actions
    .filter((a) => a.questionId === questionId && a.tokenIndex !== undefined)
    .map((a) => a.tokenIndex as number);
}

/**
 * Jump to an arbitrary paper index WITHOUT grading (page flipping). Records how
 * long the paper being left was viewed by ADDING to its elapsed total. Ignored
 * once the run is finished or when the index is out of range.
 */
export function goToQuestion(
  state: GameState,
  index: number,
  elapsedMs = 0,
): GameState {
  if (state.finished) return state;
  if (index < 0 || index >= state.questions.length) return state;
  if (index === state.currentIndex) return state;

  const leaving = state.questions[state.currentIndex];
  const elapsedByQuestion = leaving
    ? {
        ...state.elapsedByQuestion,
        [leaving.id]: (state.elapsedByQuestion[leaving.id] ?? 0) + elapsedMs,
      }
    : state.elapsedByQuestion;

  return { ...state, currentIndex: index, elapsedByQuestion };
}

/** Flip to the next paper without grading (clamped at the last paper). */
export function nextQuestion(state: GameState, elapsedMs = 0): GameState {
  return goToQuestion(
    state,
    Math.min(state.currentIndex + 1, state.questions.length - 1),
    elapsedMs,
  );
}

/** Flip to the previous paper without grading (clamped at the first paper). */
export function prevQuestion(state: GameState, elapsedMs = 0): GameState {
  return goToQuestion(state, Math.max(state.currentIndex - 1, 0), elapsedMs);
}

/**
 * Finish the run. Grading only happens after this. Records elapsed time on the
 * current paper and marks the session finished. Idempotent once finished.
 */
export function finishRun(state: GameState, elapsedMs = 0): GameState {
  if (state.finished) return state;
  const current = currentQuestion(state);
  const elapsedByQuestion = current
    ? {
        ...state.elapsedByQuestion,
        [current.id]: (state.elapsedByQuestion[current.id] ?? 0) + elapsedMs,
      }
    : state.elapsedByQuestion;
  return { ...state, elapsedByQuestion, finished: true };
}

/**
 * Produce the final Report Card from the accumulated state. `signature` is the
 * student's name written on the card by the UI (defaults to empty until signed).
 *
 * Overall percent = distinct caught errors / total real errors across all
 * papers. Both halves are derived from the SAME distinct-caught-errorId set
 * that countMisses uses (real errors = caught + missed), so the overall percent
 * provably agrees with the section and topic views instead of relying on the
 * raw hit-action count happening to equal the distinct-caught count. `hits`
 * (the raw hit-action count) is still reported as a standalone stat.
 */
export function buildReportCard(
  state: GameState,
  signature = "",
): ReportCard {
  const { actions, questions } = state;

  const sectionScores = computeSectionScores(questions, actions);

  const hits = countHits(actions);
  const misses = countMisses(questions, actions);
  const falseAlarms = countFalseAlarms(actions);
  // Distinct real errors that were caught, from the same set countMisses uses.
  const caught = totalRealErrors(questions) - misses;
  const totalErrors = caught + misses; // every real error is either caught or missed
  const overallPercent =
    totalErrors === 0 ? 0 : Math.round((caught / totalErrors) * 100);

  const { bestCombo, bonus } = computeBestCombo(actions);

  return {
    sectionScores,
    totalScore: computeTotalScore(actions),
    overallPercent,
    overallGrade: assignGrade(overallPercent),
    accuracy: computeAccuracy(actions, questions),
    speedMsPerAction: computeSpeed(actions),
    bestCombo,
    comboBonus: bonus,
    strongestTopic: strongestTopic(questions, actions),
    weakestTopic: weakestTopic(questions, actions),
    retryLearning: buildRetryLearning(questions, actions),
    hits,
    misses,
    falseAlarms,
    studentSignature: signature,
  };
}
