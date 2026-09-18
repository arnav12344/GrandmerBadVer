# src/scene — the WebGL boundary

This directory is the SOLE home of all Three.js / WebGL code for Grandmer: the
renderer, scene graph, camera, animation loop, and the procedural voxel models
(examiner character, pen, desk, paper, props) plus any downloaded openly
licensed 3D/background assets.

## The one hard rule

Nothing under `src/scene/` may be imported by:

- any `*.test.ts` file, or
- any pure-logic module under `src/game/` (types, scoring, session, lasso,
  projection).

Automated tests run under Vitest's `node` environment (and one under
happy-dom); neither has a GPU or a real WebGL context. Keeping every
`WebGLRenderer` and canvas call behind this boundary guarantees the unit tests
never try to instantiate a renderer.

The bridge between pure logic and the 3D scene is one-way: scene code IMPORTS
the pure helpers (for example `src/game/projection.ts` to turn a token's 3D
world anchor into a 2D `WordBox` that the existing `resolveLasso` consumes).
The pure side never imports scene code.

## Visual verification caveat

This sandbox has no GPU and no headless browser, so WebGL rendering cannot be
verified here. Run `npm run dev` locally and open the printed URL in a real
browser to see the 3D scene.
