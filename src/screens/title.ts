/*
 * Grandmer — Title / intro screen (FEAT-003).
 *
 * Immersive pixel-art teacher's-desk intro: you are a trained examiner racing
 * to grade a stack of student papers before exam results are due. A Start
 * button (usable by mouse AND keyboard) begins the marking run, plus a brief
 * "how to play" that mirrors the real loop: scan silently, click a spot, fix
 * it, beat the timer. Reuses the FEAT-001 theme classes.
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import {
  inkwellQuillSvg,
  stackedBooksSvg,
  reportCardSvg,
} from "../assets/props";

export function mountTitle(ctx: AppContext, nav: Nav): ScreenCleanup {
  ctx.root.innerHTML = `
    <main class="desk">
      <div class="desk-clutter" aria-hidden="true">
        ${stackedBooksSvg}
        ${inkwellQuillSvg}
        ${reportCardSvg}
      </div>

      <h1 class="title">GRANDMER</h1>
      <p class="subtitle">The Error Hunt</p>

      <section class="paper-card">
        <p class="handwriting" style="margin-top:0;">
          Deadline approaching. A stack of student papers, riddled with
          mistakes, waits on your desk. Grab your red pen, examiner — the exam
          results are due.
        </p>

        <h2 class="how-to__title">How to Play</h2>
        <ol class="how-to">
          <li><strong>Scan</strong> the student's answer — no clues, just your trained eye.</li>
          <li><strong>Click</strong> the spot where something looks wrong.</li>
          <li><strong>Fix</strong> it: pick the right spelling, or drop in the missing mark.</li>
          <li><strong>Beat the timer</strong> — grade the paper before the clock runs out.</li>
        </ol>
        <p class="how-to__note">
          No shame in a miss — every mistake is just another clue. Good luck,
          examiner.
        </p>
      </section>

      <button class="btn btn--brass" id="start-btn" type="button">
        Begin Marking
      </button>

      <p class="byline">Warly Works &middot; for Tuition Masters &middot; prototype</p>
    </main>
  `;

  const startBtn = ctx.root.querySelector<HTMLButtonElement>("#start-btn");

  const begin = (): void => nav.go("marking");

  startBtn?.addEventListener("click", begin);
  // Keyboard: a native <button> already fires click on Enter/Space, but we
  // also let a global Enter start the game so the demo runs hands-free.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      begin();
    }
  };
  document.addEventListener("keydown", onKey);

  // Focus the Start button so keyboard users can act immediately.
  startBtn?.focus();

  return () => {
    document.removeEventListener("keydown", onKey);
  };
}
