/*
 * Grandmer — Essay "free-for-all" screen (FEAT-003).
 *
 * The FINAL question. Unlike the standard papers there is no single hidden
 * error set — the examiner freely marks as many spots in the student's essay
 * as they like. Each word the player marks is captured as an action so it
 * flows into the session's speed / accuracy / combo metrics. Tone is playful
 * and immersive: "your call, examiner". A generous timer, then the run
 * finishes and the app transitions to the Report Card.
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { EssayQuestion, ErrorCategory, RecordedAction } from "../game/types";
import { applyAction, currentQuestion, gradeAndAdvance } from "../game/session";

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

  const questionStart = Date.now();
  let locked = false;
  let tickHandle: number | undefined;
  let markCount = 0;

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
          Free marking — this one's your call, examiner. Circle every word that
          catches your eye. There's no single right answer here.
        </p>
        <p class="handwriting marking__answer essay__answer" id="essay-answer"></p>
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

  const answerEl = ctx.root.querySelector<HTMLElement>("#essay-answer")!;
  const fillEl = ctx.root.querySelector<HTMLElement>("#timer-fill")!;
  const secondsEl = ctx.root.querySelector<HTMLElement>("#seconds")!;
  const finishBtn = ctx.root.querySelector<HTMLButtonElement>("#finish-btn")!;
  const countEl = ctx.root.querySelector<HTMLElement>("#mark-count")!;
  const feedbackEl = ctx.root.querySelector<HTMLElement>("#feedback")!;

  // Split the essay into clickable words; each mark is a captured action.
  const words = essay.text.split(/\s+/).filter(Boolean);
  answerEl.innerHTML = "";
  words.forEach((word, idx) => {
    const el = document.createElement("span");
    el.className = "token essay__word";
    el.textContent = word;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", word);
    const mark = (): void => onMark(el, idx);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      mark();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        mark();
      }
    });
    answerEl.appendChild(el);
    answerEl.appendChild(document.createTextNode(" "));
  });

  // ---- Timer ----
  const startedAt = Date.now();
  tickHandle = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remainingMs = Math.max(0, ESSAY_SECONDS * 1000 - elapsed);
    fillEl.style.width = `${(remainingMs / (ESSAY_SECONDS * 1000)) * 100}%`;
    secondsEl.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    if (remainingMs <= 0) finish();
  }, 100);

  finishBtn.addEventListener("click", () => finish());

  // Track which words are already marked so re-clicking toggles harmlessly.
  const marked = new Set<number>();

  function onMark(el: HTMLElement, idx: number): void {
    if (locked) return;
    if (marked.has(idx)) {
      // Un-mark: playful, reversible, non-shaming.
      marked.delete(idx);
      el.classList.remove("essay__word--marked");
      markCount = Math.max(0, markCount - 1);
      updateCount();
      return;
    }
    // Category rotates through the essay's focus areas. Compute the index from
    // the CURRENT count (before incrementing) so the first mark maps to the
    // first focus area rather than the second.
    const category =
      essay.focusAreas[markCount % essay.focusAreas.length] ?? null;

    marked.add(idx);
    el.classList.add("essay__word--marked");
    markCount += 1;
    updateCount();

    // The essay is a free-for-all with no answer key, so a mark is NOT a
    // graded "correct" — recording it as such would inflate score, accuracy,
    // combo and the strongest-topic metric with fabricated data. We record it
    // as an ungraded "note": captured for the record (and for speed timing),
    // but excluded from the scored metrics on the report card.
    const action: RecordedAction = {
      questionId: essay.id,
      category,
      outcome: "note",
      timestamp: Date.now(),
    };
    ctx.session = applyAction(ctx.session, action);

    flashFeedback(pickPraise());
  }

  function updateCount(): void {
    countEl.textContent =
      markCount === 1 ? "1 mark made" : `${markCount} marks made`;
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
    if (locked) return;
    locked = true;
    stopTimer();
    if (feedbackTimer) window.clearTimeout(feedbackTimer);

    const elapsed = Date.now() - questionStart;
    // Advance the session; this is the last question, so it marks finished.
    ctx.session = gradeAndAdvance(ctx.session, elapsed);
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
  };
}

const PRAISE = [
  "Sharp eye, examiner.",
  "Marked. Trust that instinct.",
  "Another one flagged — thorough work.",
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
