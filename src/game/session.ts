/*
 * Grandmer — session / game-state machine (FEAT-002).
 *
 * Pure, framework-free state for a full marking run. Tracks the current
 * question, elapsed time per question, recorded actions with timestamps, and
 * the running score. The per-question countdown itself is driven by the UI;
 * the state transitions ("timer ran out -> grade this question -> advance")
 * live here. Produces the final signed ReportCard.
 */

import {
  assignGrade,
  buildRetryLearning,
  computeAccuracy,
  computeBestCombo,
  computeSectionScores,
  computeSpeed,
  computeTotalScore,
  recordAction,
  strongestTopic,
  weakestTopic,
} from "./scoring";
import type {
  AnyQuestion,
  Grade,
  RecordedAction,
  ReportCard,
} from "./types";

/** Immutable-ish snapshot of a marking session. */
export interface GameState {
  questions: readonly AnyQuestion[];
  /** Index into questions of the question currently being marked. */
  currentIndex: number;
  /** All actions recorded so far, in order. */
  actions: readonly RecordedAction[];
  /** Milliseconds spent on each finished question, keyed by question id. */
  elapsedByQuestion: Readonly<Record<string, number>>;
  /** True once the final question has been graded. */
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

/** The question currently being marked, or undefined if finished. */
export function currentQuestion(state: GameState): AnyQuestion | undefined {
  return state.questions[state.currentIndex];
}

/** Record a single player action, returning a new state (pure). */
export function applyAction(
  state: GameState,
  action: RecordedAction,
): GameState {
  return { ...state, actions: recordAction(state.actions, action) };
}

/**
 * Grade the current question and advance to the next one. Called by the UI
 * when the per-question timer runs out (or the player ticks "next"). Records
 * how long the question took. When the last question is graded, marks the
 * session finished.
 */
export function gradeAndAdvance(
  state: GameState,
  elapsedMs: number,
): GameState {
  const question = currentQuestion(state);
  if (!question || state.finished) {
    return state;
  }

  const elapsedByQuestion = {
    ...state.elapsedByQuestion,
    [question.id]: elapsedMs,
  };
  const nextIndex = state.currentIndex + 1;
  const finished = nextIndex >= state.questions.length;

  return {
    ...state,
    elapsedByQuestion,
    currentIndex: finished ? state.currentIndex : nextIndex,
    finished,
  };
}

/**
 * Grade for a single question, measured against the errors actually present in
 * the paper — not just the ones the player chose to engage with. Catching 1 of
 * N errors and ignoring the rest must NOT grade as 100%; the stamp has to match
 * the "caught X of N" line shown beside it. Incorrect fixes also count against
 * the paper. The essay (no hidden-error set) has no meaningful grade, so it
 * returns the bottom band without penalising the run.
 */
export function gradeForQuestion(
  state: GameState,
  questionId: string,
): Grade {
  const question = state.questions.find((q) => q.id === questionId);
  const totalErrors =
    question && question.kind === "standard" ? question.errors.length : 0;
  if (totalErrors === 0) {
    return assignGrade(0);
  }
  const correct = state.actions.filter(
    (a) => a.questionId === questionId && a.outcome === "correct",
  ).length;
  // Cap at the number of real errors so re-clicks can't push past 100%.
  const caught = Math.min(correct, totalErrors);
  const percent = (caught / totalErrors) * 100;
  return assignGrade(percent);
}

/**
 * Produce the final Report Card from the accumulated state. `signature` is the
 * student's name written on the card by the UI (defaults to empty until signed).
 */
export function buildReportCard(
  state: GameState,
  signature = "",
): ReportCard {
  const { actions, questions } = state;

  const sectionScores = computeSectionScores(questions, actions);
  // Overall grade is caught-vs-total across every hidden error in the papers,
  // consistent with per-question grading. Engaging little but accurately must
  // not post a high overall grade when most errors were left uncaught. The
  // essay (free-for-all, no answer key) contributes no gradable errors.
  const totalErrors = questions.reduce(
    (sum, q) => sum + (q.kind === "standard" ? q.errors.length : 0),
    0,
  );
  const correctCount = actions.filter((a) => a.outcome === "correct").length;
  const caught = Math.min(correctCount, totalErrors);
  const overallPercent =
    totalErrors === 0 ? 0 : Math.round((caught / totalErrors) * 100);
  const { bestCombo, bonus } = computeBestCombo(actions);
  const wrongActions = actions.filter((a) => a.outcome === "incorrect");

  return {
    sectionScores,
    totalScore: computeTotalScore(actions),
    overallPercent,
    overallGrade: assignGrade(overallPercent),
    accuracy: computeAccuracy(actions),
    speedMsPerAction: computeSpeed(actions),
    bestCombo,
    comboBonus: bonus,
    strongestTopic: strongestTopic(actions),
    weakestTopic: weakestTopic(actions),
    retryLearning: buildRetryLearning(wrongActions, questions),
    studentSignature: signature,
  };
}
