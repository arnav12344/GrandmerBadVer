/*
 * Grandmer - Title / intro screen (FEAT-004).
 *
 * Intro to the 3D voxel marking game: you are a trained examiner seated at a
 * 3D examiner's desk (a real sourced HDRI study room behind a cartoony
 * toon-shaded voxel teacher) racing to grade a stack of student papers before
 * exam results are due. A Start button (usable by mouse AND keyboard) begins
 * the marking run, plus a brief "how to play" that mirrors the real loop: scan
 * silently, draw a freehand loop with the 3D pen that follows your cursor,
 * flip through the paper stack, then finish and grade. The intro chrome and
 * the in-game HUD stay PIXEL-ART; only the desk scene is rendered in 3D.
 * Reuses the theme classes.
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
          mistakes, waits on your 3D desk. Grab your pen, examiner - the exam
          results are due.
        </p>

        <h2 class="how-to__title">How to Play</h2>
        <ol class="how-to">
          <li><strong>Scan</strong> the student's answer laid out on the 3D paper - no clues, just your trained eye.</li>
          <li><strong>Circle</strong> anything that looks wrong: move your cursor and the 3D pen follows, laying down a freehand ink loop around the word.</li>
          <li><strong>Flip</strong> through the pages of the paper stack to review and revise your circles.</li>
          <li><strong>Beat the timer</strong> and Finish &amp; Grade - only then is your marking revealed as hits, misses and false alarms.</li>
        </ol>
        <p class="how-to__note">
          No instant right or wrong while you mark. Trust your eye, ride the
          marking streak, and grade the whole stack before the clock runs down.
          The desk is 3D and the vibe is playful; the scoreboards stay pixel.
          Good luck, examiner.
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
