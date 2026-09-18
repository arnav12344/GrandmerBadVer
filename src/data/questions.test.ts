import { describe, expect, it } from "vitest";
import { QUESTIONS, STANDARD_QUESTIONS } from "./questions";
import { resolveClick } from "../game/errors";
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

  it("every tagged error points at a valid token index", () => {
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        expect(e.tokenIndex).toBeGreaterThanOrEqual(0);
        expect(e.tokenIndex).toBeLessThan(q.tokens.length);
      }
    }
  });

  it("every spelling error's dropdown includes its correct fix", () => {
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        if (e.kind === "spelling") {
          expect(e.options).toBeDefined();
          expect(e.options).toContain(e.fix);
        }
      }
    }
  });

  it("resolveClick on each tagged error returns the right interaction kind", () => {
    for (const q of STANDARD_QUESTIONS) {
      for (const e of q.errors) {
        const result = resolveClick(q, e.tokenIndex);
        if (e.kind === "spelling") expect(result.type).toBe("spelling-dropdown");
        if (e.kind === "punctuation") expect(result.type).toBe("punctuation-insert");
        if (e.kind === "word") expect(result.type).toBe("word-correct");
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
