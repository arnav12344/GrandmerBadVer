import { describe, expect, it } from "vitest";
import {
  enclosedFraction,
  isBoxCircled,
  pointInPolygon,
  resolveLasso,
  type Point,
  type WordBox,
} from "./lasso";

/** A square loop from (0,0) to (100,100). */
const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("pointInPolygon — ray casting", () => {
  it("reports a point clearly inside the loop", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
  });

  it("reports a point clearly outside the loop", () => {
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: -5, y: 50 }, square)).toBe(false);
  });

  it("handles a concave (C-shaped) polygon", () => {
    // A C / horseshoe opening to the right: the mouth of the C is outside.
    const cShape: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 10, y: 50 }, cShape)).toBe(true); // inside the spine
    expect(pointInPolygon({ x: 60, y: 50 }, cShape)).toBe(false); // in the mouth
  });

  it("returns false for a degenerate polygon (fewer than 3 points)", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe(
      false,
    );
  });
});

describe("enclosedFraction — sampled box coverage", () => {
  it("is 1 for a box fully inside the loop", () => {
    const box: WordBox = { index: 0, x: 20, y: 20, width: 40, height: 40 };
    expect(enclosedFraction(box, square)).toBe(1);
  });

  it("is 0 for a box fully outside the loop", () => {
    const box: WordBox = { index: 0, x: 200, y: 200, width: 40, height: 40 };
    expect(enclosedFraction(box, square)).toBe(0);
  });

  it("is a middling fraction for a half-in box", () => {
    // Box straddles the right edge: roughly half of it is inside.
    const box: WordBox = { index: 0, x: 75, y: 25, width: 50, height: 50 };
    const frac = enclosedFraction(box, square);
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(1);
  });
});

describe("isBoxCircled", () => {
  it("circles a word whose centre is inside the loop", () => {
    const box: WordBox = { index: 1, x: 40, y: 40, width: 10, height: 10 };
    expect(isBoxCircled(box, square)).toBe(true);
  });

  it("does not circle a word whose centre is outside and overlap is tiny", () => {
    // Centre at (130, 50) is outside; only a sliver overlaps the loop.
    const box: WordBox = { index: 2, x: 95, y: 45, width: 70, height: 10 };
    expect(isBoxCircled(box, square)).toBe(false);
  });

  it("circles a word by overlap even when its centre is just outside", () => {
    // Centre at (102, 50) sits just outside, but most of the box is inside.
    const box: WordBox = { index: 3, x: 4, y: 45, width: 196, height: 10 };
    // Lower the threshold slightly to exercise the overlap branch deterministically.
    expect(isBoxCircled(box, square, 0.4)).toBe(true);
  });
});

describe("resolveLasso", () => {
  const boxes: WordBox[] = [
    { index: 0, x: 10, y: 10, width: 20, height: 20 }, // inside
    { index: 1, x: 60, y: 60, width: 20, height: 20 }, // inside
    { index: 2, x: 200, y: 10, width: 20, height: 20 }, // far outside
    { index: 3, x: 300, y: 300, width: 20, height: 20 }, // far outside
  ];

  it("returns the indices of enclosed words, sorted and de-duplicated", () => {
    expect(resolveLasso(square, boxes)).toEqual([0, 1]);
  });

  it("returns nothing when the loop encloses no words", () => {
    const tinyLoop: Point[] = [
      { x: 120, y: 120 },
      { x: 140, y: 120 },
      { x: 140, y: 140 },
      { x: 120, y: 140 },
    ];
    expect(resolveLasso(tinyLoop, boxes)).toEqual([]);
  });

  it("returns nothing for a degenerate loop (fewer than 3 points)", () => {
    expect(resolveLasso([{ x: 0, y: 0 }, { x: 1, y: 1 }], boxes)).toEqual([]);
  });

  it("no DOM APIs are used (pure geometry only)", () => {
    // A guard against reintroducing DOM measurement: calling resolveLasso must
    // not require a document. If someone wired getBBox in, this would throw in
    // a non-DOM test environment.
    expect(() => resolveLasso(square, boxes)).not.toThrow();
  });
});
