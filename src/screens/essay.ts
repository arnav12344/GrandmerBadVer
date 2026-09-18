/*
 * Grandmer - Essay "free-for-all" screen (FEAT-002 lasso rework).
 *
 * The FINAL paper. Unlike the standard papers there is no hidden error set, so
 * marking here is open and UNGRADED: the examiner freely lassos as many words as
 * they like and none of it feeds the scored hit / miss / false-alarm metrics
 * (consistent with the pure session, which records essay circles as inert
 * notes). The gesture is the SAME hand-drawn red-pen loop used on the standard
 * papers. Tone stays playful and non-shaming, with a generous timer. When the
 * timer expires or the examiner finishes, the run ends and the app transitions
 * to the Report Card.
 *
 * happy-dom cannot do real drag geometry, so a keyboard fallback (Enter/Space on
 * a focused word toggles its circle) keeps the demo and smoke test operable.
 * Every timer, listener and the capture layer are torn down in the cleanup.
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { EssayQuestion, ErrorCategory, Token } from "../game/types";
import type { Point, WordBox } from "../game/lasso";
import { resolveLasso } from "../game/lasso";
import {
  circledTokens,
  currentQuestion,
  finishRun,
  toggleCircle,
} from "../game/session";

/** A little more time for the open essay marking. */
const ESSAY_SECONDS = 45;

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

  const focusChips = essay.focusAreas
    .map((f) => `<span class="essay__chip">${FOCUS_LABELS[f]}</span>`)
    .join("");

  ctx.root.innerHTML = `
    <main class="desk desk--marking">
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
    </main>
  `;

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

  renderExistingCircles();

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
    if (ev.button !== undefined && ev.button !== 0) return;
    drawing = true;
    pointerId = ev.pointerId;
    points = [localPoint(ev)];
    try {
      stageEl.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    liveStroke = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );
    liveStroke.setAttribute("class", "ink-stroke");
    layerEl.appendChild(liveStroke);
    ev.preventDefault();
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    points.push(localPoint(ev));
    if (liveStroke) liveStroke.setAttribute("points", pointsToAttr(points));
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

  function onKeyToggle(tokenIndex: number): void {
    if (ended) return;
    ctx.session = toggleCircle(ctx.session, tokenIndex, Date.now());
    renderExistingCircles();
    updateCount();
    flashFeedback(pickPraise());
  }

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

  function renderExistingCircles(): void {
    while (layerEl.firstChild) layerEl.removeChild(layerEl.firstChild);
    const stageRect = stageEl.getBoundingClientRect();
    layerEl.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, stageRect.width)} ${Math.max(1, stageRect.height)}`,
    );
    const circled = new Set(circledTokens(ctx.session, essay.id));
    for (const [index, el] of tokenEls) {
      const marked = circled.has(index);
      el.classList.toggle("essay__word--marked", marked);
      el.classList.toggle("token--circled", marked);
      el.setAttribute("aria-pressed", marked ? "true" : "false");
      if (!marked) continue;
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

  return () => {
    stopTimer();
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    stageEl.removeEventListener("pointerdown", onPointerDown);
    stageEl.removeEventListener("pointermove", onPointerMove);
    stageEl.removeEventListener("pointerup", onPointerUp);
    stageEl.removeEventListener("pointercancel", onPointerUp);
  };
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
