/*
 * Grandmer — lasso hit-testing (FEAT-001).
 *
 * Pure, DOM-free geometry. The student draws a freehand loop (a hand-drawn
 * lasso) over the student's answer; this module decides which word tokens that
 * loop circled. It takes INJECTED geometry (the loop points and each word's
 * bounding box) so it is fully deterministic and unit-testable without any
 * real SVG or layout measurement (happy-dom cannot measure getBBox / real
 * layout, so nothing here touches the DOM).
 *
 * A word counts as circled when its centre falls inside the loop polygon, OR
 * when a sufficient fraction of its box area is enclosed by the loop. The
 * area test is sampled on a small grid so partial overlaps behave sensibly
 * without needing exact polygon clipping.
 */

/** A 2D point. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned bounding box for a word token, tagged with its token index. */
export interface WordBox {
  /** The token index this box belongs to (matches Token.index). */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fraction of a word's box area that must be inside the loop for it to count as
 * circled when its centre is NOT inside. Kept generous so a deliberate loop
 * around a word registers even when it clips a corner.
 */
export const OVERLAP_THRESHOLD = 0.5;

/** Grid resolution (per axis) used to estimate enclosed box area. */
const AREA_SAMPLES = 5;

/**
 * Ray-casting point-in-polygon test. Returns true when `point` lies strictly
 * inside the polygon described by `polygon` (an ordered list of vertices; the
 * closing edge from last to first is implied). Points exactly on an edge are
 * treated conservatively but deterministically.
 */
export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The geometric centre of a word box. */
function boxCentre(box: WordBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Estimate the fraction (0..1) of a word box that lies inside the loop by
 * sampling a small grid of points across the box.
 */
export function enclosedFraction(
  box: WordBox,
  polygon: readonly Point[],
): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  let inside = 0;
  let total = 0;
  for (let ix = 0; ix < AREA_SAMPLES; ix++) {
    for (let iy = 0; iy < AREA_SAMPLES; iy++) {
      // Sample cell centres so we never sit exactly on the box edge.
      const sx = box.x + (box.width * (ix + 0.5)) / AREA_SAMPLES;
      const sy = box.y + (box.height * (iy + 0.5)) / AREA_SAMPLES;
      total += 1;
      if (pointInPolygon({ x: sx, y: sy }, polygon)) inside += 1;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/** True when a word box counts as circled by the loop. */
export function isBoxCircled(
  box: WordBox,
  polygon: readonly Point[],
  overlapThreshold = OVERLAP_THRESHOLD,
): boolean {
  if (polygon.length < 3) return false;
  if (pointInPolygon(boxCentre(box), polygon)) return true;
  return enclosedFraction(box, polygon) >= overlapThreshold;
}

/**
 * Resolve which word indices a freehand loop circled.
 *
 * @param points   the ordered loop points (the hand-drawn lasso path).
 * @param wordBoxes the bounding boxes of each candidate word token.
 * @returns the token indices the loop enclosed / substantially overlapped, in
 *          ascending index order and de-duplicated.
 */
export function resolveLasso(
  points: readonly Point[],
  wordBoxes: readonly WordBox[],
  overlapThreshold = OVERLAP_THRESHOLD,
): number[] {
  if (points.length < 3) return [];
  const hits = new Set<number>();
  for (const box of wordBoxes) {
    if (isBoxCircled(box, points, overlapThreshold)) hits.add(box.index);
  }
  return [...hits].sort((a, b) => a - b);
}
