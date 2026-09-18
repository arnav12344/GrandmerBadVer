/*
 * Grandmer - src/scene examiner's-desk hero scene (FEAT-002).
 *
 * Stands up the full 3D scene: a WebGLRenderer mounted into a container, a
 * cinematic PerspectiveCamera framing the desk, warm cartoony lighting, a real
 * 3D HDRI room environment (see environment.ts), the original voxel examiner
 * (voxelCharacter.ts), the desk + answer paper (paper.ts), and a 3D pen that
 * FOLLOWS THE CURSOR by raycasting the pointer onto the paper each frame
 * (pen.ts). A requestAnimationFrame loop drives idle motion and the pen.
 *
 * The scene follows the project's screen-cleanup discipline: createMarkingScene
 * returns a handle whose dispose() stops the loop, removes every listener,
 * disposes all geometries/materials/textures/renderer, and detaches the canvas.
 * Window resize is handled. No test imports this module, so `npm test` never
 * constructs a WebGLRenderer.
 *
 * FEAT-003 wiring surface (kept deliberately small and stable):
 *  - createMarkingScene(container) mounts the scene and starts the loop.
 *  - handle.getViewProjection() returns the camera view-projection matrix as a
 *    column-major number[16] (THREE.Matrix4.elements layout) for feeding the
 *    pure src/game/projection.ts helpers.
 *  - handle.paperUvToWorld(u,v) gives a token's 3D world anchor on the paper.
 *  - handle.getNibWorldPosition() is the pen's ink source.
 *  - handle.setPointer(clientX, clientY) updates the cursor the pen tracks.
 *  - handle.dispose() tears everything down.
 */

import * as THREE from "three";
import { buildDeskAndPaper } from "./paper";
import { buildPen } from "./pen";
import { buildVoxelExaminer } from "./voxelCharacter";
import { loadEnvironment } from "./environment";

/** The public handle returned by createMarkingScene. */
export interface MarkingScene {
  /** The renderer's canvas (already appended into the container). */
  canvas: HTMLCanvasElement;
  /**
   * The camera view-projection matrix as a column-major number[16], matching
   * THREE.Matrix4.elements, ready for src/game/projection.ts.
   */
  getViewProjection: () => number[];
  /** Viewport width/height in CSS pixels (for projection to screen space). */
  getViewportSize: () => { width: number; height: number };
  /** World-space anchor for a token at normalised paper (u,v). */
  paperUvToWorld: (u: number, v: number, out?: THREE.Vector3) => THREE.Vector3;
  /** World-space position of the pen nib (ink source for FEAT-003). */
  getNibWorldPosition: (out?: THREE.Vector3) => THREE.Vector3;
  /** Latest world point where the cursor ray meets the paper, or null. */
  getPaperCursorPoint: () => THREE.Vector3 | null;
  /** Update the tracked pointer from a DOM event's client coordinates. */
  setPointer: (clientX: number, clientY: number) => void;
  /** The scene graph, exposed so FEAT-003 can add token/ink objects. */
  scene: THREE.Scene;
  /** Tear down the loop, listeners, GPU resources, and detach the canvas. */
  dispose: () => void;
}

/**
 * Create and start the marking scene inside `container`.
 *
 * @param container the element the canvas is appended into (e.g. ctx.root or a
 *                  wrapper). The scene sizes itself to the container's box.
 */
export function createMarkingScene(container: HTMLElement): MarkingScene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Soft tone mapping keeps the HDRI-lit room bright and friendly.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);

  const scene = new THREE.Scene();

  // Cinematic camera looking slightly down at the desk from the student's seat.
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 6.2, 9.5);
  camera.lookAt(0, 1.4, 0.5);

  // Warm, bright, cartoony lighting: a soft ambient fill plus a gentle key.
  const ambient = new THREE.AmbientLight(0xfff3df, 0.9);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff1d0, 1.15);
  key.position.set(4.5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  scene.add(key);

  // A cool rim fill from the opposite side to round out the toon shapes.
  const rim = new THREE.DirectionalLight(0xbcd4ff, 0.4);
  rim.position.set(-6, 5, -4);
  scene.add(rim);

  // Real 3D HDRI room environment (async; upgrades lighting when it lands).
  const environment = loadEnvironment(scene, renderer);

  // Desk + paper.
  const desk = buildDeskAndPaper();
  scene.add(desk.group);

  // Voxel examiner, seated behind the desk and turned toward the paper.
  const examiner = buildVoxelExaminer();
  examiner.group.position.set(-3.6, 0.3, -2.2);
  examiner.group.rotation.y = 0.5;
  examiner.group.scale.setScalar(1.05);
  scene.add(examiner.group);

  // Cursor-tracking pen.
  const pen = buildPen();
  scene.add(pen.group);

  // Pointer -> paper raycasting state.
  const raycaster = new THREE.Raycaster();
  // Normalised device coords of the pointer; starts at paper centre.
  const pointerNdc = new THREE.Vector2(0, 0);
  let hasPointer = false;
  const paperCursor = new THREE.Vector3();
  let paperCursorValid = false;
  // A resting hover target used before the cursor has moved over the paper.
  const restingTarget = desk.paperUvToWorld(0.5, 0.5, new THREE.Vector3());

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    hasPointer = true;
  };

  const updatePenFromCursor = (): void => {
    if (hasPointer) {
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(desk.paperMesh, false);
      if (hits.length > 0) {
        paperCursor.copy(hits[0].point);
        paperCursorValid = true;
        pen.pointAt(paperCursor);
        return;
      }
      paperCursorValid = false;
    }
    // No hit (or no pointer yet): rest the pen near the paper centre.
    pen.pointAt(restingTarget);
  };

  // Size everything to the container box.
  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  resize();

  // Animation loop.
  const clock = new THREE.Clock();
  let rafId = 0;
  let running = true;
  const tick = (): void => {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    examiner.animate(t);
    updatePenFromCursor();
    renderer.render(scene, camera);
  };
  rafId = requestAnimationFrame(tick);

  // Listeners.
  window.addEventListener("resize", resize);
  const onPointerMove = (e: PointerEvent): void =>
    setPointer(e.clientX, e.clientY);
  canvas.addEventListener("pointermove", onPointerMove);

  // Reusable matrix for view-projection extraction.
  const vpMatrix = new THREE.Matrix4();
  const getViewProjection = (): number[] => {
    camera.updateMatrixWorld();
    vpMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    return vpMatrix.elements.slice();
  };

  // Report the viewport size from the CANVAS rect, not the container's client
  // box. The lasso loop points are captured relative to the canvas
  // (canvas.getBoundingClientRect() in the screen code), so deriving the
  // projection viewport from the SAME canvas element keeps the loop-point
  // origin and the projection extent in one coordinate space. They agree today
  // only because .scene-layer is position:fixed; inset:0; reading both from the
  // canvas makes the invariant robust to future CSS changes (e.g. embedding the
  // 3D view inside the HUD) instead of silently misaligning the hit-test. Fall
  // back to the container box, then the window, when the canvas has no layout
  // (e.g. before first paint).
  const getViewportSize = (): { width: number; height: number } => {
    const rect = canvas.getBoundingClientRect();
    const width =
      rect.width || container.clientWidth || window.innerWidth;
    const height =
      rect.height || container.clientHeight || window.innerHeight;
    return { width, height };
  };

  const getPaperCursorPoint = (): THREE.Vector3 | null =>
    paperCursorValid ? paperCursor.clone() : null;

  const dispose = (): void => {
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointermove", onPointerMove);

    // Free scene objects.
    examiner.dispose();
    pen.dispose();
    desk.dispose();
    environment.dispose();

    // Free lights (no geometry, but clear references).
    scene.remove(ambient, key, rim, desk.group, examiner.group, pen.group);

    // Detach and destroy the renderer/canvas.
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };

  return {
    canvas,
    getViewProjection,
    getViewportSize,
    paperUvToWorld: desk.paperUvToWorld,
    getNibWorldPosition: pen.getNibWorldPosition,
    getPaperCursorPoint,
    setPointer,
    scene,
    dispose,
  };
}
