/*
 * Grandmer — tests for the pure 3D->2D projection helper (FEAT-001).
 *
 * All matrices here are hand-constructed plain number[16] arrays in the same
 * column-major layout as THREE.Matrix4.elements, so these tests run under the
 * GPU-free `node` vitest environment and never touch a WebGLRenderer, canvas,
 * or the DOM. They verify: centre -> viewport centre, the four directions map
 * to the expected screen half, behind-camera returns null, and an integration
 * where projected token boxes are fed into the existing resolveLasso.
 */

import { describe, it, expect } from "vitest";
import {
  projectToScreen,
  projectTokenToWordBox,
  projectTokenQuadToWordBox,
  wordBoxFromScreenAnchor,
  type Matrix16,
  type Vec3,
} from "./projection";
import { resolveLasso, type Point } from "./lasso";

const WIDTH = 800;
const HEIGHT = 600;

/**
 * Multiply two column-major 4x4 matrices (a * b), matching how
 * THREE.Matrix4.multiply composes transforms.
 */
function multiply(a: Matrix16, b: Matrix16): number[] {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * A standard OpenGL-style perspective projection matrix in column-major layout
 * (the same math THREE.PerspectiveCamera uses).
 */
function perspective(
  fovyRad: number,
  aspect: number,
  near: number,
  far: number,
): number[] {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  // Column-major.
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/**
 * A view matrix for a camera at `eye` looking down its local -z axis with no
 * rotation: it simply translates the world by -eye. Column-major, translation
 * lives in elements 12,13,14.
 */
function viewAt(eye: Vec3): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -eye.x, -eye.y, -eye.z, 1,
  ];
}

/** Camera at (0,0,5) looking toward -z, 60deg fov, our viewport aspect. */
function defaultViewProjection(): number[] {
  const proj = perspective(Math.PI / 3, WIDTH / HEIGHT, 0.1, 100);
  const view = viewAt({ x: 0, y: 0, z: 5 });
  return multiply(proj, view);
}

describe("projectToScreen", () => {
  const vp = defaultViewProjection();

  it("projects a point straight ahead to the viewport centre", () => {
    const screen = projectToScreen({ x: 0, y: 0, z: 0 }, vp, WIDTH, HEIGHT);
    expect(screen).not.toBeNull();
    expect(screen!.x).toBeCloseTo(WIDTH / 2, 5);
    expect(screen!.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("maps a point to the right of the camera to the right screen half", () => {
    const screen = projectToScreen({ x: 1, y: 0, z: 0 }, vp, WIDTH, HEIGHT)!;
    expect(screen.x).toBeGreaterThan(WIDTH / 2);
    expect(screen.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("maps a point to the left of the camera to the left screen half", () => {
    const screen = projectToScreen({ x: -1, y: 0, z: 0 }, vp, WIDTH, HEIGHT)!;
    expect(screen.x).toBeLessThan(WIDTH / 2);
    expect(screen.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("maps a point above the camera to the upper screen half", () => {
    const screen = projectToScreen({ x: 0, y: 1, z: 0 }, vp, WIDTH, HEIGHT)!;
    // Screen y grows downward, so 'up' in world is a smaller y in pixels.
    expect(screen.y).toBeLessThan(HEIGHT / 2);
    expect(screen.x).toBeCloseTo(WIDTH / 2, 5);
  });

  it("maps a point below the camera to the lower screen half", () => {
    const screen = projectToScreen({ x: 0, y: -1, z: 0 }, vp, WIDTH, HEIGHT)!;
    expect(screen.y).toBeGreaterThan(HEIGHT / 2);
    expect(screen.x).toBeCloseTo(WIDTH / 2, 5);
  });

  it("returns null for a point behind the camera", () => {
    // Camera sits at z=5 looking toward -z, so z=10 is behind it.
    const screen = projectToScreen({ x: 0, y: 0, z: 10 }, vp, WIDTH, HEIGHT);
    expect(screen).toBeNull();
  });
});

describe("wordBoxFromScreenAnchor", () => {
  it("builds a top-left-origin box centred on the anchor", () => {
    const box = wordBoxFromScreenAnchor(3, { x: 100, y: 200 }, 40, 20);
    expect(box).toEqual({ index: 3, x: 80, y: 190, width: 40, height: 20 });
  });
});

describe("projectTokenToWordBox", () => {
  const vp = defaultViewProjection();

  it("projects a visible token anchor into a WordBox", () => {
    const box = projectTokenToWordBox(
      1,
      { x: 0, y: 0, z: 0 },
      vp,
      WIDTH,
      HEIGHT,
      60,
      30,
    );
    expect(box).not.toBeNull();
    expect(box!.index).toBe(1);
    expect(box!.x + box!.width / 2).toBeCloseTo(WIDTH / 2, 5);
    expect(box!.y + box!.height / 2).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("returns null for a token behind the camera", () => {
    const box = projectTokenToWordBox(
      2,
      { x: 0, y: 0, z: 10 },
      vp,
      WIDTH,
      HEIGHT,
      60,
      30,
    );
    expect(box).toBeNull();
  });
});

describe("projectTokenQuadToWordBox", () => {
  const vp = defaultViewProjection();
  // A quad in the world XY plane, half a unit wide and a quarter tall.
  const halfRight: Vec3 = { x: 0.5, y: 0, z: 0 };
  const halfDown: Vec3 = { x: 0, y: 0.25, z: 0 };

  it("sizes the box from the projected quad, centred on the anchor", () => {
    const box = projectTokenQuadToWordBox(
      1,
      { x: 0, y: 0, z: 0 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      1,
      1,
    )!;
    expect(box).not.toBeNull();
    // Centre of the box maps back to the viewport centre.
    expect(box.x + box.width / 2).toBeCloseTo(WIDTH / 2, 4);
    expect(box.y + box.height / 2).toBeCloseTo(HEIGHT / 2, 4);
    // The projected quad is well above the 1px floor, so no clamping.
    expect(box.width).toBeGreaterThan(1);
    expect(box.height).toBeGreaterThan(1);
  });

  it("projects a farther token to a SMALLER box than a nearer one (depth)", () => {
    // Nearer token (closer to the z=5 camera) vs a farther token.
    const near = projectTokenQuadToWordBox(
      1,
      { x: 0, y: 0, z: 2 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      1,
      1,
    )!;
    const far = projectTokenQuadToWordBox(
      2,
      { x: 0, y: 0, z: -4 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      1,
      1,
    )!;
    expect(near.width).toBeGreaterThan(far.width);
    expect(near.height).toBeGreaterThan(far.height);
  });

  it("clamps up to the minimum size for a heavily foreshortened token", () => {
    const box = projectTokenQuadToWordBox(
      3,
      { x: 0, y: 0, z: -4 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      400,
      300,
    )!;
    expect(box.width).toBe(400);
    expect(box.height).toBe(300);
    // Still centred on the projected anchor.
    const centre = projectToScreen({ x: 0, y: 0, z: -4 }, vp, WIDTH, HEIGHT)!;
    expect(box.x + box.width / 2).toBeCloseTo(centre.x, 4);
    expect(box.y + box.height / 2).toBeCloseTo(centre.y, 4);
  });

  it("returns null when the token centre is behind the camera", () => {
    const box = projectTokenQuadToWordBox(
      4,
      { x: 0, y: 0, z: 10 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      1,
      1,
    );
    expect(box).toBeNull();
  });

  it("falls back to a fixed box when a corner clips behind the camera", () => {
    // Anchor visible but a huge halfDown pushes one corner behind the camera.
    const box = projectTokenQuadToWordBox(
      5,
      { x: 0, y: 0, z: 0 },
      halfRight,
      { x: 0, y: 0, z: 20 },
      vp,
      WIDTH,
      HEIGHT,
      60,
      30,
    )!;
    expect(box).not.toBeNull();
    expect(box.width).toBe(60);
    expect(box.height).toBe(30);
  });

  it("feeds resolveLasso: a loop around the quad box encloses the token", () => {
    const box = projectTokenQuadToWordBox(
      7,
      { x: 0, y: 0, z: 0 },
      halfRight,
      halfDown,
      vp,
      WIDTH,
      HEIGHT,
      1,
      1,
    )!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const loop: Point[] = [
      { x: cx - box.width, y: cy - box.height },
      { x: cx + box.width, y: cy - box.height },
      { x: cx + box.width, y: cy + box.height },
      { x: cx - box.width, y: cy + box.height },
    ];
    expect(resolveLasso(loop, [box])).toEqual([7]);
  });
});

describe("integration: projected tokens feed the existing resolveLasso", () => {
  const vp = defaultViewProjection();

  it("detects a token whose projected box is enclosed by a screen-space loop", () => {
    // Three tokens on the paper plane; we only loop around the middle one.
    const tokens = [
      { index: 0, anchor: { x: -2, y: 0, z: 0 } as Vec3 },
      { index: 1, anchor: { x: 0, y: 0, z: 0 } as Vec3 },
      { index: 2, anchor: { x: 2, y: 0, z: 0 } as Vec3 },
    ];

    const boxes = tokens
      .map((t) =>
        projectTokenToWordBox(t.index, t.anchor, vp, WIDTH, HEIGHT, 40, 24),
      )
      .filter((b) => b !== null);

    expect(boxes).toHaveLength(3);

    // The middle token projects to the viewport centre; draw a generous loop
    // around that centre only.
    const centre = projectToScreen({ x: 0, y: 0, z: 0 }, vp, WIDTH, HEIGHT)!;
    const loop: Point[] = [
      { x: centre.x - 50, y: centre.y - 40 },
      { x: centre.x + 50, y: centre.y - 40 },
      { x: centre.x + 50, y: centre.y + 40 },
      { x: centre.x - 50, y: centre.y + 40 },
    ];

    const hits = resolveLasso(loop, boxes);
    expect(hits).toEqual([1]);
  });
});
