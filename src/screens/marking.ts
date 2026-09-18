/*
 * Grandmer — Marking screen (FEAT-003).
 *
 * The core gameplay loop. For each question the examiner:
 *  - reads the student's handwritten answer, rendered as clickable tokens,
 *  - clicks a spot they suspect is wrong (detective-style, no clues),
 *  - fixes it: spelling -> dropdown of corrections; punctuation -> click
 *    inserts the mark; word -> pick the correct word,
 *  - races a live countdown timer bar.
 *
 * When the timer expires (or the player ticks "Next"), the question is locked,
 * graded via scoring.ts (a wax-red grade stamp appears), brief non-shaming
 * feedback highlights the error types involved, then the run advances. The
 * FINAL question is an essay "free-for-all" delegated to the essay mode.
 *
 * All state transitions go through session.ts; the countdown itself is a UI
 * concern and every timer is cleared between questions (no leaked intervals).
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type {
  AnyQuestion,
  ClickInteraction,
  ErrorCategory,
  GrammarError,
  Question,
  RecordedAction,
  Token,
} from "../game/types";
import { resolveClick, checkFix } from "../game/errors";
import {
  applyAction,
  currentQuestion,
  gradeAndAdvance,
  gradeForQuestion,
} from "../game/session";
import { mountEssay } from "./essay";

/** Seconds granted per standard question (comfortable for a demo). */
const QUESTION_SECONDS = 30;

/** Human-friendly labels for each grammar category (used in feedback). */
const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  preposition: "prepositions",
  tense: "verb tenses",
  spelling: "spelling",
  punctuation: "punctuation",
  "sentence-structure": "sentence structure",
};

export function mountMarking(ctx: AppContext, nav: Nav): ScreenCleanup {
  const question = currentQuestion(ctx.session);

  // No question left -> straight to the report card (defensive).
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
  // ---- Per-question mutable UI state ----
  const questionStart = Date.now();
  let remainingMs = QUESTION_SECONDS * 1000;
  let locked = false;
  let tickHandle: number | undefined;
  const disposers: Array<() => void> = [];

  // Which errors have already been resolved (so re-clicking doesn't double-count).
  const resolvedErrorIds = new Set<string>();
  // Open popover cleanup (only one dropdown at a time).
  let closePopover: (() => void) | undefined;

  // Progress label: q index / total, essay excluded from the count wording.
  const total = ctx.session.questions.length;
  const number = ctx.session.currentIndex + 1;

  ctx.root.innerHTML = `
    <main class="desk desk--marking">
      <header class="marking__bar">
        <span class="marking__section">${escapeHtml(question.section)}</span>
        <span class="marking__count">Paper ${number} / ${total}</span>
      </header>

      <p class="marking__prompt">
        <span class="marking__prompt-label">Exam question:</span>
        ${escapeHtml(question.prompt)}
      </p>

      <section class="paper-card marking__paper">
        <p class="marking__hint">Student's answer — find and fix the mistakes.</p>
        <p class="handwriting marking__answer" id="answer"></p>
      </section>

      <div class="marking__timer">
        <div class="timer-bar" role="timer" aria-label="time remaining">
          <div class="timer-bar__fill" id="timer-fill" style="width:100%"></div>
        </div>
        <span class="marking__seconds" id="seconds">${QUESTION_SECONDS}s</span>
      </div>

      <div class="marking__actions">
        <button class="btn btn--brass" id="next-btn" type="button">Tick &amp; Grade →</button>
      </div>

      <div class="marking__feedback" id="feedback" aria-live="polite"></div>
    </main>
  `;

  const answerEl = ctx.root.querySelector<HTMLElement>("#answer")!;
  const fillEl = ctx.root.querySelector<HTMLElement>("#timer-fill")!;
  const secondsEl = ctx.root.querySelector<HTMLElement>("#seconds")!;
  const nextBtn = ctx.root.querySelector<HTMLButtonElement>("#next-btn")!;
  const feedbackEl = ctx.root.querySelector<HTMLElement>("#feedback")!;

  // ---- Render tokens ----
  renderTokens(answerEl, question.tokens, onTokenClick);

  // ---- Timer ----
  const startedAt = Date.now();
  tickHandle = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    remainingMs = Math.max(0, QUESTION_SECONDS * 1000 - elapsed);
    const pct = (remainingMs / (QUESTION_SECONDS * 1000)) * 100;
    fillEl.style.width = `${pct}%`;
    const secs = Math.ceil(remainingMs / 1000);
    secondsEl.textContent = `${secs}s`;
    if (remainingMs <= 0) {
      lockAndGrade();
    }
  }, 100);

  nextBtn.addEventListener("click", () => lockAndGrade());

  // ---- Token click handler ----
  function onTokenClick(tokenEl: HTMLElement, token: Token): void {
    if (locked) return;
    closePopover?.();

    const interaction = resolveClick(question, token.index);

    switch (interaction.type) {
      case "spelling-dropdown":
        openSpellingDropdown(tokenEl, interaction);
        break;
      case "punctuation-insert":
        handlePunctuation(tokenEl, interaction.error);
        break;
      case "word-correct":
        openWordDropdown(tokenEl, interaction.error);
        break;
      case "miss":
        registerMiss(tokenEl);
        break;
    }
  }

  // ---- Spelling: dropdown popover of options ----
  function openSpellingDropdown(
    tokenEl: HTMLElement,
    interaction: Extract<ClickInteraction, { type: "spelling-dropdown" }>,
  ): void {
    if (resolvedErrorIds.has(interaction.error.id)) return;
    const options = shuffle([...interaction.options]);
    const pop = buildPopover();
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "popover__opt";
      btn.textContent = opt;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const correct = checkFix(interaction.error, opt);
        applyFix(tokenEl, interaction.error, correct, opt);
        closePopover?.();
      });
      pop.appendChild(btn);
    }
    showPopover(tokenEl, pop);
  }

  // ---- Word errors (prepositions/tenses/structure): pick the fix ----
  function openWordDropdown(tokenEl: HTMLElement, error: GrammarError): void {
    if (resolvedErrorIds.has(error.id)) return;
    // Build plausible choices around the correct fix from the original word.
    const original = tokenEl.dataset.text ?? "";
    const choices = shuffle(
      Array.from(new Set([error.fix, original, ...wordDistractors(error)])),
    ).slice(0, 4);
    if (!choices.includes(error.fix)) choices[0] = error.fix;

    const pop = buildPopover();
    for (const opt of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "popover__opt";
      btn.textContent = opt;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const correct = checkFix(error, opt);
        applyFix(tokenEl, error, correct, opt);
        closePopover?.();
      });
      pop.appendChild(btn);
    }
    showPopover(tokenEl, pop);
  }

  // ---- Punctuation: a click drops the missing mark straight in ----
  function handlePunctuation(tokenEl: HTMLElement, error: GrammarError): void {
    if (resolvedErrorIds.has(error.id)) return;
    // Inserting the mark IS the fix for a punctuation gap.
    tokenEl.textContent = error.fix;
    applyFix(tokenEl, error, true, error.fix);
  }

  // ---- A harmless, non-shaming miss ----
  function registerMiss(tokenEl: HTMLElement): void {
    record({
      questionId: question.id,
      category: null,
      outcome: "miss",
      timestamp: Date.now(),
    });
    // Gentle "nothing wrong here" nudge — no scary red.
    tokenEl.classList.remove("token--miss");
    // Force reflow so the animation can retrigger on rapid clicks.
    void tokenEl.offsetWidth;
    tokenEl.classList.add("token--miss");
    flashFeedback("Nothing wrong there — trust your instincts and keep scanning.");
  }

  // ---- Apply a resolved fix, mark the token, record the action ----
  function applyFix(
    tokenEl: HTMLElement,
    error: GrammarError,
    correct: boolean,
    _submitted: string,
  ): void {
    resolvedErrorIds.add(error.id);
    tokenEl.classList.remove("token--correct", "token--wrong");
    tokenEl.classList.add(correct ? "token--correct" : "token--wrong");
    tokenEl.classList.add("token--resolved");
    // Once resolved, the spot is no longer clickable.
    tokenEl.setAttribute("aria-disabled", "true");

    record({
      questionId: question.id,
      category: error.category,
      outcome: correct ? "correct" : "incorrect",
      timestamp: Date.now(),
      errorId: error.id,
    });

    if (correct) {
      flashFeedback(`Good catch! ${error.explanation}`);
    } else {
      // Non-shaming: show it's noted, reveal the intended fix gently.
      flashFeedback(`Noted. The mark scheme expected "${error.fix}". ${error.explanation}`);
    }
  }

  // ---- Record through the pure session state ----
  function record(action: RecordedAction): void {
    ctx.session = applyAction(ctx.session, action);
  }

  // ---- Popover plumbing ----
  function buildPopover(): HTMLElement {
    const pop = document.createElement("div");
    pop.className = "popover";
    return pop;
  }

  function showPopover(anchor: HTMLElement, pop: HTMLElement): void {
    // Position relative to the token via a wrapper.
    anchor.classList.add("token--active");
    anchor.appendChild(pop);

    const onDocClick = (e: MouseEvent): void => {
      if (!pop.contains(e.target as Node) && e.target !== anchor) {
        closePopover?.();
      }
    };
    // Defer so the opening click doesn't immediately close it.
    window.setTimeout(() => document.addEventListener("click", onDocClick), 0);

    closePopover = () => {
      document.removeEventListener("click", onDocClick);
      anchor.classList.remove("token--active");
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      closePopover = undefined;
    };
  }

  // ---- Transient feedback line ----
  let feedbackTimer: number | undefined;
  function flashFeedback(msg: string): void {
    feedbackEl.textContent = msg;
    feedbackEl.classList.add("marking__feedback--show");
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      feedbackEl.classList.remove("marking__feedback--show");
    }, 3500);
  }

  // ---- Lock the question, grade it, show the stamp, then advance ----
  function lockAndGrade(): void {
    if (locked) return;
    locked = true;
    closePopover?.();
    stopTimer();

    const elapsed = Date.now() - questionStart;
    const grade = gradeForQuestion(
      // gradeForQuestion reads recorded actions already in the session.
      ctx.session,
      question.id,
    );

    // Advance the pure session (records elapsed, moves the index).
    ctx.session = gradeAndAdvance(ctx.session, elapsed);

    showGradeOverlay(grade.grade, grade.label, question);
  }

  function stopTimer(): void {
    if (tickHandle !== undefined) {
      window.clearInterval(tickHandle);
      tickHandle = undefined;
    }
  }

  // ---- Grade stamp + per-question feedback, then continue ----
  function showGradeOverlay(
    grade: string,
    label: string,
    q: Question,
  ): void {
    // Which categories appeared in this paper (for the feedback line).
    const cats = Array.from(new Set(q.errors.map((e) => e.category)));
    const catText = cats.map((c) => CATEGORY_LABELS[c]).join(", ");

    // How the player did on this paper (encouraging phrasing).
    const acts = ctx.session.actions.filter(
      (a) => a.questionId === q.id && a.outcome !== "miss",
    );
    const got = acts.filter((a) => a.outcome === "correct").length;
    const totalErrors = q.errors.length;

    const overlay = document.createElement("div");
    overlay.className = "grade-overlay";
    overlay.innerHTML = `
      <div class="grade-overlay__card">
        <span class="grade-stamp grade-overlay__stamp">${escapeHtml(grade)} ${escapeHtml(label)}</span>
        <p class="grade-overlay__caught">You caught <strong>${got}</strong> of <strong>${totalErrors}</strong> errors.</p>
        <p class="grade-overlay__cats">This paper tested: <strong>${escapeHtml(catText)}</strong>.</p>
        <p class="grade-overlay__note">${encouragement(got, totalErrors)}</p>
        <button class="btn btn--brass" id="continue-btn" type="button">Next Paper →</button>
      </div>
    `;
    ctx.root.appendChild(overlay);

    const contBtn = overlay.querySelector<HTMLButtonElement>("#continue-btn")!;
    const goNext = (): void => {
      if (ctx.session.finished) {
        nav.go("reportCard");
      } else {
        // Re-mount the marking screen for the next question.
        nav.go("marking");
      }
    };
    contBtn.addEventListener("click", goNext);
    contBtn.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    };
    document.addEventListener("keydown", onKey);
    disposers.push(() => document.removeEventListener("keydown", onKey));
  }

  // ---- Cleanup: clear all timers/listeners between questions ----
  return () => {
    stopTimer();
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    closePopover?.();
    for (const d of disposers) d();
  };
}

/** Render tokens into the answer element, wiring click + keyboard. */
function renderTokens(
  target: HTMLElement,
  tokens: readonly Token[],
  onClick: (el: HTMLElement, token: Token) => void,
): void {
  target.innerHTML = "";
  for (const token of tokens) {
    const el = document.createElement("span");
    // A punctuation gap must look exactly like ordinary spacing between words —
    // no dashed slot, no marker — so the player has to notice the sentence is
    // missing a mark rather than being handed the location (silent scanning,
    // "no clues"). It stays clickable, it just isn't telegraphed.
    el.className = token.isGap ? "token token--gap" : "token";
    el.dataset.text = token.text;
    // Render the gap as a thin non-breaking space so a click still has a target
    // but nothing visually distinguishes it from the surrounding whitespace.
    el.textContent = token.isGap ? "\u00A0" : token.text;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    // Keep the accessible label neutral: it must not announce "missing
    // punctuation" and give the answer away to screen-reader users either.
    el.setAttribute("aria-label", token.isGap ? "gap" : token.text);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(el, token);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(el, token);
      }
    });
    target.appendChild(el);
    // Preserve spacing between word tokens (gaps blend into the spacing).
    target.appendChild(document.createTextNode(" "));
  }
}

/** Encouraging, non-shaming per-question note. */
function encouragement(got: number, total: number): string {
  if (total === 0) return "Every paper sharpens your eye. On to the next!";
  if (got >= total) return "Flawless marking — that red pen is on fire!";
  if (got > 0) return "Nice work spotting some. The rest are just clues for next time.";
  return "Tricky one! No shame — you'll spot these faster with practice.";
}

/** Simple, cheap distractors for word-type errors (kept plausible). */
function wordDistractors(error: GrammarError): string[] {
  // Generic close alternates so the dropdown always has choices; the correct
  // fix is guaranteed present by the caller.
  const pool: Record<string, string[]> = {
    at: ["to", "in", "on"],
    on: ["in", "at", "to"],
    went: ["go", "gone", "going"],
    played: ["play", "plays", "playing"],
    She: ["Me", "Her", "Him"],
    "have been": ["is", "was", "are"],
  };
  return pool[error.fix] ?? ["is", "was", "the", "a"];
}

/** Fisher-Yates shuffle (new array). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
