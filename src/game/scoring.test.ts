import { describe, expect, it } from "vitest";
import {
  COMBO_BONUS_PER_STREAK,
  POINTS_PER_HIT,
  assignGrade,
  baseScore,
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
  strongestTopic,
  weakestTopic,
} from "./scoring";
import type { AnyQuestion, ErrorCategory, RecordedAction } from "./types";

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

/** Build a standard paper with a list of [tokenIndex, category] errors. */
function paper(
  id: string,
  section: string,
  errors: Array<{ id: string; tokenIndex: number; category: ErrorCategory }>,
): AnyQuestion {
  return {
    kind: "standard",
    id,
    section,
    prompt: "",
    tokens: Array.from({ length: 12 }, (_, i) => ({ index: i, text: `w${i}` })),
    errors: errors.map((e) => ({
      id: e.id,
      category: e.category,
      tokenIndex: e.tokenIndex,
      explanation: `explain ${e.id}`,
      resource: { title: `res ${e.id}`, url: `https://example.com/${e.id}` },
    })),
  };
}

describe("recordAction", () => {
  it("appends without mutating the original array", () => {
    const start: RecordedAction[] = [];
    const next = recordAction(start, action({ outcome: "hit" }));
    expect(next).toHaveLength(1);
    expect(start).toHaveLength(0);
  });
});

describe("hit / false-alarm / miss derivation", () => {
  const questions = [
    paper("qA", "Section A", [
      { id: "a1", tokenIndex: 0, category: "spelling" },
      { id: "a2", tokenIndex: 1, category: "tense" },
    ]),
  ];

  it("counts hits and false alarms from the recorded circles", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1", category: "spelling" }),
      action({ questionId: "qA", outcome: "false-alarm", category: null, tokenIndex: 5 }),
    ];
    expect(countHits(actions)).toBe(1);
    expect(countFalseAlarms(actions)).toBe(1);
  });

  it("derives misses as real errors never circled", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1", category: "spelling" }),
    ];
    // a2 was never circled -> one miss.
    expect(countMisses(questions, actions)).toBe(1);
  });

  it("does not double-count re-circling the same error as extra catches", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1" }),
      action({ questionId: "qA", outcome: "hit", errorId: "a1" }),
    ];
    // Only a1 is caught, a2 still missed.
    expect(countMisses(questions, actions)).toBe(1);
  });
});

describe("assignGrade — full band boundaries (preserved byte-for-byte)", () => {
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

describe("computeBestCombo — longest consecutive-hit run", () => {
  it("finds the longest run of hits and computes bonus", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit" }), // run 1
      action({ outcome: "false-alarm" }), // break
      action({ outcome: "hit" }),
      action({ outcome: "hit" }),
      action({ outcome: "hit" }), // run of 3 (best)
      action({ outcome: "false-alarm" }), // break
      action({ outcome: "hit" }), // run of 1
    ];
    const { bestCombo, bonus } = computeBestCombo(actions);
    expect(bestCombo).toBe(3);
    expect(bonus).toBe(3 * COMBO_BONUS_PER_STREAK);
  });

  it("a false alarm breaks a streak", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit" }),
      action({ outcome: "false-alarm" }),
      action({ outcome: "hit" }),
    ];
    expect(computeBestCombo(actions).bestCombo).toBe(1);
  });

  it("returns zero combo with no hits", () => {
    expect(computeBestCombo([]).bestCombo).toBe(0);
    expect(
      computeBestCombo([action({ outcome: "false-alarm" })]).bestCombo,
    ).toBe(0);
  });
});

describe("computeTotalScore — combo + speed weighting", () => {
  it("adds base points and combo bonus", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 20_000 }),
      action({ outcome: "hit", timestamp: 40_000 }),
    ];
    // Slow catches (20s apart) earn no speed bonus, so score is base + combo.
    const base = 3 * POINTS_PER_HIT;
    const bonus = 3 * COMBO_BONUS_PER_STREAK;
    expect(computeTotalScore(actions)).toBe(base + bonus);
  });

  it("a broken streak yields a smaller bonus than an unbroken one", () => {
    const unbroken: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 20_000 }),
    ];
    const broken: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "false-alarm", timestamp: 20_000 }),
      action({ outcome: "hit", timestamp: 40_000 }),
    ];
    expect(computeTotalScore(unbroken)).toBeGreaterThan(
      computeTotalScore(broken),
    );
  });

  it("faster catches score higher than slower ones (speed weighting)", () => {
    const fast: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 500 }),
    ];
    const slow: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 30_000 }),
    ];
    expect(computeTotalScore(fast)).toBeGreaterThan(computeTotalScore(slow));
  });

  it("base score counts only hits", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit" }),
      action({ outcome: "false-alarm" }),
    ];
    expect(baseScore(actions)).toBe(POINTS_PER_HIT);
  });
});

describe("computeAccuracy — hits / (hits + false alarms + misses)", () => {
  const questions = [
    paper("qA", "Section A", [
      { id: "a1", tokenIndex: 0, category: "spelling" },
      { id: "a2", tokenIndex: 1, category: "tense" },
    ]),
  ];

  it("lowers accuracy for both false alarms and misses", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1" }),
      action({ questionId: "qA", outcome: "false-alarm", category: null }),
    ];
    // hits 1, false alarms 1, misses 1 (a2) -> 1/3
    expect(computeAccuracy(actions, questions)).toBeCloseTo(1 / 3, 5);
  });

  it("is 1 when every error is caught and nothing else is circled", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1" }),
      action({ questionId: "qA", outcome: "hit", errorId: "a2" }),
    ];
    expect(computeAccuracy(actions, questions)).toBe(1);
  });

  it("is 0 with no actions and no questions", () => {
    expect(computeAccuracy([])).toBe(0);
  });
});

describe("computeSpeed — average ms per action from timestamps", () => {
  it("averages the intervals between timestamps", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 1000 }),
      action({ outcome: "hit", timestamp: 4000 }),
    ];
    expect(computeSpeed(actions)).toBe(2000);
  });

  it("is order-independent (sorts by timestamp)", () => {
    const actions: RecordedAction[] = [
      action({ outcome: "hit", timestamp: 4000 }),
      action({ outcome: "hit", timestamp: 0 }),
      action({ outcome: "hit", timestamp: 1000 }),
    ];
    expect(computeSpeed(actions)).toBe(2000);
  });

  it("needs two actions to measure an interval", () => {
    expect(computeSpeed([action({ outcome: "hit" })])).toBe(0);
  });
});

describe("strongest & weakest topic — per-category catch rate", () => {
  const questions = [
    paper("qA", "Section A", [
      { id: "s1", tokenIndex: 0, category: "spelling" },
      { id: "s2", tokenIndex: 1, category: "spelling" },
      { id: "t1", tokenIndex: 2, category: "tense" },
      { id: "t2", tokenIndex: 3, category: "tense" },
      { id: "p1", tokenIndex: 4, category: "punctuation" },
      { id: "p2", tokenIndex: 5, category: "punctuation" },
    ]),
  ];

  // spelling: 2/2 = 1.0 (strongest), tense: 1/2 = 0.5, punctuation: 0/2 = 0.0
  const actions: RecordedAction[] = [
    action({ questionId: "qA", outcome: "hit", errorId: "s1", category: "spelling" }),
    action({ questionId: "qA", outcome: "hit", errorId: "s2", category: "spelling" }),
    action({ questionId: "qA", outcome: "hit", errorId: "t1", category: "tense" }),
    // t2, p1, p2 never circled.
  ];

  it("picks the highest catch-rate category as strongest", () => {
    expect(strongestTopic(questions, actions)).toBe("spelling");
  });

  it("picks the lowest catch-rate category as weakest", () => {
    expect(weakestTopic(questions, actions)).toBe("punctuation");
  });

  it("returns null when there are no categorised errors", () => {
    expect(strongestTopic([], [])).toBeNull();
    expect(weakestTopic([], [])).toBeNull();
  });
});

describe("computeSectionScores — hits vs total errors per section", () => {
  const questions = [
    paper("qA", "Section A", [
      { id: "a1", tokenIndex: 0, category: "spelling" },
      { id: "a2", tokenIndex: 1, category: "tense" },
    ]),
    paper("qB", "Section B", [
      { id: "b1", tokenIndex: 0, category: "punctuation" },
    ]),
    {
      kind: "essay",
      id: "qEssay",
      section: "Section G — Essay",
      prompt: "",
      text: "essay",
      freeForAll: true,
      focusAreas: ["spelling"],
    } as AnyQuestion,
  ];

  it("summarises caught/total/percent per section, false alarms do not raise it", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qA", outcome: "hit", errorId: "a1" }),
      action({ questionId: "qA", outcome: "false-alarm", category: null }),
      action({ questionId: "qB", outcome: "hit", errorId: "b1" }),
    ];
    const scores = computeSectionScores(questions, actions);
    expect(scores).toEqual([
      { section: "Section A", correct: 1, attempts: 2, percent: 50 },
      { section: "Section B", correct: 1, attempts: 1, percent: 100 },
    ]);
  });

  it("never creates a section for the essay (no errors)", () => {
    const scores = computeSectionScores(questions, []);
    expect(scores.map((s) => s.section)).toEqual(["Section A", "Section B"]);
  });
});

describe("buildRetryLearning — missed and false-alarmed errors, each with help", () => {
  const questions = [
    paper("qX", "Section X", [
      { id: "err-1", tokenIndex: 0, category: "spelling" },
      { id: "err-2", tokenIndex: 1, category: "tense" },
    ]),
  ];

  it("surfaces every error the student did NOT catch, with explanation + resource", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qX", outcome: "hit", errorId: "err-1", category: "spelling" }),
      // err-2 never circled -> should appear in retry learning.
    ];
    const items = buildRetryLearning(questions, actions);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      questionId: "qX",
      section: "Section X",
      category: "tense",
      explanation: "explain err-2",
      resource: { title: "res err-2", url: "https://example.com/err-2" },
    });
    expect(items[0].whatWasWrong.length).toBeGreaterThan(0);
  });

  it("excludes errors that were caught cleanly", () => {
    const actions: RecordedAction[] = [
      action({ questionId: "qX", outcome: "hit", errorId: "err-1" }),
      action({ questionId: "qX", outcome: "hit", errorId: "err-2" }),
    ];
    expect(buildRetryLearning(questions, actions)).toHaveLength(0);
  });
});
