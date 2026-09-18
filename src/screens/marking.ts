/*
 * Grandmer - Marking screen (FEAT-003: 3D voxel examiner's desk).
 *
 * The core gameplay loop now runs on a full Three.js scene (src/scene): a
 * cartoony voxel examiner sits at a wooden desk, the student's paper lies on
 * the surface, and a 3D pen follows the cursor and lays down a red ink lasso as
 * the examiner draws. The UI chrome (section label, Paper N/total, timer,
 * pager, Finish & Grade, marking streak, feedback) is a PIXEL-ART DOM HUD
 * layered above the WebGL canvas.
 *
 * The interaction contract is unchanged and DEFERRED-graded. For each paper the
 * examiner:
 *  - reads the student's answer, rendered as tokens laid on the 3D paper,
 *  - draws a freehand loop with the pen (pointer / touch drag over the canvas),
 *  - gets NO instant right/wrong feedback (grading is revealed only at the end),
 *  - can FLIP back and forth through the whole paper stack to revise.
 *
 * A word is circled when the loop encloses it, decided by the EXISTING pure
 * resolveLasso (src/game/lasso.ts). To feed it, each token's 3D anchor is
 * PROJECTED to 2D screen space via the pure src/game/projection.ts helper, so
 * the same engine-agnostic hit-test works in 3D. Re-lassoing an already-circled
 * word removes that circle. Circles persist per paper and re-render (as 3D ink
 * loops and DOM markers) when the examiner flips back.
 *
 * CRITICAL sandbox constraint: there is NO GPU / WebGL / headless browser in
 * the test environment. So the 3D scene is created ONLY when a real WebGL
 * context can be obtained (probed + guarded in try/catch); otherwise the screen
 * runs a pure-DOM fallback. The DOM tokens + pixel HUD are ALWAYS rendered, and
 * a keyboard/token toggle (Enter/Space on a focused token) drives marking
 * WITHOUT touching WebGL, so the happy-dom smoke test and keyboard users can
 * play the whole run headlessly. No test ever constructs a WebGLRenderer.
 *
 * Game feel: a marking "momentum" streak builds as the examiner circles quickly
 * (tempo only, NEVER correctness), an escalating timer (calm -> amber -> urgent
 * -> critical) and a pixel stress vignette close in as the clock drains, and the
 * desk shakes on key moments. None of this reveals whether a circle was right or
 * wrong - that stays hidden until the report card.
 *
 * All state transitions go through the pure session helpers. Everything (timers,
 * listeners, animation frames, the 3D scene, and every token/ink object added to
 * it) is torn down in the returned cleanup - no leaks between papers.
 */

import * as THREE from "three";
import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { AnyQuestion, Question, Token } from "../game/types";
import type { Point, WordBox } from "../game/lasso";
import { resolveLasso } from "../game/lasso";
import { projectTokenQuadToWordBox } from "../game/projection";
import { createMarkingScene, type MarkingScene } from "../scene";
import { inkSplatSvg } from "../assets/props";
import {
  circledTokens,
  currentQuestion,
  finishRun,
  goToQuestion,
  toggleCircle,
} from "../game/session";
import { mountEssay } from "./essay";

/** Seconds granted per standard paper (comfortable for a demo). */
const QUESTION_SECONDS = 30;

/** Below this fraction of time left the desk shows "stress lines". */
const STRESS_THRESHOLD = 0.35;

/** Seconds remaining at or below which the timer turns amber (tension rising). */
const AMBER_SECONDS = 15;

/** Seconds remaining at or below which the timer pulses red ("urgent"). */
const URGENT_SECONDS = 10;

/** Seconds remaining at or below which the pulse accelerates ("critical"). */
const CRITICAL_SECONDS = 5;

/** Max ms between two circles for them to count toward a momentum streak. */
const MOMENTUM_WINDOW_MS = 4000;

/**
 * Minimum on-screen token box size (px). The 3D hit-box is now sized from each
 * token's PROJECTED quad (depth-correct), but a heavily foreshortened token is
 * clamped up to this floor so it stays grabbable with a pen loop.
 */
const TOKEN_BOX_MIN_WIDTH = 52;
const TOKEN_BOX_MIN_HEIGHT = 24;

/**
 * The token sprite quad size in world units (matches makeTokenSprite's
 * PlaneGeometry). Used to derive the quad's world-space half-extent vectors for
 * depth-correct projection.
 */
const SPRITE_WIDTH = 0.78;
const SPRITE_HEIGHT = 0.39;

export function mountMarking(ctx: AppContext, nav: Nav): ScreenCleanup {
  const question = currentQuestion(ctx.session);

  // No paper left -> straight to the report card (defensive).
  if (!question) {
    nav.go("reportCard");
    return undefined;
  }

  // The essay free-for-all is its own mode; hand off and let it drive the nav.
  if (question.kind === "essay") {
    return mountEssay(ctx, nav);
  }

  return mountStandardQuestion(ctx, nav, question);
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

function mountStandardQuestion(
  ctx: AppContext,
  nav: Nav,
  question: Question,
): ScreenCleanup {
  // ---- Per-paper mutable UI state ----
  // Per-paper timer that does NOT reset when flipping back: we remember how much
  // time each paper had left, keyed by question id, on the shared session-scoped
  // context. Flipping back to an already-seen paper resumes its remaining time
  // rather than granting a fresh 30s (a coherent, non-exploitable rule).
  const clocks = getClockStore(ctx);
  let remainingMs = clocks[question.id] ?? QUESTION_SECONDS * 1000;

  let ended = false;
  let tickHandle: number | undefined;
  let momentumTimer: number | undefined;
  const disposers: Array<() => void> = [];

  // Momentum streak: how many circles were made within MOMENTUM_WINDOW_MS of
  // each other. Purely about marking rhythm, never about correctness.
  let momentum = 0;
  let lastCircleAt = 0;

  const total = ctx.session.questions.length;
  const number = ctx.session.currentIndex + 1;
  const isFirst = ctx.session.currentIndex === 0;

  // ---- Assign each token a stable normalised (u,v) position on the paper ----
  // Tokens flow left-to-right and wrap into rows, laid within the paper's inner
  // margin. This mapping is shared by the 3D anchor placement and the DOM token
  // overlay so the two stay in registration.
  const layout = layoutTokens(question.tokens);

  ctx.root.innerHTML = `
    <main class="desk desk--marking desk--marking3d" id="marking-desk">
      <div class="scene-layer" id="scene-layer" aria-hidden="true"></div>
      <div class="stress-lines" id="stress-lines" aria-hidden="true"></div>

      <div class="hud" id="hud">
        <header class="marking__bar">
          <span class="marking__section">${escapeHtml(question.section)}</span>
          <span class="marking__count">Paper ${number} / ${total}</span>
        </header>

        <p class="marking__prompt">
          <span class="marking__prompt-label">Exam question:</span>
          ${escapeHtml(question.prompt)}
        </p>

        <section class="paper-card marking__paper">
          <p class="marking__hint">Student's answer - circle anything that looks wrong. Draw a loop with your pen.</p>
          <div class="lasso-stage" id="lasso-stage">
            <p class="handwriting marking__answer" id="answer"></p>
            <svg class="lasso-layer" id="lasso-layer" aria-hidden="true"
                 xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </section>

        <div class="marking__timer">
          <div class="timer-bar" id="timer-bar" role="timer" aria-label="time remaining">
            <div class="timer-bar__fill" id="timer-fill" style="width:100%"></div>
          </div>
          <span class="marking__seconds" id="seconds">${Math.ceil(remainingMs / 1000)}s</span>
        </div>

        <div class="marking__pager">
          <button class="btn btn--ghost" id="prev-btn" type="button" ${isFirst ? "disabled" : ""}>← Prev paper</button>
          <span class="combo-meter" id="combo-meter" aria-live="polite" title="How fast you are marking, not whether a circle was right"></span>
          <button class="btn btn--ghost" id="next-btn" type="button">Next paper →</button>
        </div>

        <div class="marking__actions">
          <button class="btn btn--brass" id="finish-btn" type="button">Finish &amp; Grade →</button>
        </div>

        <div class="marking__feedback" id="feedback" aria-live="polite"></div>
      </div>
    </main>
  `;

  const deskEl = ctx.root.querySelector<HTMLElement>("#marking-desk")!;
  const sceneLayerEl = ctx.root.querySelector<HTMLElement>("#scene-layer")!;
  const stressEl = ctx.root.querySelector<HTMLElement>("#stress-lines")!;
  const stageEl = ctx.root.querySelector<HTMLElement>("#lasso-stage")!;
  const answerEl = ctx.root.querySelector<HTMLElement>("#answer")!;
  const layerEl = ctx.root.querySelector<SVGSVGElement>("#lasso-layer")!;
  const fillEl = ctx.root.querySelector<HTMLElement>("#timer-fill")!;
  const secondsEl = ctx.root.querySelector<HTMLElement>("#seconds")!;
  const prevBtn = ctx.root.querySelector<HTMLButtonElement>("#prev-btn")!;
  const nextBtn = ctx.root.querySelector<HTMLButtonElement>("#next-btn")!;
  const finishBtn = ctx.root.querySelector<HTMLButtonElement>("#finish-btn")!;
  const comboEl = ctx.root.querySelector<HTMLElement>("#combo-meter")!;
  const feedbackEl = ctx.root.querySelector<HTMLElement>("#feedback")!;

  // ---- Render tokens (keyboard-toggleable fallback, always present) ----
  const tokenEls = new Map<number, HTMLElement>();
  renderTokens(answerEl, question.tokens, tokenEls, onTokenKeyToggle);

  // ---- Try to stand up the 3D scene (guarded: never runs under happy-dom) ----
  // The scene is optional enrichment; if WebGL is unavailable the whole screen
  // runs as the pure-DOM fallback below and the smoke test drives it via the
  // keyboard toggle.
  const three = tryCreateScene(sceneLayerEl, layout, tokenEls, question.tokens);
  if (three) {
    deskEl.classList.add("desk--3d-on");
    disposers.push(three.dispose);
  }

  // Draw whatever circles already exist for this paper (persist across flips).
  renderExistingCircles();

  // ---- Timer ----
  // The timer treatment escalates in urgency as the clock drains:
  //   calm -> amber -> red pulse (<= URGENT_SECONDS) -> accelerating pulse
  //   (<= CRITICAL_SECONDS). Crossing a threshold gives the desk a brief shake
  //   so the moment lands. None of this reveals correctness; it is pure tempo.
  const timerBarEl = ctx.root.querySelector<HTMLElement>("#timer-bar")!;
  const startedAt = Date.now();
  let urgencyLevel = 0; // 0 calm, 1 amber, 2 urgent, 3 critical
  tickHandle = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const shown = Math.max(0, remainingMs - elapsed);
    const pct = (shown / (QUESTION_SECONDS * 1000)) * 100;
    fillEl.style.width = `${Math.max(0, pct)}%`;
    secondsEl.textContent = `${Math.ceil(shown / 1000)}s`;
    const secondsLeft = shown / 1000;

    // Escalate the timer's urgency in steps, shaking the desk on each new step.
    const nextLevel =
      secondsLeft <= CRITICAL_SECONDS
        ? 3
        : secondsLeft <= URGENT_SECONDS
          ? 2
          : secondsLeft <= AMBER_SECONDS
            ? 1
            : 0;
    if (nextLevel !== urgencyLevel) {
      if (nextLevel > urgencyLevel && nextLevel >= 2) bumpDesk();
      urgencyLevel = nextLevel;
    }
    timerBarEl.classList.toggle("timer-bar--amber", urgencyLevel === 1);
    timerBarEl.classList.toggle("timer-bar--urgent", urgencyLevel === 2);
    timerBarEl.classList.toggle("timer-bar--critical", urgencyLevel >= 3);

    // Stress lines close in AND intensify as the clock drains: below the stress
    // threshold, ramp a 0..1 intensity that CSS maps to opacity/thickness so it
    // is a visible build-up, not a binary on/off.
    const frac = shown / (QUESTION_SECONDS * 1000);
    if (frac <= STRESS_THRESHOLD) {
      const intensity =
        STRESS_THRESHOLD <= 0
          ? 1
          : Math.min(1, (STRESS_THRESHOLD - frac) / STRESS_THRESHOLD);
      stressEl.classList.add("stress-lines--on");
      stressEl.style.setProperty("--stress", intensity.toFixed(3));
      deskEl.classList.add("desk--stressed");
      if (three) three.setShake(intensity);
    } else {
      stressEl.classList.remove("stress-lines--on");
      stressEl.style.setProperty("--stress", "0");
      deskEl.classList.remove("desk--stressed");
      if (three) three.setShake(0);
    }
    if (shown <= 0) {
      // This paper's time is up -> finish the whole stack and grade.
      persistClock(0);
      finishAndGrade();
    }
  }, 100);

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
    // resolveLasso only needs a consistent 2D space. In 3D mode the loop points
    // are taken relative to the CANVAS top-left, and the projection viewport is
    // now also derived from the canvas rect (see markingScene.getViewportSize),
    // so both the loop origin and the projected token boxes live in the SAME
    // canvas-relative space regardless of how .scene-layer is positioned in
    // CSS. In DOM mode captureEl is the stage and token boxes are measured the
    // same way, so both remain consistent there too.
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
      // happy-dom / older browsers may not implement pointer capture; ignore.
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
      // Remove the transient live stroke; persistent strokes are re-derived.
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

  // ---- Pager + finish ----
  prevBtn.addEventListener("click", () => flip(ctx.session.currentIndex - 1));
  nextBtn.addEventListener("click", () => flip(ctx.session.currentIndex + 1));
  finishBtn.addEventListener("click", () => finishAndGrade());

  // ---- Resolve a completed freehand stroke into circle toggles ----
  function resolveStroke(loop: readonly Point[]): void {
    if (ended) return;
    // Need a real loop to enclose anything.
    if (loop.length < 3) return;

    const boxes = measureTokenBoxes();
    const enclosed = resolveLasso(loop, boxes);
    if (enclosed.length === 0) {
      flashFeedback("No word caught in that loop - try circling closer.");
      return;
    }

    let added = 0;
    let removed = 0;
    let lastAddedIndex = -1;
    const before = new Set(circledTokens(ctx.session, question.id));
    for (const idx of enclosed) {
      ctx.session = toggleCircle(ctx.session, idx, Date.now());
      if (before.has(idx)) removed += 1;
      else {
        added += 1;
        lastAddedIndex = idx;
      }
    }

    renderExistingCircles();

    // Momentum only counts when the loop ADDED at least one new circle.
    if (added > 0) {
      const now = Date.now();
      if (now - lastCircleAt <= MOMENTUM_WINDOW_MS) {
        momentum += 1;
      } else {
        momentum = 1;
      }
      lastCircleAt = now;
      showCombo();
      if (momentum >= 2) bumpDesk();
      splatAtToken(lastAddedIndex);
      resetMomentumDecay();
    }

    if (added > 0 && removed === 0) {
      flashFeedback(pickInkLine());
    } else if (removed > 0 && added === 0) {
      flashFeedback("Rubbed that circle out. Change of heart, examiner?");
    } else if (added > 0 && removed > 0) {
      flashFeedback("Reworked your marks on that spot.");
    }
  }

  // ---- Keyboard fallback: Enter/Space toggles the focused token ----
  // This path NEVER touches WebGL, so happy-dom and keyboard users can drive the
  // whole run. It is the path the smoke test exercises.
  function onTokenKeyToggle(tokenIndex: number): void {
    if (ended) return;
    const before = new Set(circledTokens(ctx.session, question.id));
    ctx.session = toggleCircle(ctx.session, tokenIndex, Date.now());
    renderExistingCircles();
    if (!before.has(tokenIndex)) {
      const now = Date.now();
      momentum = now - lastCircleAt <= MOMENTUM_WINDOW_MS ? momentum + 1 : 1;
      lastCircleAt = now;
      showCombo();
      if (momentum >= 2) bumpDesk();
      splatAtToken(tokenIndex);
      resetMomentumDecay();
      flashFeedback(pickInkLine());
    } else {
      flashFeedback("Rubbed that circle out. Change of heart, examiner?");
    }
  }

  // ---- Build WordBoxes for resolveLasso ----
  // In 3D mode we PROJECT each token's 3D paper anchor to screen pixels via the
  // pure projection helper (the deferred-grading contract is untouched; this is
  // pure geometry). In DOM-fallback mode we measure the real token boxes. Both
  // feed the SAME resolveLasso.
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

  // ---- Re-derive and draw persistent ink circles from the session ----
  function renderExistingCircles(): void {
    const circled = new Set(circledTokens(ctx.session, question.id));

    // Update DOM token state (used by keyboard fallback + smoke assertions).
    for (const [index, el] of tokenEls) {
      const marked = circled.has(index);
      el.classList.toggle("token--circled", marked);
      el.setAttribute("aria-pressed", marked ? "true" : "false");
    }

    if (three) {
      // Persistent 3D ink loops on the paper. Also mirror a lightweight DOM
      // marker (see below) so `.ink-circle` presence stays consistent.
      three.renderCircledLoops([...circled]);
    }

    // Persistent DOM ink circles. These are the primary visuals in DOM-fallback
    // mode and a always-present marker (`.ink-circle`) the smoke test asserts.
    while (layerEl.firstChild) layerEl.removeChild(layerEl.firstChild);
    const stageRect = stageEl.getBoundingClientRect();
    layerEl.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, stageRect.width)} ${Math.max(1, stageRect.height)}`,
    );
    for (const [index, el] of tokenEls) {
      if (!circled.has(index)) continue;
      const r = el.getBoundingClientRect();
      drawInkCircle(
        r.left - stageRect.left,
        r.top - stageRect.top,
        r.width,
        r.height,
        index,
      );
    }
  }

  /** Draw a hand-drawn, slightly rough red ink ellipse around a token box. */
  function drawInkCircle(
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
  ): void {
    const padX = Math.max(6, w * 0.18);
    const padY = Math.max(5, h * 0.35);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2 + padX;
    const ry = h / 2 + padY;
    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path.setAttribute("class", "ink-circle");
    path.setAttribute("d", roughEllipsePath(cx, cy, rx, ry, seed));
    layerEl.appendChild(path);
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

  // ---- Momentum / combo callout ----
  // Labelled HONESTLY: this is a marking-streak / tempo meter (how fast you are
  // circling), NOT a reveal of whether any circle was right. Grading is
  // deferred; the true consecutive-HIT Best Combo appears on the report card.
  function showCombo(): void {
    if (momentum >= 2) {
      comboEl.textContent = `Marking Streak x${momentum}`;
      comboEl.classList.remove("combo-meter--pop");
      void comboEl.offsetWidth; // reflow so the pop animation retriggers
      comboEl.classList.add("combo-meter--pop");
    } else {
      comboEl.textContent = "";
    }
  }

  // ---- Ink-splatter / combo-burst flourish on a marking moment ----
  // A short-lived decorative red splatter dropped near the circled word. It is
  // purely atmospheric (pointer-events:none so it never blocks the lasso layer)
  // and carries NO correctness meaning.
  const splatTimers = new Set<number>();
  function burstInkSplat(x: number, y: number): void {
    const splat = document.createElement("div");
    splat.className = "ink-splat";
    splat.setAttribute("aria-hidden", "true");
    splat.style.left = `${x}px`;
    splat.style.top = `${y}px`;
    // A bigger streak throws a bigger splatter, capped so it stays tasteful.
    const scale = Math.min(1.5, 0.7 + momentum * 0.18);
    splat.style.setProperty("--splat-scale", scale.toFixed(2));
    splat.innerHTML = inkSplatSvg;
    stageEl.appendChild(splat);
    const handle = window.setTimeout(() => {
      splatTimers.delete(handle);
      if (splat.parentNode) splat.parentNode.removeChild(splat);
    }, 650);
    splatTimers.add(handle);
  }

  /** Throw an ink splatter over a token, positioned relative to the stage. */
  function splatAtToken(tokenIndex: number): void {
    const el = tokenEls.get(tokenIndex);
    if (!el) return;
    const stageRect = stageEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    burstInkSplat(
      r.left - stageRect.left + r.width / 2,
      r.top - stageRect.top + r.height / 2,
    );
  }

  function bumpDesk(): void {
    deskEl.classList.remove("desk--shake");
    void deskEl.offsetWidth;
    deskEl.classList.add("desk--shake");
    if (three) three.pulseShake();
  }

  function resetMomentumDecay(): void {
    if (momentumTimer) window.clearTimeout(momentumTimer);
    momentumTimer = window.setTimeout(() => {
      momentum = 0;
      comboEl.textContent = "";
    }, MOMENTUM_WINDOW_MS);
  }

  // ---- Transient feedback line ----
  let feedbackTimer: number | undefined;
  function flashFeedback(msg: string): void {
    feedbackEl.textContent = msg;
    feedbackEl.classList.add("marking__feedback--show");
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      feedbackEl.classList.remove("marking__feedback--show");
    }, 3000);
  }

  // ---- Save remaining time for this paper (so flipping back resumes it) ----
  function persistClock(value?: number): void {
    const shown =
      value !== undefined
        ? value
        : Math.max(0, remainingMs - (Date.now() - startedAt));
    clocks[question.id] = shown;
  }

  function stopTimers(): void {
    if (tickHandle !== undefined) {
      window.clearInterval(tickHandle);
      tickHandle = undefined;
    }
    if (momentumTimer !== undefined) {
      window.clearTimeout(momentumTimer);
      momentumTimer = undefined;
    }
    if (feedbackTimer !== undefined) {
      window.clearTimeout(feedbackTimer);
      feedbackTimer = undefined;
    }
    for (const handle of splatTimers) window.clearTimeout(handle);
    splatTimers.clear();
  }

  // ---- Flip to another paper WITHOUT grading ----
  function flip(index: number): void {
    if (ended) return;
    if (index < 0 || index >= ctx.session.questions.length) return;
    if (index === ctx.session.currentIndex) return;
    persistClock();
    stopTimers();
    // goToQuestion accumulates elapsed on the paper we leave; we track the clock
    // ourselves, so pass 0 to avoid double counting and just move the index.
    ctx.session = goToQuestion(ctx.session, index, 0);
    // Re-mount the marking screen for the target paper (handles essay hand-off).
    nav.go("marking");
  }

  // ---- Finish the whole stack and reveal grading on the report card ----
  function finishAndGrade(): void {
    if (ended) return;
    ended = true;
    // A brief shake punctuates finishing the paper stack (a key moment).
    bumpDesk();
    persistClock();
    stopTimers();
    const elapsed = Date.now() - startedAt;
    ctx.session = finishRun(ctx.session, elapsed);
    nav.go("reportCard");
  }

  // ---- Cleanup: clear all timers/listeners/frames + dispose the 3D scene ----
  // The scene disposer (pushed into `disposers`) tears down the renderer,
  // listeners and animation frame plus the token/ink objects we added.
  return () => {
    stopTimers();
    for (const d of disposers) d();
  };
}

/**
 * The 3D marking controller: everything WebGL-side for the marking screen. It
 * owns the MarkingScene handle plus the token/ink objects added to the scene,
 * and exposes a small API the screen drives (projecting token boxes for the
 * lasso, laying down live/persistent ink, camera shake). Created ONLY when a
 * real WebGL context is available.
 */
interface ThreeController {
  canvas: HTMLCanvasElement;
  /** Project every token's 3D anchor to a screen-space WordBox for resolveLasso. */
  projectTokenBoxes: () => WordBox[];
  /** Update the tracked pointer (drives the pen). */
  setPointer: (clientX: number, clientY: number) => void;
  /** Start a fresh live ink stroke at the current pen tip. */
  beginInk: () => void;
  /** Add the current pen tip to the live ink stroke. */
  extendInk: () => void;
  /** Finish the live ink stroke (it fades; circles are re-derived). */
  endInk: () => void;
  /** Redraw the persistent circled-word ink loops for the given token indices. */
  renderCircledLoops: (indices: number[]) => void;
  /** Set a sustained camera-shake intensity (0..1) for timer stress. */
  setShake: (intensity: number) => void;
  /** Trigger a brief camera-shake pulse (combo / finish punctuation). */
  pulseShake: () => void;
  /** Tear down the scene and every token/ink object we added. */
  dispose: () => void;
}

/** A token's assigned normalised paper coordinate plus its display text. */
interface TokenLayout {
  index: number;
  u: number;
  v: number;
  text: string;
  isGap: boolean;
}

/**
 * Lay tokens out on the paper in normalised (u,v) coordinates: left-to-right,
 * wrapping into rows. Pure geometry, so the 3D anchors and the DOM token
 * overlay agree. Gaps take a slim slot so spacing reads naturally.
 */
function layoutTokens(tokens: readonly Token[]): TokenLayout[] {
  const marginU = 0.08;
  const usableU = 1 - marginU * 2;
  const topV = 0.14;
  const rowV = 0.11;
  const maxRowUnits = 9; // rough character budget per row
  const out: TokenLayout[] = [];
  let row = 0;
  let colUnits = 0;
  for (const token of tokens) {
    const label = token.isGap ? " " : token.text;
    const units = Math.max(1.4, label.length * 0.55 + 0.8);
    if (colUnits + units > maxRowUnits && colUnits > 0) {
      row += 1;
      colUnits = 0;
    }
    const u = marginU + (usableU * (colUnits + units / 2)) / maxRowUnits;
    const v = topV + row * rowV;
    out.push({
      index: token.index,
      u,
      v: Math.min(0.92, v),
      text: token.text,
      isGap: !!token.isGap,
    });
    colUnits += units;
  }
  return out;
}

/**
 * Try to create the 3D scene and its token/ink layer. Returns null when WebGL
 * is unavailable OR anything throws, so the screen falls back to pure DOM. This
 * is the ONLY place createMarkingScene is called, and it is guarded so the
 * happy-dom smoke test never constructs a WebGLRenderer.
 */
function tryCreateScene(
  container: HTMLElement,
  layout: readonly TokenLayout[],
  _tokenEls: Map<number, HTMLElement>,
  tokens: readonly Token[],
): ThreeController | null {
  if (!webglAvailable()) return null;
  let scene: MarkingScene;
  try {
    scene = createMarkingScene(container);
  } catch {
    return null;
  }

  const textByIndex = new Map<number, string>();
  for (const t of tokens) textByIndex.set(t.index, t.isGap ? "" : t.text);

  // World anchor per token, computed once from its (u,v) on the paper.
  const anchors = new Map<number, THREE.Vector3>();
  for (const l of layout) {
    anchors.set(l.index, scene.paperUvToWorld(l.u, l.v, new THREE.Vector3()));
  }

  // The token sprite quad's world-space half-extent vectors, derived once from
  // the sprite geometry (SPRITE_WIDTH x SPRITE_HEIGHT) and its on-paper
  // orientation. These let us project the token's actual on-screen size
  // (depth-correct) rather than a fixed pixel box: halfRight runs along the
  // paper's right axis, halfDown along the page-down axis (including the paper
  // back-tilt). Shared by every token since they share one orientation.
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
  tokenGroup.name = "answer-tokens";
  const tokenDisposables: Array<() => void> = [];
  for (const l of layout) {
    if (l.isGap) continue;
    const anchor = anchors.get(l.index)!;
    const { mesh, dispose } = makeTokenSprite(l.text);
    mesh.position.copy(anchor);
    // Lay the sprite flat on the tilted paper (match the paper's back tilt).
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
    // Lift the ink a touch above the paper so it does not z-fight the sheet.
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
      // depth-correct on-screen size, clamped to a sane minimum so a heavily
      // foreshortened token stays grabbable.
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
    // Camera shake / setShake are no-ops in the current scene handle; nothing
    // extra to unwind. Finally tear down the scene itself.
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
    // The scene handle does not currently expose a camera-shake hook, so these
    // are gentle no-ops kept for API stability (the pixel stress vignette + DOM
    // desk shake already carry the stress juice).
    setShake: () => {},
    pulseShake: () => {},
    dispose,
  };
}

/**
 * Build a small line-loop ring around a token anchor to draw a persistent 3D
 * ink circle. Slightly irregular per seed so it reads hand-drawn.
 */
function ringGeometry(centre: THREE.Vector3, seed: number): THREE.BufferGeometry {
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
    cx.font = "600 64px 'Caveat', 'Comic Sans MS', cursive";
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
  const geo = new THREE.PlaneGeometry(0.78, 0.39);
  const mesh = new THREE.Mesh(geo, mat);
  const dispose = (): void => {
    texture.dispose();
    mat.dispose();
    geo.dispose();
  };
  return { mesh, dispose };
}

/**
 * Per-run store of remaining time per paper, keyed by question id. It must
 * survive the screen re-mounts that happen as the student flips between papers
 * (so a paper resumes its remaining time instead of getting a fresh 30s), yet
 * reset when a brand-new run starts.
 *
 * The AppContext object is stable across a whole app lifetime (Play Again keeps
 * the same ctx but swaps in a fresh session), so we hang the store off the ctx
 * via a WeakMap and reset it whenever we detect the start of a fresh run: the
 * session has recorded no actions, no elapsed time, and sits on the first paper.
 */
interface ClockEntry {
  store: Record<string, number>;
}
const CLOCKS = new WeakMap<object, ClockEntry>();
function getClockStore(ctx: AppContext): Record<string, number> {
  const key = ctx as unknown as object;
  const freshRun =
    ctx.session.currentIndex === 0 &&
    ctx.session.actions.length === 0 &&
    Object.keys(ctx.session.elapsedByQuestion).length === 0;
  let entry = CLOCKS.get(key);
  if (!entry || freshRun) {
    entry = { store: {} };
    CLOCKS.set(key, entry);
  }
  return entry.store;
}

/** Render tokens into the answer element, wiring a keyboard toggle fallback. */
function renderTokens(
  target: HTMLElement,
  tokens: readonly Token[],
  tokenEls: Map<number, HTMLElement>,
  onKeyToggle: (tokenIndex: number) => void,
): void {
  target.innerHTML = "";
  tokenEls.clear();
  for (const token of tokens) {
    const el = document.createElement("span");
    // A punctuation gap looks exactly like ordinary spacing (no clues); it stays
    // a lasso-able / focusable target.
    el.className = token.isGap ? "token token--gap" : "token";
    el.dataset.text = token.text;
    el.dataset.index = String(token.index);
    el.textContent = token.isGap ? "\u00A0" : token.text;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-pressed", "false");
    // Keep the accessible label neutral: never announce which spots are errors.
    el.setAttribute("aria-label", token.isGap ? "gap" : token.text);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onKeyToggle(token.index);
      }
    });
    tokenEls.set(token.index, el);
    target.appendChild(el);
    // Preserve spacing between word tokens (gaps blend into the spacing).
    target.appendChild(document.createTextNode(" "));
  }
}

/** Serialise loop points to an SVG polyline "points" attribute. */
function pointsToAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/**
 * Build a slightly irregular closed-ellipse path so the ink looks hand-drawn
 * rather than a perfect vector oval. Deterministic per seed so a paper's marks
 * do not jitter when re-rendered on a flip-back.
 */
function roughEllipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): string {
  const steps = 24;
  // A cheap deterministic pseudo-random from the seed + step.
  const wobble = (i: number): number => {
    const s = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
    return (s - Math.floor(s) - 0.5) * 2; // -1..1
  };
  // Start slightly before 0 and overshoot past 2pi so the loop visibly closes
  // with a little tail, like a real pen circle.
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

const INK_LINES = [
  "Circled. Trust that instinct, examiner.",
  "Red pen strikes! Keep scanning.",
  "Marked for review. On you go.",
  "Nice loop. Anything else catch your eye?",
  "Flagged. The report card will tell all.",
];
function pickInkLine(): string {
  return INK_LINES[Math.floor(Math.random() * INK_LINES.length)];
}

/** Escape user/data text before inserting into innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Re-export so callers can share the constant if needed.
export { QUESTION_SECONDS };
export type { AnyQuestion };
