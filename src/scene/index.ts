/*
 * Grandmer — src/scene WebGL boundary (FEAT-001 scaffold).
 *
 * This module (and everything else under src/scene/) is the SOLE home of all
 * Three.js / WebGL code: renderer, scene graph, camera, animation loop, and the
 * procedural voxel models and background assets built in later features.
 *
 * HARD RULE: nothing under src/scene/ is ever imported by a *.test.ts file or
 * by a pure-logic module under src/game/. Tests run under a GPU-free
 * environment (node / happy-dom), so keeping every WebGLRenderer and canvas
 * call behind this boundary means the unit tests never instantiate a renderer.
 *
 * The dependency direction is strictly one-way: scene code MAY import pure
 * helpers such as src/game/projection.ts, but pure code NEVER imports scene
 * code. Heavy scene setup (renderer, voxel desk/character/pen, camera rig,
 * realistic cartoony background) lands in FEAT-002 and beyond; this file only
 * documents the boundary and re-exports the (currently empty) surface so that
 * screen mount code has a single import site to grow into.
 */

/** Marker so the module is a real ES module even before scene code exists. */
export const SCENE_MODULE_ROOT = "src/scene" as const;

/*
 * Public surface for screen mount code (FEAT-003 wires this into marking.ts).
 * Screens import ONLY from here so there is a single WebGL entry point.
 */
export { createMarkingScene } from "./markingScene";
export type { MarkingScene } from "./markingScene";
export { PAPER_WIDTH, PAPER_HEIGHT } from "./paper";
