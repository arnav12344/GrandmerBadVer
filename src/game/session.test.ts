import { describe, expect, it } from "vitest";
import {
  applyAction,
  buildReportCard,
  createSession,
  currentQuestion,
  gradeAndAdvance,
  gradeForQuestion,
} from "./session";
import type { AnyQuestion, RecordedAction } from "./types";

const questions: AnyQuestion[] = [
  {
    kind: "standard",
    id: "q1",
    section: "Section A",
    prompt: "",
    tokens: [
      { index: 0, text: "x" },
      { index: 1, text: "z" },
    ],
    errors: [
      {
        id: "e1",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 0,
        fix: "y",
        options: ["x", "y"],
        explanation: "why",
        resource: { title: "t", url: "u" },
      },
      {
        id: "e2",
        category: "spelling",
        kind: "spelling",
        tokenIndex: 1,
        fix: "w",
        options: ["z", "w"],
        explanation: "wut",
        resource: { title: "t", url: "u" },
      },
    ],
  },
  {
    kind: "essay",
    id: "q2",
    section: "Section B — Essay",
    prompt: "",
    text: "an essay",
    freeForAll: true,
    focusAreas: ["spelling"],
  },
];

describe("session lifecycle", () => {
  it("starts at the first question", () => {
    const s = createSession(questions);
    expect(s.currentIndex).toBe(0);
    expect(currentQuestion(s)?.id).toBe("q1");
    expect(s.finished).toBe(false);
  });

  it("grades and advances, recording elapsed time and finishing at the end", () => {
    let s = createSession(questions);
    s = gradeAndAdvance(s, 1200);
    expect(s.currentIndex).toBe(1);
    expect(s.elapsedByQuestion["q1"]).toBe(1200);
    expect(s.finished).toBe(false);

    s = gradeAndAdvance(s, 3400);
    expect(s.finished).toBe(true);
    expect(s.elapsedByQuestion["q2"]).toBe(3400);
  });

  it("grading after finished is a no-op", () => {
    let s = createSession(questions);
    s = gradeAndAdvance(s, 100);
    s = gradeAndAdvance(s, 100);
    const finished = s;
    expect(gradeAndAdvance(s, 999)).toBe(finished);
  });

  it("applyAction accumulates actions immutably", () => {
    const s0 = createSession(questions);
    const action: RecordedAction = {
      questionId: "q1",
      category: "spelling",
      outcome: "correct",
      timestamp: 0,
      errorId: "e1",
    };
    const s1 = applyAction(s0, action);
    expect(s1.actions).toHaveLength(1);
    expect(s0.actions).toHaveLength(0);
  });
});

describe("gradeForQuestion", () => {
  it("awards full marks only when EVERY error in the paper is caught", () => {
    let s = createSession(questions); // q1 has two hidden errors
    s = applyAction(s, {
      questionId: "q1",
      category: "spelling",
      outcome: "correct",
      timestamp: 0,
      errorId: "e1",
    });
    s = applyAction(s, {
      questionId: "q1",
      category: "spelling",
      outcome: "correct",
      timestamp: 10,
      errorId: "e2",
    });
    expect(gradeForQuestion(s, "q1")).toEqual({ grade: "A+", label: "Outstanding" });
  });

  it("grades against errors PRESENT, not just errors attempted (uncaught errors count against you)", () => {
    let s = createSession(questions); // q1 has two hidden errors
    // Catch one, ignore the other entirely. Old logic graded this 100% (A+)
    // because it divided by attempts; it must now be 50% -> not an A.
    s = applyAction(s, {
      questionId: "q1",
      category: "spelling",
      outcome: "correct",
      timestamp: 0,
      errorId: "e1",
    });
    const grade = gradeForQuestion(s, "q1");
    expect(grade.grade).not.toBe("A+");
    // 1 of 2 caught -> 50% -> bottom band, matching the "caught 1 of 2" line.
    expect(grade).toEqual({ grade: "F", label: "Keep Practising" });
  });

  it("does not exceed 100% if the same paper is over-clicked", () => {
    let s = createSession(questions);
    // Three correct recordings but only two real errors present.
    for (let i = 0; i < 3; i++) {
      s = applyAction(s, {
        questionId: "q1",
        category: "spelling",
        outcome: "correct",
        timestamp: i,
        errorId: i === 0 ? "e1" : "e2",
      });
    }
    expect(gradeForQuestion(s, "q1")).toEqual({ grade: "A+", label: "Outstanding" });
  });

  it("gives the essay (no answer key) a neutral bottom grade without any errors present", () => {
    const s = createSession(questions);
    expect(gradeForQuestion(s, "q2").grade).toBe("F");
  });
});

describe("buildReportCard", () => {
  it("produces a full signed report card", () => {
    let s = createSession(questions);
    const actions: RecordedAction[] = [
      { questionId: "q1", category: "spelling", outcome: "correct", timestamp: 0, errorId: "e1" },
      { questionId: "q1", category: "tense", outcome: "incorrect", timestamp: 500, errorId: "eX" },
      { questionId: "q1", category: null, outcome: "miss", timestamp: 900 },
    ];
    for (const a of actions) s = applyAction(s, a);

    const card = buildReportCard(s, "Alex Student");

    expect(card.studentSignature).toBe("Alex Student");
    expect(card.bestCombo).toBe(1);
    expect(card.comboBonus).toBeGreaterThan(0);
    expect(card.totalScore).toBeGreaterThan(0);
    // 1 correct out of 2 non-miss attempts -> 50%
    expect(card.overallPercent).toBe(50);
    expect(card.overallGrade.grade).toBe("F");
    expect(card.accuracy).toBeCloseTo(1 / 3, 5);
    expect(card.strongestTopic).toBe("spelling");
    expect(card.weakestTopic).toBe("tense");
    expect(card.sectionScores.length).toBeGreaterThan(0);
    // retry learning only surfaces real, known wrong errors (eX is unknown)
    expect(Array.isArray(card.retryLearning)).toBe(true);
  });

  it("defaults to an empty signature", () => {
    const s = createSession(questions);
    expect(buildReportCard(s).studentSignature).toBe("");
  });

  it("essay 'note' marks do not inflate score, accuracy, combo, or topic strength", () => {
    // A careful run: one genuine correct catch on q1.
    let careful = createSession(questions);
    careful = applyAction(careful, {
      questionId: "q1",
      category: "spelling",
      outcome: "correct",
      timestamp: 0,
      errorId: "e1",
    });
    const carefulCard = buildReportCard(careful);

    // The same run, but the player then spam-marks the essay free-for-all.
    let spammed = careful;
    for (let i = 0; i < 8; i++) {
      spammed = applyAction(spammed, {
        questionId: "q2",
        category: "spelling",
        outcome: "note",
        timestamp: 100 + i * 10,
      });
    }
    const spammedCard = buildReportCard(spammed);

    // Essay notes must be inert for the scored metrics: identical numbers.
    expect(spammedCard.totalScore).toBe(carefulCard.totalScore);
    expect(spammedCard.accuracy).toBeCloseTo(carefulCard.accuracy, 10);
    expect(spammedCard.bestCombo).toBe(carefulCard.bestCombo);
    expect(spammedCard.overallPercent).toBe(carefulCard.overallPercent);
    expect(spammedCard.strongestTopic).toBe(carefulCard.strongestTopic);
    // And no phantom "essay" section is created from the notes.
    expect(spammedCard.sectionScores).toEqual(carefulCard.sectionScores);
  });
});
