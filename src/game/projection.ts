/*
 * Grandmer — pure 3D->2D screen projection (FEAT-001).
 *
 * This is plain, DOM-free, GPU-free matrix math. It projects a world-space
 * point through a camera view-projection matrix into 2D screen pixels so that
 * the EXISTING pure src/game/lasso.ts resolveLasso can hit-test tokens that
 * live on a 3D paper surface: we project each token's 3D anchor / bounds to 2D
 * screen space and hand the resulting WordBox list to resolveLasso unchanged.
 *
 * IMPORTANT: nothing here imports three's WebGLRenderer or touches a canvas /
 * DOM. The matrix is passed in as a plain number[16] (the same column-major
 * layout THREE.Matrix4.elements uses, so scene code can pass
 * camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements
 * directly), which keeps this fully unit-testable with hand-built matrices and
 * no GPU.
 */

import type { WordBox } from "./lasso";

/** A world-space point. Shape-compatible with THREE.Vector3. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A 2D screen point in pixels (origin top-left, y grows downward). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * A column-major 4x4 matrix as 16 numbers, matching THREE.Matrix4.elements.
 * Element m[column * 4 + row] is row `row`, column `column`.
 */
export type Matrix16 = readonly number[];

/**
 * Multiply a column-major 4x4 matrix by a homogeneous point (x, y, z, 1).
 * Returns the resulting clip-space [x, y, z, w].
 */
function transformPoint(
  m: Matrix16,
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  // Column-major: component i of the result sums m[col*4 + i] * vec[col].
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx, cy, cz, cw];
}

/**
 * Project a world-space point to 2D screen pixels through a view-projection
 * matrix.
 *
 * @param point         the world point {x,y,z}.
 * @param viewProjection column-major view-projection matrix (number[16]).
 * @param width         viewport width in pixels.
 * @param height        viewport height in pixels.
 * @returns the screen point {x,y} (origin top-left), or null when the point is
 *          behind the camera (clip-space w <= 0) and therefore not visible.
 */
export function projectToScreen(
  point: Vec3,
  viewProjection: Matrix16,
  width: number,
  height: number,
): ScreenPoint | null {
  const [cx, cy, , cw] = transformPoint(
    viewProjection,
    point.x,
    point.y,
    point.z,
  );

  // w <= 0 means the point is on or behind the camera plane: not visible.
  if (cw <= 0) return null;

  // Perspective divide into normalised device coordinates (-1..1).
  const ndcX = cx / cw;
  const ndcY = cy / cw;

  // NDC -> pixels. NDC y is +1 at the top, so flip for screen y (down = +).
  const screenX = (ndcX * 0.5 + 0.5) * width;
  const screenY = (1 - (ndcY * 0.5 + 0.5)) * height;

  return { x: screenX, y: screenY };
}

/**
 * Build a lasso.ts WordBox from a projected token anchor plus its on-screen
 * width/height in pixels. The anchor is the token's CENTRE in screen space
 * (the natural result of projecting a token's 3D centre); the returned box is
 * the axis-aligned rectangle resolveLasso expects (top-left origin + size).
 *
 * @param index   the token index (matches Token.index / WordBox.index).
 * @param centre  the token's projected centre in screen pixels.
 * @param width   the token's on-screen width in pixels.
 * @param height  the token's on-screen height in pixels.
 */
export function wordBoxFromScreenAnchor(
  index: number,
  centre: ScreenPoint,
  width: number,
  height: number,
): WordBox {
  return {
    index,
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
  };
}

/**
 * Project a token's 3D world anchor to a lasso.ts WordBox, given the token's
 * on-screen width/height in pixels. Returns null when the anchor is behind the
 * camera (the token is not visible and cannot be circled).
 *
 * This is the adapter that lets the EXISTING 2D resolveLasso consume
 * 3D-projected tokens unchanged: project each token, collect the non-null
 * WordBoxes, and call resolveLasso(loopPoints, wordBoxes) as before.
 *
 * @param index          the token index.
 * @param anchor         the token's world-space centre {x,y,z}.
 * @param viewProjection column-major view-projection matrix (number[16]).
 * @param width          viewport width in pixels.
 * @param height         viewport height in pixels.
 * @param boxWidth       the token's on-screen width in pixels.
 * @param boxHeight      the token's on-screen height in pixels.
 */
export function projectTokenToWordBox(
  index: number,
  anchor: Vec3,
  viewProjection: Matrix16,
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
): WordBox | null {
  const centre = projectToScreen(anchor, viewProjection, width, height);
  if (centre === null) return null;
  return wordBoxFromScreenAnchor(index, centre, boxWidth, boxHeight);
}

/**
 * Project a token's 3D quad (its centre plus half-extent vectors along the
 * paper's local right and forward axes) to a screen-space WordBox whose size
 * reflects the token's PROJECTED on-screen size. This is depth-correct: a token
 * farther from the camera (near the top of a paper tilted away) projects
 * smaller, and a near token projects larger, instead of every token getting a
 * fixed pixel box. The box is the axis-aligned bounding rectangle of the four
 * projected corners.
 *
 * Falls back to a fixed-size box (minWidth/minHeight around the projected
 * centre) when any corner is behind the camera or the projected quad collapses,
 * so a partially clipped token still gets a sane, non-degenerate box. Returns
 * null only when the token CENTRE is behind the camera (not visible / not
 * circle-able), matching projectTokenToWordBox.
 *
 * Pure matrix math: no DOM, no GPU, fully unit-testable with hand-built
 * matrices and world vectors.
 *
 * @param index          the token index.
 * @param anchor         the token's world-space centre {x,y,z}.
 * @param halfRight      world-space vector from centre to the mid-right edge
 *                       (half the quad width along its local right axis).
 * @param halfDown       world-space vector from centre to the mid-bottom edge
 *                       (half the quad height along its local forward axis).
 * @param viewProjection column-major view-projection matrix (number[16]).
 * @param width          viewport width in pixels.
 * @param height         viewport height in pixels.
 * @param minWidth       floor for the box width in pixels (fallback + clamp).
 * @param minHeight      floor for the box height in pixels (fallback + clamp).
 */
export function projectTokenQuadToWordBox(
  index: number,
  anchor: Vec3,
  halfRight: Vec3,
  halfDown: Vec3,
  viewProjection: Matrix16,
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
): WordBox | null {
  const centre = projectToScreen(anchor, viewProjection, width, height);
  if (centre === null) return null;

  // Project the four quad corners (centre +/- halfRight +/- halfDown).
  const corners: Array<ScreenPoint | null> = [];
  for (const sr of [-1, 1]) {
    for (const sd of [-1, 1]) {
      const p: Vec3 = {
        x: anchor.x + sr * halfRight.x + sd * halfDown.x,
        y: anchor.y + sr * halfRight.y + sd * halfDown.y,
        z: anchor.z + sr * halfRight.z + sd * halfDown.z,
      };
      corners.push(projectToScreen(p, viewProjection, width, height));
    }
  }

  // If any corner clipped behind the camera, fall back to a fixed box around
  // the (visible) centre so the token still hit-tests sanely.
  if (corners.some((c) => c === null)) {
    return wordBoxFromScreenAnchor(index, centre, minWidth, minHeight);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c!.x);
    minY = Math.min(minY, c!.y);
    maxX = Math.max(maxX, c!.x);
    maxY = Math.max(maxY, c!.y);
  }

  // Clamp to the minimum size so a heavily foreshortened token still has a
  // grabbable box, growing symmetrically around the projected centre.
  let boxW = maxX - minX;
  let boxH = maxY - minY;
  if (boxW < minWidth) {
    minX = centre.x - minWidth / 2;
    boxW = minWidth;
  }
  if (boxH < minHeight) {
    minY = centre.y - minHeight / 2;
    boxH = minHeight;
  }

  return { index, x: minX, y: minY, width: boxW, height: boxH };
}
