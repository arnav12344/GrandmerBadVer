/*
 * Grandmer — click resolution & fix checking (FEAT-002).
 *
 * Pure functions, no DOM. resolveClick tells the UI what interaction a clicked
 * token triggers; checkFix validates the player's submitted correction.
 * Clicking a location that is NOT an error is a non-shaming miss.
 */

import type {
  ClickInteraction,
  GrammarError,
  Question,
} from "./types";

/** Find the hidden error (if any) at a token index in a standard question. */
export function errorAt(
  question: Question,
  tokenIndex: number,
): GrammarError | undefined {
  return question.errors.find((e) => e.tokenIndex === tokenIndex);
}

/**
 * Resolve a click on a token/gap.
 *
 * - Spelling error  -> { type: "spelling-dropdown", options } (options include the fix)
 * - Punctuation gap -> { type: "punctuation-insert", expected } (e.g. ".")
 * - Word error      -> { type: "word-correct", expected }
 * - No error there  -> { type: "miss" } (harmless, non-shaming)
 */
export function resolveClick(
  question: Question,
  tokenIndex: number,
): ClickInteraction {
  const error = errorAt(question, tokenIndex);
  if (!error) {
    return { type: "miss" };
  }

  switch (error.kind) {
    case "spelling": {
      // Options should always include the correct fix; guarantee it defensively.
      const provided = error.options ?? [error.fix];
      const options = provided.includes(error.fix)
        ? provided
        : [...provided, error.fix];
      return { type: "spelling-dropdown", error, options };
    }
    case "punctuation":
      return { type: "punctuation-insert", error, expected: error.fix };
    case "word":
      return { type: "word-correct", error, expected: error.fix };
  }
}

/** Normalise a submitted fix for lenient, case-insensitive comparison. */
function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Check whether a submitted fix correctly resolves the given error.
 * Comparison is trimmed and case-insensitive so "Went" matches "went".
 */
export function checkFix(error: GrammarError, submittedFix: string): boolean {
  return normalise(submittedFix) === normalise(error.fix);
}
