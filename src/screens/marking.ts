/*
 * Grandmer - Marking screen (FEAT-002 lasso rework).
 *
 * The core gameplay loop, reworked from the old click-to-fix instant-check UI
 * to a hand-drawn LASSO with DEFERRED grading. For each paper the examiner:
 *  - reads the student's handwritten answer, rendered as positioned tokens,
 *  - draws a freehand loop (pointer / touch drag tracing a red examiner's-pen
 *    ink stroke) around any word or spot they suspect is wrong,
 *  - gets NO instant right/wrong feedback (grading is revealed only at the end),
 *  - can FLIP back and forth through the whole paper stack to review and revise
 *    before finishing.
 *
 * A word is circled when the loop encloses or substantially overlaps it, decided
 * by the pure resolveLasso (src/game/lasso.ts) fed the tokens' REAL measured
 * boxes at pointerup. Re-lassoing an already-circled word removes that circle.
 * Circles persist per paper and re-render (as red ink strokes) when the student
 * flips back. A prominent per-paper timer adds speed pressure; when time runs
 * low the desk gets "stress lines". A Finish & Grade action and per-paper timer
 * expiry both end the stack and navigate to the report card.
 *
 * Game feel: a marking "momentum" streak builds as the examiner circles quickly,
 * popping combo callouts and shaking the desk, and stress lines close in as the
 * clock drains. None of this reveals whether a circle was right or wrong - that
 * stays hidden until the report card.
 *
 * All state transitions go through the pure session helpers; the countdown and
 * pointer capture are UI concerns and everything (timers, listeners, capture
 * layer) is torn down in the returned cleanup - no leaks between papers.
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { AnyQuestion, Question, Token } from "../game/types";
import type { Point, WordBox } from "../game/lasso";
import { resolveLasso } from "../game/lasso";
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
  // The last non-essay flip target; the final paper is the essay, so "next"
  // from the last standard paper simply moves into the essay via the router.

  ctx.root.innerHTML = `
    <main class="desk desk--marking" id="marking-desk">
      <div class="stress-lines" id="stress-lines" aria-hidden="true"></div>

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
    </main>
  `;

  const deskEl = ctx.root.querySelector<HTMLElement>("#marking-desk")!;
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

  // ---- Render tokens (keyboard-toggleable fallback) ----
  const tokenEls = new Map<number, HTMLElement>();
  renderTokens(answerEl, question.tokens, tokenEls, onTokenKeyToggle);

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
    } else {
      stressEl.classList.remove("stress-lines--on");
      stressEl.style.setProperty("--stress", "0");
      deskEl.classList.remove("desk--stressed");
    }
    if (shown <= 0) {
      // This paper's time is up -> finish the whole stack and grade.
      persistClock(0);
      finishAndGrade();
    }
  }, 100);

  // ---- Pointer lasso capture ----
  let drawing = false;
  let points: Point[] = [];
  let pointerId: number | undefined;
  let liveStroke: SVGPolylineElement | undefined;

  function localPoint(ev: PointerEvent): Point {
    const rect = stageEl.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  const onPointerDown = (ev: PointerEvent): void => {
    if (ended) return;
    // Ignore clicks that start on a control (buttons live outside the stage,
    // but guard anyway) and non-primary buttons.
    if (ev.button !== undefined && ev.button !== 0) return;
    drawing = true;
    pointerId = ev.pointerId;
    points = [localPoint(ev)];
    try {
      stageEl.setPointerCapture(ev.pointerId);
    } catch {
      // happy-dom / older browsers may not implement pointer capture; ignore.
    }
    liveStroke = beginLiveStroke();
    ev.preventDefault();
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    points.push(localPoint(ev));
    if (liveStroke) {
      liveStroke.setAttribute("points", pointsToAttr(points));
    }
    ev.preventDefault();
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    drawing = false;
    try {
      stageEl.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    // Remove the transient live stroke; persistent strokes are re-derived below.
    if (liveStroke && liveStroke.parentNode) {
      liveStroke.parentNode.removeChild(liveStroke);
    }
    liveStroke = undefined;
    resolveStroke(points);
    points = [];
    pointerId = undefined;
    ev.preventDefault();
  };

  stageEl.addEventListener("pointerdown", onPointerDown);
  stageEl.addEventListener("pointermove", onPointerMove);
  stageEl.addEventListener("pointerup", onPointerUp);
  stageEl.addEventListener("pointercancel", onPointerUp);
  disposers.push(() => {
    stageEl.removeEventListener("pointerdown", onPointerDown);
    stageEl.removeEventListener("pointermove", onPointerMove);
    stageEl.removeEventListener("pointerup", onPointerUp);
    stageEl.removeEventListener("pointercancel", onPointerUp);
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

  // ---- Measure each token's box relative to the capture layer ----
  function measureTokenBoxes(): WordBox[] {
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
    // Clear existing persistent strokes.
    while (layerEl.firstChild) layerEl.removeChild(layerEl.firstChild);

    const stageRect = stageEl.getBoundingClientRect();
    layerEl.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, stageRect.width)} ${Math.max(1, stageRect.height)}`,
    );

    const circled = new Set(circledTokens(ctx.session, question.id));
    for (const [index, el] of tokenEls) {
      const marked = circled.has(index);
      el.classList.toggle("token--circled", marked);
      el.setAttribute("aria-pressed", marked ? "true" : "false");
      if (!marked) continue;
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

  // ---- Transient live stroke while dragging ----
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

  // ---- Cleanup: clear all timers/listeners between papers ----
  return () => {
    stopTimers();
    for (const d of disposers) d();
  };
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
