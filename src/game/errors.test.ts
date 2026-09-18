import { describe, expect, it } from "vitest";
import { checkFix, errorAt, resolveClick } from "./errors";
import type { Question } from "./types";

const question: Question = {
  kind: "standard",
  id: "q",
  section: "Test",
  prompt: "",
  tokens: [
    { index: 0, text: "definately" },
    { index: 1, text: "went" },
    { index: 2, text: "", isGap: true },
    { index: 3, text: "to" },
  ],
  errors: [
    {
      id: "e-spell",
      category: "spelling",
      kind: "spelling",
      tokenIndex: 0,
      fix: "definitely",
      options: ["definately", "definitely", "definitly"],
      explanation: "sp",
      resource: { title: "t", url: "u" },
    },
    {
      id: "e-punc",
      category: "punctuation",
      kind: "punctuation",
      tokenIndex: 2,
      fix: ".",
      explanation: "pu",
      resource: { title: "t", url: "u" },
    },
    {
      id: "e-word",
      category: "preposition",
      kind: "word",
      tokenIndex: 3,
      fix: "at",
      explanation: "wo",
      resource: { title: "t", url: "u" },
    },
  ],
};

describe("resolveClick", () => {
  it("spelling click resolves to a dropdown containing the correct option", () => {
    const result = resolveClick(question, 0);
    expect(result.type).toBe("spelling-dropdown");
    if (result.type === "spelling-dropdown") {
      expect(result.options).toContain("definitely");
      expect(result.error.id).toBe("e-spell");
    }
  });

  it("punctuation click resolves to insert with the expected mark", () => {
    const result = resolveClick(question, 2);
    expect(result.type).toBe("punctuation-insert");
    if (result.type === "punctuation-insert") {
      expect(result.expected).toBe(".");
    }
  });

  it("word click resolves to word-correct with the expected word", () => {
    const result = resolveClick(question, 3);
    expect(result.type).toBe("word-correct");
    if (result.type === "word-correct") {
      expect(result.expected).toBe("at");
    }
  });

  it("clicking a non-error token is a harmless miss", () => {
    const result = resolveClick(question, 1);
    expect(result).toEqual({ type: "miss" });
  });

  it("guarantees the correct fix is present in dropdown options", () => {
    const q: Question = {
      ...question,
      errors: [
        {
          id: "e",
          category: "spelling",
          kind: "spelling",
          tokenIndex: 0,
          fix: "definitely",
          options: ["definately", "definitly"], // missing the fix
          explanation: "",
          resource: { title: "t", url: "u" },
        },
      ],
    };
    const result = resolveClick(q, 0);
    if (result.type === "spelling-dropdown") {
      expect(result.options).toContain("definitely");
    } else {
      throw new Error("expected spelling-dropdown");
    }
  });
});

describe("errorAt", () => {
  it("finds the error at a token index", () => {
    expect(errorAt(question, 0)?.id).toBe("e-spell");
    expect(errorAt(question, 1)).toBeUndefined();
  });
});

describe("checkFix", () => {
  const spell = question.errors[0];
  const punc = question.errors[1];

  it("accepts the correct spelling", () => {
    expect(checkFix(spell, "definitely")).toBe(true);
  });

  it("accepts the correct punctuation mark", () => {
    expect(checkFix(punc, ".")).toBe(true);
  });

  it("rejects a wrong fix", () => {
    expect(checkFix(spell, "definately")).toBe(false);
    expect(checkFix(punc, ",")).toBe(false);
  });

  it("is trimmed and case-insensitive", () => {
    expect(checkFix(question.errors[2], "  At ")).toBe(true);
  });
});
