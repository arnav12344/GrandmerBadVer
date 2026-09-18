import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildReportCard,
  circledTokens,
  createSession,
  currentQuestion,
  finishRun,
  goToQuestion,
  nextQuestion,
  prevQuestion,
  toggleCircle,
} from "./session";
import type { AnyQuestion } from "./types";

const questions: AnyQuestion[] = [
  {
    kind: "standard",
    id: "q1",
    section: "Section A",
    prompt: "",
    tokens: [
      { index: 0, text: "x" },
      { index: 1, text: "z" },
      { index: 2, text: "ok" },
    ],
    errors: [
      {
        id: "e1",
        category: "spelling",
        tokenIndex: 0,
        explanation: "why",
        resource: { title: "t", url: "u" },
      },
      {
        id: "e2",
        category: "tense",
        tokenIndex: 1,
        explanation: "wut",
        resource: { title: "t", url: "u" },
      },
    ],
  },
  {
    kind: "standard",
    id: "q2",
    section: "Section B",
    prompt: "",
    tokens: [
      { index: 0, text: "a" },
      { index: 1, text: "b" },
    ],
    errors: [
      {
        id: "f1",
        category: "punctuation",
        tokenIndex: 0,
        explanation: "punc",
        resource: { title: "t", url: "u" },
      },
    ],
  },
  {
    kind: "essay",
    id: "q3",
    section: "Section C — Essay",
    prompt: "",
    text: "an essay",
    freeForAll: true,
    focusAreas: ["spelling"],
  },
];

describe("session lifecycle", () => {
  it("starts at the first paper and is not finished", () => {
    const s = createSession(questions);
    expect(s.currentIndex).toBe(0);
    expect(currentQuestion(s)?.id).toBe("q1");
    expect(s.finished).toBe(false);
  });

  it("applyAction accumulates actions immutably", () => {
    const s0 = createSession(questions);
    const s1 = applyAction(s0, {
      questionId: "q1",
      category: "spelling",
      outcome: "hit",
      tokenIndex: 0,
      errorId: "e1",
      timestamp: 0,
    });
    expect(s1.actions).toHaveLength(1);
    expect(s0.actions).toHaveLength(0);
  });
});

describe("page-flip navigation without grading", () => {
  it("moves next/prev without grading and clamps at the ends", () => {
    let s = createSession(questions);
    s = nextQuestion(s);
    expect(s.currentIndex).toBe(1);
    expect(s.finished).toBe(false);
    s = nextQuestion(s);
    expect(s.currentIndex).toBe(2);
    // Clamped at the last paper (does not finish).
    s = nextQuestion(s);
    expect(s.currentIndex).toBe(2);
    expect(s.finished).toBe(false);

    s = prevQuestion(s);
    expect(s.currentIndex).toBe(1);
    s = prevQuestion(s);
    s = prevQuestion(s);
    expect(s.currentIndex).toBe(0);
  });

  it("jumps to an arbitrary paper and accumulates elapsed time on leaving", () => {
    let s = createSession(questions);
    s = goToQuestion(s, 2, 1000);
    expect(s.currentIndex).toBe(2);
    expect(s.elapsedByQuestion["q1"]).toBe(1000);
    s = goToQuestion(s, 0, 500);
    expect(s.currentIndex).toBe(0);
    expect(s.elapsedByQuestion["q3"]).toBe(500);
  });

  it("ignores out-of-range jumps", () => {
    let s = createSession(questions);
    s = goToQuestion(s, 99);
    expect(s.currentIndex).toBe(0);
    s = goToQuestion(s, -1);
    expect(s.currentIndex).toBe(0);
  });
});

describe("toggleCircle — revisable circling", () => {
  it("records a hit when circling a real error", () => {
    let s = createSession(questions);
    s = toggleCircle(s, 0, 100); // token 0 is error e1
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0]).toMatchObject({
      questionId: "q1",
      outcome: "hit",
      errorId: "e1",
      category: "spelling",
      tokenIndex: 0,
    });
  });

  it("records a false alarm when circling a correct token", () => {
    let s = createSession(questions);
    s = toggleCircle(s, 2, 100); // token 2 is not an error
    expect(s.actions[0]).toMatchObject({
      outcome: "false-alarm",
      category: null,
      tokenIndex: 2,
    });
  });

  it("re-circling the same token removes it (revisable)", () => {
    let s = createSession(questions);
    s = toggleCircle(s, 0, 100);
    expect(circledTokens(s, "q1")).toEqual([0]);
    s = toggleCircle(s, 0, 200);
    expect(circledTokens(s, "q1")).toEqual([]);
    expect(s.actions).toHaveLength(0);
  });

  it("records essay circles as ungraded notes", () => {
    let s = createSession(questions);
    s = goToQuestion(s, 2);
    s = toggleCircle(s, 0, 100);
    expect(s.actions[0].outcome).toBe("note");
  });
});

describe("deferred grading", () => {
  it("does not grade until the run is finished", () => {
    let s = createSession(questions);
    s = toggleCircle(s, 0, 10); // catch e1 on q1
    expect(s.finished).toBe(false);
    // Nothing about finishing has happened just from circling.
    s = finishRun(s, 2000);
    expect(s.finished).toBe(true);
    expect(s.elapsedByQuestion["q1"]).toBe(2000);
  });

  it("finishRun is idempotent once finished", () => {
    let s = createSession(questions);
    s = finishRun(s, 100);
    const finished = s;
    expect(finishRun(s, 999)).toBe(finished);
  });
});

describe("buildReportCard", () => {
  it("populates hits / misses / falseAlarms and overall percent", () => {
    let s = createSession(questions);
    // q1: catch e1 (hit), false alarm on token 2, leave e2 (miss).
    s = toggleCircle(s, 0, 0);
    s = toggleCircle(s, 2, 100);
    // Flip to q2 and catch f1.
    s = goToQuestion(s, 1, 1000);
    s = toggleCircle(s, 0, 2000);
    s = finishRun(s, 500);

    const card = buildReportCard(s, "Alex Student");

    expect(card.studentSignature).toBe("Alex Student");
    // total errors = 3 (e1, e2, f1); caught e1 + f1 = 2 hits, 1 miss (e2).
    expect(card.hits).toBe(2);
    expect(card.misses).toBe(1);
    expect(card.falseAlarms).toBe(1);
    // overall = hits / total errors = 2/3 -> 67%
    expect(card.overallPercent).toBe(67);
    expect(card.overallGrade.grade).toBe("D+");
    // combo: e1 (hit) then false-alarm breaks, then f1 (hit) -> best combo 1.
    expect(card.bestCombo).toBe(1);
    expect(card.totalScore).toBeGreaterThan(0);
    // strongest is whichever caught category has the best rate; both caught
    // categories are at 100%, weakest is the uncaught tense category.
    expect(card.weakestTopic).toBe("tense");
    expect(card.sectionScores.length).toBe(2);
    // retry learning surfaces the uncaught e2.
    expect(card.retryLearning.some((r) => r.category === "tense")).toBe(true);
  });

  it("defaults to an empty signature", () => {
    const s = createSession(questions);
    expect(buildReportCard(s).studentSignature).toBe("");
  });

  it("essay circles are ungraded and do not change scored metrics", () => {
    let careful = createSession(questions);
    careful = toggleCircle(careful, 0, 0); // catch e1 on q1
    careful = finishRun(careful, 100);
    const carefulCard = buildReportCard(careful);

    // Same run but the student also circles all over the essay.
    let spammed = createSession(questions);
    spammed = toggleCircle(spammed, 0, 0);
    spammed = goToQuestion(spammed, 2, 10);
    for (let i = 0; i < 8; i++) spammed = toggleCircle(spammed, i, 100 + i * 10);
    spammed = finishRun(spammed, 100);
    const spammedCard = buildReportCard(spammed);

    expect(spammedCard.hits).toBe(carefulCard.hits);
    expect(spammedCard.misses).toBe(carefulCard.misses);
    expect(spammedCard.falseAlarms).toBe(carefulCard.falseAlarms);
    expect(spammedCard.overallPercent).toBe(carefulCard.overallPercent);
    expect(spammedCard.bestCombo).toBe(carefulCard.bestCombo);
    expect(spammedCard.sectionScores).toEqual(carefulCard.sectionScores);
  });
});
