import { describe, expect, it } from "vitest";
import {
  COMBO_BONUS_PER_STREAK,
  POINTS_PER_CORRECT,
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
import type { AnyQuestion, RecordedAction } from "./types";

function action(
  overrides: Partial<RecordedAction> & Pick<RecordedAction, "outcome">,
): RecordedAction {
  return {
    questionId: "q1",
    category: "spelling",
    timestamp: 0,
    ...overrides,
  };
}

describe("recordAction", () => {
  it("appends without mutating the original array", () => {
    const start: RecordedAction[] = [];
    const next = recordAction(start, action({ outcome: "correct" }));
    expect(next).toHaveLength(1);
    expect(start).toHaveLength(0);
  });
});

describe("assignGrade — full band boundaries", () => {
  it("returns A / Excellent at 93 and above", () => {
    expect(assignGrade(93)).toEqual({ grade: "A", label: "Excellent" });
    expect(assignGrade(95)).toEqual({ grade: "A", label: "Excellent" });
  });

  it("returns A+ / Outstanding at 97", () => {
    expect(assignGrade(97)).toEqual({ grade: "A+", label: "Outstanding" });
    expect(assignGrade(100)).toEqual({ grade: "A+", label: "Outstanding" });
  });

  it("returns exactly C- / Poor at the 70 boundary", () => {
    expect(assignGrade(70)).toEqual({ grade: "C-", label: "Poor" });
    expect(assignGrade(72)).toEqual({ grade: "C-", label: "Poor" });
  });

  it("just below 70 drops out of C-", () => {
    expect(assignGrade(69).grade).not.toBe("C-");
    expect(assignGrade(69).grade).toBe("D+");
  });

  it("returns F / Keep Practising at the bottom", () => {
    expect(assignGrade(0)).toEqual({ grade: "F", label: "Keep Practising" });
    expect(assignGrade(59)).toEqual({ grade: "F", label: "Keep Practising" });
  });

  it("clamps out-of-range percentages", () => {
    expect(assignGrade(150).grade).toBe("A+");
    expect(assignGrade(-20).grade).toBe("F");
  });
});

describe("computeBestCombo — longest consecutive-correct run", () => {
  it("finds the longest run and computes bonus", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }), // run 1
      action({ outcome: "incorrect" }), // break
      action({ outcome: "correct" }), // run
      action({ outcome: "correct" }),
      action({ outcome: "correct" }), // run of 3 (best)
      action({ outcome: "miss" }), // break
      action({ outcome: "correct" }), // run of 1
    ];
    const { bestCombo, bonus } = computeBestCombo(actions);
    expect(bestCombo).toBe(3);
    expect(bonus).toBe(3 * COMBO_BONUS_PER_STREAK);
  });

  it("a miss breaks a streak just like an incorrect answer", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "miss" }),
      action({ outcome: "correct" }),
    ];
    expect(computeBestCombo(actions).bestCombo).toBe(1);
  });

  it("returns zero combo for no correct answers", () => {
    expect(computeBestCombo([]).bestCombo).toBe(0);
    expect(
      computeBestCombo([action({ outcome: "incorrect" })]).bestCombo,
    ).toBe(0);
  });

  it("essay 'note' marks are neutral: they neither extend nor break a streak", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "note" }), // inert
      action({ outcome: "correct" }),
    ];
    // Without note-skipping this would be a broken 1-streak; it must stay 2.
    expect(computeBestCombo(actions).bestCombo).toBe(2);
    // And a run of pure notes can never manufacture a combo.
    expect(
      computeBestCombo([action({ outcome: "note" }), action({ outcome: "note" })])
        .bestCombo,
    ).toBe(0);
  });
});

describe("computeTotalScore — combo bonus is reflected in the score", () => {
  it("adds base points and combo bonus", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "correct" }),
      action({ outcome: "correct" }),
    ];
    const base = 3 * POINTS_PER_CORRECT;
    const bonus = 3 * COMBO_BONUS_PER_STREAK;
    expect(computeTotalScore(actions)).toBe(base + bonus);
  });

  it("a broken streak yields a smaller bonus than an unbroken one", () => {
    const unbroken: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "correct" }),
    ];
    const broken: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "incorrect" }),
      action({ outcome: "correct" }),
    ];
    expect(computeTotalScore(unbroken)).toBeGreaterThan(
      computeTotalScore(broken),
    );
  });
});

describe("computeAccuracy", () => {
  it("is correct / total attempts, misses count against it", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "correct" }),
      action({ outcome: "incorrect" }),
      action({ outcome: "miss" }),
    ];
    expect(computeAccuracy(actions)).toBeCloseTo(0.5, 5);
  });

  it("is 0 with no actions", () => {
    expect(computeAccuracy([])).toBe(0);
  });

  it("ignores ungraded essay 'note' marks entirely (neither correct nor attempt)", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct" }),
      action({ outcome: "incorrect" }),
      // A pile of essay notes must not move accuracy in either direction.
      action({ outcome: "note" }),
      action({ outcome: "note" }),
      action({ outcome: "note" }),
    ];
    expect(computeAccuracy(actions)).toBeCloseTo(0.5, 5);
  });

  it("is 0 when only essay notes were recorded", () => {
    expect(
      computeAccuracy([action({ outcome: "note" }), action({ outcome: "note" })]),
    ).toBe(0);
  });
});

describe("computeSpeed — average ms per action from timestamps", () => {
  it("averages the intervals between timestamps", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct", timestamp: 0 }),
      action({ outcome: "correct", timestamp: 1000 }),
      action({ outcome: "correct", timestamp: 4000 }),
    ];
    // span 4000ms over 2 intervals -> 2000ms/action
    expect(computeSpeed(actions)).toBe(2000);
  });

  it("is order-independent (sorts by timestamp)", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "correct", timestamp: 4000 }),
      action({ outcome: "correct", timestamp: 0 }),
      action({ outcome: "correct", timestamp: 1000 }),
    ];
    expect(computeSpeed(actions)).toBe(2000);
  });

  it("needs two actions to measure an interval", () => {
    expect(computeSpeed([action({ outcome: "correct" })])).toBe(0);
  });
});

describe("strongest & weakest topic — per-category accuracy", () => {
  const actions: RecordedAction[] = [
    // spelling: 2/2 = 1.0 (strongest)
    action({ category: "spelling", outcome: "correct" }),
    action({ category: "spelling", outcome: "correct" }),
    // tense: 1/2 = 0.5
    action({ category: "tense", outcome: "correct" }),
    action({ category: "tense", outcome: "incorrect" }),
    // punctuation: 0/2 = 0.0 (weakest)
    action({ category: "punctuation", outcome: "incorrect" }),
    action({ category: "punctuation", outcome: "incorrect" }),
    // a pure miss with no category must not create a phantom topic
    action({ category: null, outcome: "miss" }),
  ];

  it("picks the highest-accuracy category as strongest", () => {
    expect(strongestTopic(actions)).toBe("spelling");
  });

  it("picks the lowest-accuracy category as weakest", () => {
    expect(weakestTopic(actions)).toBe("punctuation");
  });

  it("returns null when there are no categorised actions", () => {
    expect(strongestTopic([])).toBeNull();
    expect(weakestTopic([action({ category: null, outcome: "miss" })])).toBeNull();
  });

  it("ignores essay 'note' marks so they cannot fabricate a strongest topic", () => {
    const actions: RecordedAction[] = [
      // tense is genuinely the only graded, correct topic.
      action({ category: "tense", outcome: "correct" }),
      // A flood of preposition notes must NOT become the strongest topic.
      action({ category: "preposition", outcome: "note" }),
      action({ category: "preposition", outcome: "note" }),
      action({ category: "preposition", outcome: "note" }),
    ];
    expect(strongestTopic(actions)).toBe("tense");
  });
});

describe("computeSectionScores", () => {
  const questions: AnyQuestion[] = [
    {
      kind: "standard",
      id: "qA",
      section: "Section A",
      prompt: "",
      tokens: [],
      errors: [],
    },
    {
      kind: "standard",
      id: "qB",
      section: "Section B",
      prompt: "",
      tokens: [],
      errors: [],
    },
  ];

  it("summarises correct/attempts/percent per section, ignoring misses", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "correct" }),
      action({ questionId: "qA", outcome: "incorrect" }),
      action({ questionId: "qA", outcome: "miss" }), // ignored for section stats
      action({ questionId: "qB", outcome: "correct" }),
    ];
    const scores = computeSectionScores(questions, actions);
    expect(scores).toEqual([
      { section: "Section A", correct: 1, attempts: 2, percent: 50 },
      { section: "Section B", correct: 1, attempts: 1, percent: 100 },
    ]);
  });

  it("excludes essay 'note' marks so the essay never creates a phantom section", () => {
    const withEssay: AnyQuestion[] = [
      ...questions,
      {
        kind: "essay",
        id: "qEssay",
        section: "Section G — Essay",
        prompt: "",
        text: "essay",
        freeForAll: true,
        focusAreas: ["spelling"],
      },
    ];
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "correct" }),
      action({ questionId: "qEssay", category: "spelling", outcome: "note" }),
      action({ questionId: "qEssay", category: "spelling", outcome: "note" }),
    ];
    const scores = computeSectionScores(withEssay, actions);
    expect(scores.map((s) => s.section)).toEqual(["Section A"]);
  });
});

describe("buildRetryLearning — only wrong answers, each with help", () => {
  const questions: AnyQuestion[] = [
    {
      kind: "standard",
      id: "qX",
      section: "Section X",
      prompt: "",
      tokens: [{ index: 0, text: "teh" }],
      errors: [
        {
          id: "err-1",
          category: "spelling",
          kind: "spelling",
          tokenIndex: 0,
          fix: "the",
          options: ["teh", "the"],
          explanation: "Spelling of 'the'.",
          resource: { title: "Spelling", url: "https://example.com/spelling" },
        },
      ],
    },
  ];

  it("includes an item only for incorrect actions, with explanation + resource", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qX", category: "spelling", outcome: "correct", errorId: "err-1" }),
      action({ questionId: "qX", category: "spelling", outcome: "incorrect", errorId: "err-1" }),
      action({ questionId: "qX", category: null, outcome: "miss" }),
    ];
    const wrong = actions.filter((a) => a.outcome === "incorrect");
    const items = buildRetryLearning(wrong, questions);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      questionId: "qX",
      section: "Section X",
      category: "spelling",
      explanation: "Spelling of 'the'.",
      resource: { title: "Spelling", url: "https://example.com/spelling" },
    });
    expect(items[0].whatWasWrong).toContain("the");
  });

  it("excludes correct answers and misses entirely", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qX", category: "spelling", outcome: "correct", errorId: "err-1" }),
    ];
    expect(buildRetryLearning(actions, questions)).toHaveLength(0);
  });
});
