/*
 * Grandmer - Essay "free-for-all" screen (FEAT-004: 3D voxel examiner's desk).
 *
 * The FINAL paper now runs on the same Three.js scene as the standard marking
 * screen (src/scene): the cartoony voxel examiner sits at the desk, the essay's
 * text lies on the 3D paper, and the 3D pen follows the cursor to lay down a red
 * ink lasso. The chrome (section label, timer, focus chips, mark count, Finish
 * button, feedback line) is a PIXEL-ART DOM HUD layered above the WebGL canvas.
 *
 * Unlike the standard papers there is no hidden error set, so marking here is
 * open and UNGRADED: the examiner freely lassos as many words as they like and
 * none of it feeds the scored hit / miss / false-alarm metrics (the pure
 * session records essay circles as inert notes). The gesture is the SAME
 * hand-drawn red-pen loop used on the standard papers, resolved by projecting
 * each token's 3D anchor to 2D screen space and feeding the EXISTING pure
 * resolveLasso. Tone stays playful and non-shaming, with a generous timer. When
 * the timer expires or the examiner finishes, the run ends and the app
 * transitions to the Report Card.
 *
 * CRITICAL sandbox constraint (mirrors marking.ts): there is NO GPU / WebGL /
 * headless browser in the test environment, so the 3D scene is created ONLY
 * when a real WebGL context can be obtained (probed + guarded in try/catch);
 * otherwise the screen runs a pure-DOM fallback. The DOM tokens + pixel HUD are
 * ALWAYS rendered, and a keyboard fallback (Enter/Space on a focused word
 * toggles its circle) drives marking WITHOUT touching WebGL, so the happy-dom
 * smoke test and keyboard users can play the whole run headlessly. No test ever
 * constructs a WebGLRenderer.
 *
 * Every timer, listener, animation frame, and the 3D scene (plus every
 * token/ink object added to it) are torn down in the returned cleanup.
 */

import * as THREE from "three";
import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { EssayQuestion, ErrorCategory, Token } from "../game/types";
import type { Point, WordBox } from "../game/lasso";
import { resolveLasso } from "../game/lasso";
import { projectTokenQuadToWordBox } from "../game/projection";
import { createMarkingScene, type MarkingScene } from "../scene";
import {
  circledTokens,
  currentQuestion,
  finishRun,
  toggleCircle,
} from "../game/session";

/** A little more time for the open essay marking. */
const ESSAY_SECONDS = 45;

/**
 * Minimum on-screen token box size (px). The 3D hit-box is now sized from each
 * token's PROJECTED quad (depth-correct), but a heavily foreshortened token is
 * clamped up to this floor so it stays grabbable. The essay layout is dense, so
 * the floor is a touch smaller than the standard papers to reduce row overlap.
 */
const TOKEN_BOX_MIN_WIDTH = 44;
const TOKEN_BOX_MIN_HEIGHT = 20;

/**
 * The essay token sprite quad size in world units (matches makeTokenSprite's
 * PlaneGeometry). Used to derive the quad's world-space half-extent vectors for
 * depth-correct projection.
 */
const SPRITE_WIDTH = 0.7;
const SPRITE_HEIGHT = 0.35;

const FOCUS_LABELS: Record<ErrorCategory, string> = {
  preposition: "Prepositions",
  tense: "Verb tenses",
  spelling: "Spelling",
  punctuation: "Punctuation",
  "sentence-structure": "Sentence structure",
};

export function mountEssay(ctx: AppContext, nav: Nav): ScreenCleanup {
  const question = currentQuestion(ctx.session);
  if (!question || question.kind !== "essay") {
    nav.go("reportCard");
    return undefined;
  }
  const essay = question as EssayQuestion;

  const startedAt = Date.now();
  let ended = false;
  let tickHandle: number | undefined;
  const disposers: Array<() => void> = [];

  const focusChips = essay.focusAreas
    .map((f) => `<span class="essay__chip">${FOCUS_LABELS[f]}</span>`)
    .join("");

  ctx.root.innerHTML = `
    <main class="desk desk--marking desk--marking3d" id="essay-desk">
      <div class="scene-layer" id="scene-layer" aria-hidden="true"></div>

      <div class="hud" id="hud">
        <header class="marking__bar">
          <span class="marking__section">${escapeHtml(essay.section)}</span>
          <span class="marking__count">Final Paper</span>
        </header>

        <p class="marking__prompt">
          <span class="marking__prompt-label">Essay question:</span>
          ${escapeHtml(essay.prompt)}
        </p>

        <section class="paper-card marking__paper essay__paper">
          <p class="marking__hint essay__hint">
            Free marking - this one's your call, examiner. Loop your pen around
            every word that catches your eye. There's no single right answer here.
          </p>
          <div class="lasso-stage" id="lasso-stage">
            <p class="handwriting marking__answer essay__answer" id="essay-answer"></p>
            <svg class="lasso-layer" id="lasso-layer" aria-hidden="true"
                 xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </section>

        <div class="essay__focus">
          <span class="essay__focus-label">Watch for:</span> ${focusChips}
        </div>

        <div class="marking__timer">
          <div class="timer-bar" role="timer" aria-label="time remaining">
            <div class="timer-bar__fill" id="timer-fill" style="width:100%"></div>
          </div>
          <span class="marking__seconds" id="seconds">${ESSAY_SECONDS}s</span>
        </div>

        <div class="marking__actions">
          <span class="essay__count" id="mark-count">0 marks made</span>
          <button class="btn btn--brass" id="finish-btn" type="button">Finish &amp; See Report →</button>
        </div>

        <div class="marking__feedback" id="feedback" aria-live="polite"></div>
      </div>
    </main>
  `;

  const deskEl = ctx.root.querySelector<HTMLElement>("#essay-desk")!;
  const sceneLayerEl = ctx.root.querySelector<HTMLElement>("#scene-layer")!;
  const stageEl = ctx.root.querySelector<HTMLElement>("#lasso-stage")!;
  const answerEl = ctx.root.querySelector<HTMLElement>("#essay-answer")!;
  const layerEl = ctx.root.querySelector<SVGSVGElement>("#lasso-layer")!;
  const fillEl = ctx.root.querySelector<HTMLElement>("#timer-fill")!;
  const secondsEl = ctx.root.querySelector<HTMLElement>("#seconds")!;
  const finishBtn = ctx.root.querySelector<HTMLButtonElement>("#finish-btn")!;
  const countEl = ctx.root.querySelector<HTMLElement>("#mark-count")!;
  const feedbackEl = ctx.root.querySelector<HTMLElement>("#feedback")!;

  // Split the essay into lasso-able / focusable word tokens.
  const words = essay.text.split(/\s+/).filter(Boolean);
  const tokens: Token[] = words.map((text, index) => ({ index, text }));

  // Assign each token a stable normalised (u,v) position on the paper, shared by
  // the 3D anchor placement and the DOM token overlay so the two stay in
  // registration (mirrors marking.ts).
  const layout = layoutTokens(tokens);

  // ---- Render tokens (keyboard-toggleable fallback, ALWAYS present) ----
  const tokenEls = new Map<number, HTMLElement>();
  answerEl.innerHTML = "";
  for (const token of tokens) {
    const el = document.createElement("span");
    el.className = "token essay__word";
    el.dataset.index = String(token.index);
    el.textContent = token.text;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-pressed", "false");
    el.setAttribute("aria-label", token.text);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onKeyToggle(token.index);
      }
    });
    tokenEls.set(token.index, el);
    answerEl.appendChild(el);
    answerEl.appendChild(document.createTextNode(" "));
  }

  // ---- Try to stand up the 3D scene (guarded: never runs under happy-dom) ----
  const three = tryCreateScene(sceneLayerEl, layout);
  if (three) {
    deskEl.classList.add("desk--3d-on");
    disposers.push(three.dispose);
  }

  renderExistingCircles();
  updateCount();

  // ---- Timer ----
  tickHandle = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remainingMs = Math.max(0, ESSAY_SECONDS * 1000 - elapsed);
    fillEl.style.width = `${(remainingMs / (ESSAY_SECONDS * 1000)) * 100}%`;
    secondsEl.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    if (remainingMs <= 0) finish();
  }, 100);

  finishBtn.addEventListener("click", () => finish());

  // ---- Pointer lasso capture ----
  // In 3D mode the pen ink is drawn in-scene from the raycast paper cursor; the
  // 2D screen path (what resolveLasso consumes) is captured from the same
  // pointer events. In DOM-fallback mode the SVG stage captures the stroke.
  let drawing = false;
  let points: Point[] = [];
  let pointerId: number | undefined;
  let liveStroke: SVGPolylineElement | undefined;

  // The element we attach pointer listeners to: the canvas when 3D is on, else
  // the SVG lasso stage. Screen coordinates come from clientX/clientY either
  // way, converted to the capture element's local box for resolveLasso.
  const captureEl: HTMLElement = three ? three.canvas : stageEl;

  function screenPoint(ev: PointerEvent): Point {
    // Loop points are taken relative to the CANVAS top-left, and the projection
    // viewport is now also derived from the canvas rect (see
    // markingScene.getViewportSize), so the loop origin and the projected token
    // boxes share the SAME canvas-relative space regardless of the .scene-layer
    // CSS. In DOM-fallback mode captureEl is the stage and both stay consistent.
    const rect = captureEl.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  const onPointerDown = (ev: PointerEvent): void => {
    if (ended) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    drawing = true;
    pointerId = ev.pointerId;
    points = [screenPoint(ev)];
    if (three) {
      three.setPointer(ev.clientX, ev.clientY);
      three.beginInk();
    } else {
      liveStroke = beginLiveStroke();
    }
    try {
      captureEl.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    ev.preventDefault();
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    points.push(screenPoint(ev));
    if (three) {
      three.setPointer(ev.clientX, ev.clientY);
      three.extendInk();
    } else if (liveStroke) {
      liveStroke.setAttribute("points", pointsToAttr(points));
    }
    ev.preventDefault();
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    drawing = false;
    try {
      captureEl.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (three) {
      three.endInk();
    } else if (liveStroke && liveStroke.parentNode) {
      liveStroke.parentNode.removeChild(liveStroke);
    }
    liveStroke = undefined;
    resolveStroke(points);
    points = [];
    pointerId = undefined;
    ev.preventDefault();
  };

  captureEl.addEventListener("pointerdown", onPointerDown);
  captureEl.addEventListener("pointermove", onPointerMove);
  captureEl.addEventListener("pointerup", onPointerUp);
  captureEl.addEventListener("pointercancel", onPointerUp);
  disposers.push(() => {
    captureEl.removeEventListener("pointerdown", onPointerDown);
    captureEl.removeEventListener("pointermove", onPointerMove);
    captureEl.removeEventListener("pointerup", onPointerUp);
    captureEl.removeEventListener("pointercancel", onPointerUp);
  });

  function resolveStroke(loop: readonly Point[]): void {
    if (ended || loop.length < 3) return;
    const boxes = measureTokenBoxes();
    const enclosed = resolveLasso(loop, boxes);
    if (enclosed.length === 0) return;
    for (const idx of enclosed) {
      ctx.session = toggleCircle(ctx.session, idx, Date.now());
    }
    renderExistingCircles();
    updateCount();
    flashFeedback(pickPraise());
  }

  // ---- Keyboard fallback: Enter/Space toggles the focused word ----
  // This path NEVER touches WebGL, so happy-dom and keyboard users can drive the
  // whole run. It is the path the smoke test exercises.
  function onKeyToggle(tokenIndex: number): void {
    if (ended) return;
    ctx.session = toggleCircle(ctx.session, tokenIndex, Date.now());
    renderExistingCircles();
    updateCount();
    flashFeedback(pickPraise());
  }

  // ---- Build WordBoxes for resolveLasso ----
  // In 3D mode we PROJECT each token's 3D paper anchor to screen pixels via the
  // pure projection helper. In DOM-fallback mode we measure the real token
  // boxes. Both feed the SAME resolveLasso.
  function measureTokenBoxes(): WordBox[] {
    if (three) return three.projectTokenBoxes();
    const stageRect = stageEl.getBoundingClientRect();
    const boxes: WordBox[] = [];
    for (const [index, el] of tokenEls) {
      const r = el.getBoundingClientRect();
      boxes.push({
        index,
        x: r.left - stageRect.left,
        y: r.top - stageRect.top,
        width: r.width,
        height: r.height,
      });
    }
    return boxes;
  }

  function renderExistingCircles(): void {
    const circled = new Set(circledTokens(ctx.session, essay.id));

    // Update DOM token state (used by keyboard fallback + smoke assertions).
    for (const [index, el] of tokenEls) {
      const marked = circled.has(index);
      el.classList.toggle("essay__word--marked", marked);
      el.classList.toggle("token--circled", marked);
      el.setAttribute("aria-pressed", marked ? "true" : "false");
    }

    if (three) {
      // Persistent 3D ink loops on the paper for circled words.
      three.renderCircledLoops([...circled]);
    }

    // Persistent DOM ink circles. These are the primary visuals in
    // DOM-fallback mode and the always-present `.ink-circle` marker.
    while (layerEl.firstChild) layerEl.removeChild(layerEl.firstChild);
    const stageRect = stageEl.getBoundingClientRect();
    layerEl.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, stageRect.width)} ${Math.max(1, stageRect.height)}`,
    );
    for (const [index, el] of tokenEls) {
      if (!circled.has(index)) continue;
      const r = el.getBoundingClientRect();
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("class", "ink-circle");
      path.setAttribute(
        "d",
        roughEllipsePath(
          r.left - stageRect.left + r.width / 2,
          r.top - stageRect.top + r.height / 2,
          r.width / 2 + Math.max(6, r.width * 0.18),
          r.height / 2 + Math.max(5, r.height * 0.35),
          index,
        ),
      );
      layerEl.appendChild(path);
    }
  }

  // ---- Transient live stroke while dragging (DOM-fallback mode only) ----
  function beginLiveStroke(): SVGPolylineElement {
    const poly = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );
    poly.setAttribute("class", "ink-stroke");
    layerEl.appendChild(poly);
    return poly;
  }

  function updateCount(): void {
    const n = circledTokens(ctx.session, essay.id).length;
    countEl.textContent = n === 1 ? "1 mark made" : `${n} marks made`;
  }

  let feedbackTimer: number | undefined;
  function flashFeedback(msg: string): void {
    feedbackEl.textContent = msg;
    feedbackEl.classList.add("marking__feedback--show");
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      feedbackEl.classList.remove("marking__feedback--show");
    }, 2500);
  }

  function finish(): void {
    if (ended) return;
    ended = true;
    stopTimer();
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    const elapsed = Date.now() - startedAt;
    // Finish the whole run; grading is revealed on the report card.
    ctx.session = finishRun(ctx.session, elapsed);
    nav.go("reportCard");
  }

  function stopTimer(): void {
    if (tickHandle !== undefined) {
      window.clearInterval(tickHandle);
      tickHandle = undefined;
    }
  }

  // ---- Cleanup: clear all timers/listeners + dispose the 3D scene ----
  return () => {
    stopTimer();
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    for (const d of disposers) d();
  };
}

/**
 * The 3D essay controller: everything WebGL-side for the essay screen. Mirrors
 * marking.ts's ThreeController. Created ONLY when a real WebGL context is
 * available.
 */
interface ThreeController {
  canvas: HTMLCanvasElement;
  projectTokenBoxes: () => WordBox[];
  setPointer: (clientX: number, clientY: number) => void;
  beginInk: () => void;
  extendInk: () => void;
  endInk: () => void;
  renderCircledLoops: (indices: number[]) => void;
  dispose: () => void;
}

/** A token's assigned normalised paper coordinate plus its display text. */
interface TokenLayout {
  index: number;
  u: number;
  v: number;
  text: string;
}

/**
 * Lay tokens out on the paper in normalised (u,v) coordinates: left-to-right,
 * wrapping into rows. Pure geometry, so the 3D anchors and the DOM token
 * overlay agree. The essay is longer than a standard answer, so it uses a
 * slightly denser layout that still fits the paper.
 */
function layoutTokens(tokens: readonly Token[]): TokenLayout[] {
  const marginU = 0.08;
  const usableU = 1 - marginU * 2;
  const topV = 0.12;
  const rowV = 0.075;
  const maxRowUnits = 11; // rough character budget per row
  const maxV = 0.94;
  const out: TokenLayout[] = [];
  let row = 0;
  let colUnits = 0;
  for (const token of tokens) {
    const label = token.text;
    const units = Math.max(1.4, label.length * 0.5 + 0.7);
    if (colUnits + units > maxRowUnits && colUnits > 0) {
      row += 1;
      colUnits = 0;
    }
    const u = marginU + (usableU * (colUnits + units / 2)) / maxRowUnits;
    const v = Math.min(maxV, topV + row * rowV);
    out.push({ index: token.index, u, v, text: token.text });
    colUnits += units;
  }
  return out;
}

/**
 * Try to create the 3D scene and its token/ink layer. Returns null when WebGL
 * is unavailable OR anything throws, so the screen falls back to pure DOM. This
 * is the ONLY place createMarkingScene is called here, guarded so the happy-dom
 * smoke test never constructs a WebGLRenderer.
 */
function tryCreateScene(
  container: HTMLElement,
  layout: readonly TokenLayout[],
): ThreeController | null {
  if (!webglAvailable()) return null;
  let scene: MarkingScene;
  try {
    scene = createMarkingScene(container);
  } catch {
    return null;
  }

  // World anchor per token, computed once from its (u,v) on the paper.
  const anchors = new Map<number, THREE.Vector3>();
  for (const l of layout) {
    anchors.set(l.index, scene.paperUvToWorld(l.u, l.v, new THREE.Vector3()));
  }

  // The token sprite quad's world-space half-extent vectors, derived once from
  // the sprite geometry and its on-paper orientation, so we can project each
  // token's actual on-screen size (depth-correct) rather than a fixed box.
  const spriteQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2 - 0.12, 0, 0),
  );
  const halfRight = new THREE.Vector3(SPRITE_WIDTH / 2, 0, 0).applyQuaternion(
    spriteQuat,
  );
  const halfDown = new THREE.Vector3(0, SPRITE_HEIGHT / 2, 0).applyQuaternion(
    spriteQuat,
  );

  // ---- Token text quads on the paper (CanvasTexture sprites) ----
  const tokenGroup = new THREE.Group();
  tokenGroup.name = "essay-tokens";
  const tokenDisposables: Array<() => void> = [];
  for (const l of layout) {
    const anchor = anchors.get(l.index)!;
    const { mesh, dispose } = makeTokenSprite(l.text);
    mesh.position.copy(anchor);
    mesh.rotation.x = -Math.PI / 2 - 0.12;
    tokenGroup.add(mesh);
    tokenDisposables.push(dispose);
  }
  scene.scene.add(tokenGroup);

  // ---- Ink layer: live stroke + persistent circle loops ----
  const inkGroup = new THREE.Group();
  inkGroup.name = "ink";
  scene.scene.add(inkGroup);
  const inkMat = new THREE.LineBasicMaterial({ color: 0xc0182a });
  const liveInkPoints: THREE.Vector3[] = [];
  let liveLine: THREE.Line | undefined;
  const loopLines: THREE.Line[] = [];

  const beginInk = (): void => {
    liveInkPoints.length = 0;
    if (liveLine) {
      inkGroup.remove(liveLine);
      liveLine.geometry.dispose();
      liveLine = undefined;
    }
  };
  const extendInk = (): void => {
    const p = scene.getPaperCursorPoint();
    if (!p) return;
    p.y += 0.015;
    liveInkPoints.push(p);
    if (liveInkPoints.length < 2) return;
    if (liveLine) {
      inkGroup.remove(liveLine);
      liveLine.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry().setFromPoints(liveInkPoints);
    liveLine = new THREE.Line(geo, inkMat);
    inkGroup.add(liveLine);
  };
  const endInk = (): void => {
    if (liveLine) {
      inkGroup.remove(liveLine);
      liveLine.geometry.dispose();
      liveLine = undefined;
    }
    liveInkPoints.length = 0;
  };

  const clearLoopLines = (): void => {
    for (const line of loopLines) {
      inkGroup.remove(line);
      line.geometry.dispose();
    }
    loopLines.length = 0;
  };

  const renderCircledLoops = (indices: number[]): void => {
    clearLoopLines();
    for (const index of indices) {
      const anchor = anchors.get(index);
      if (!anchor) continue;
      const geo = ringGeometry(anchor, index);
      const line = new THREE.LineLoop(geo, inkMat);
      inkGroup.add(line);
      loopLines.push(line);
    }
  };

  const projectTokenBoxes = (): WordBox[] => {
    const vp = scene.getViewProjection();
    const { width, height } = scene.getViewportSize();
    const boxes: WordBox[] = [];
    for (const [index, anchor] of anchors) {
      // Project the token's actual quad corners so the hit-box tracks its
      // depth-correct on-screen size, clamped to a sane minimum floor.
      const box = projectTokenQuadToWordBox(
        index,
        anchor,
        halfRight,
        halfDown,
        vp,
        width,
        height,
        TOKEN_BOX_MIN_WIDTH,
        TOKEN_BOX_MIN_HEIGHT,
      );
      if (box) boxes.push(box);
    }
    return boxes;
  };

  const dispose = (): void => {
    endInk();
    clearLoopLines();
    inkMat.dispose();
    scene.scene.remove(inkGroup);
    for (const d of tokenDisposables) d();
    scene.scene.remove(tokenGroup);
    scene.dispose();
  };

  return {
    canvas: scene.canvas,
    projectTokenBoxes,
    setPointer: scene.setPointer,
    beginInk,
    extendInk,
    endInk,
    renderCircledLoops,
    dispose,
  };
}

/**
 * Probe whether a real WebGL context can be created. Returns false under
 * happy-dom / node / any GPU-free environment, so the smoke test never triggers
 * scene creation.
 */
function webglAvailable(): boolean {
  try {
    if (typeof document === "undefined") return false;
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Build a small line-loop ring around a token anchor to draw a persistent 3D
 * ink circle. Slightly irregular per seed so it reads hand-drawn.
 */
function ringGeometry(
  centre: THREE.Vector3,
  seed: number,
): THREE.BufferGeometry {
  const steps = 28;
  const rx = 0.42;
  const rz = 0.24;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const s = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
    const jitter = 1 + (s - Math.floor(s) - 0.5) * 0.12;
    pts.push(
      new THREE.Vector3(
        centre.x + Math.cos(t) * rx * jitter,
        centre.y + 0.02,
        centre.z + Math.sin(t) * rz * jitter,
      ),
    );
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/**
 * Render a token's text to a CanvasTexture and return a small textured plane to
 * lay on the paper. The texture + geometry are disposed via the returned fn.
 */
function makeTokenSprite(text: string): {
  mesh: THREE.Mesh;
  dispose: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const cx = canvas.getContext("2d");
  if (cx) {
    cx.clearRect(0, 0, canvas.width, canvas.height);
    cx.fillStyle = "#22303f";
    cx.font = "600 60px 'Caveat', 'Comic Sans MS', cursive";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 12);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(0.7, 0.35);
  const mesh = new THREE.Mesh(geo, mat);
  const dispose = (): void => {
    texture.dispose();
    mat.dispose();
    geo.dispose();
  };
  return { mesh, dispose };
}

/** Serialise loop points to an SVG polyline "points" attribute. */
function pointsToAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** Build a slightly irregular closed-ellipse path (hand-drawn pen look). */
function roughEllipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): string {
  const steps = 24;
  const wobble = (i: number): number => {
    const s = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
    return (s - Math.floor(s) - 0.5) * 2;
  };
  const start = -0.25;
  const end = Math.PI * 2 + 0.35;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    const jitterR = 1 + wobble(i) * 0.06;
    const x = cx + Math.cos(t) * rx * jitterR;
    const y = cy + Math.sin(t) * ry * jitterR;
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

const PRAISE = [
  "Sharp eye, examiner.",
  "Marked. Trust that instinct.",
  "Another one flagged - thorough work.",
  "Good instinct. Keep going.",
  "Red pen at the ready!",
];
function pickPraise(): string {
  return PRAISE[Math.floor(Math.random() * PRAISE.length)];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { ESSAY_SECONDS };
