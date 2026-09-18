import { describe, expect, it } from "vitest";
import { QUESTIONS, STANDARD_QUESTIONS } from "./questions";
import type { ErrorCategory } from "../game/types";

describe("curated question set", () => {
  it("has multiple standard questions plus a final essay free-for-all", () => {
    expect(STANDARD_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    const last = QUESTIONS[QUESTIONS.length - 1];
    expect(last.kind).toBe("essay");
    if (last.kind === "essay") {
      expect(last.freeForAll).toBe(true);
    }
  });

  it("covers all five error categories across the standard questions", () => {
    const categories = new Set<ErrorCategory>();
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) categories.add(e.category);
    }
    expect([...categories].sort()).toEqual(
      [
        "preposition",
        "punctuation",
        "sentence-structure",
        "spelling",
        "tense",
      ].sort(),
    );
  });

  it("every tagged error points at a valid token index (the answer key)", () => {
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        expect(e.tokenIndex).toBeGreaterThanOrEqual(0);
        expect(e.tokenIndex).toBeLessThan(q.tokens.length);
      }
    }
  });

  it("no two errors in a paper target the same token", () => {
    for (const q of STANDARD_QUESTIONS) {
      const seen = new Set<number>();
      for (const e of q.errors) {
        expect(seen.has(e.tokenIndex)).toBe(false);
        seen.add(e.tokenIndex);
      }
    }
  });

  it("keeps punctuation gaps as circle-able targets", () => {
    // Every punctuation error should sit on a gap token (a missing-mark spot),
    // which is still a token the student can lasso.
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        if (e.category === "punctuation") {
          const token = q.tokens[e.tokenIndex];
          expect(token).toBeDefined();
          expect(token.isGap).toBe(true);
        }
      }
    }
  });

  it("every error carries a non-empty explanation and resource", () => {
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        expect(e.explanation.length).toBeGreaterThan(0);
        expect(e.resource.title.length).toBeGreaterThan(0);
        expect(e.resource.url.length).toBeGreaterThan(0);
      }
    }
  });
});
