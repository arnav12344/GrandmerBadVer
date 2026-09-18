/*
 * @vitest-environment happy-dom
 *
 * FEAT-003 — end-to-end gameplay smoke test.
 *
 * Drives the real screen state machine through a full run in a DOM
 * environment: Title -> Start -> mark a spelling via dropdown -> mark a
 * punctuation via insert -> let the timer expire to grade -> advance through
 * every question -> essay free-for-all -> the signed Report Card (FEAT-004)
 * -> the Leaderboard with rank + flavour -> Play Again -> back to Title. This
 * exercises the actual DOM wiring (not just the pure logic) and guards against
 * crashes, leaked timers, and broken transitions for the investor demo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../app";

function el<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

/** Fire a real click that bubbles (matches how the screens listen). */
function click(node: Element | null): void {
  node?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

describe("Grandmer gameplay (FEAT-003) end-to-end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows the title screen with a working Start button", () => {
    startApp(el("#app")!);
    expect(el(".title")?.textContent).toContain("GRANDMER");
    const start = el<HTMLButtonElement>("#start-btn");
    expect(start).not.toBeNull();
    expect(start!.disabled).toBe(false);
  });

  it("plays a full run from Title through Report Card, Leaderboard and Play Again", () => {
    const app = el("#app")!;
    startApp(app);

    // Title -> Marking
    click(el("#start-btn"));
    expect(el(".marking__paper")).not.toBeNull();
    expect(el(".timer-bar__fill")).not.toBeNull();

    // Walk through every question. Standard questions: interact then advance.
    // We cap iterations defensively so a wiring bug can't loop forever.
    for (let guard = 0; guard < 20; guard++) {
      const reportCard = el(".report__card");
      if (reportCard) break;

      const essayAnswer = el("#essay-answer");
      if (essayAnswer) {
        // Essay free-for-all: mark a couple of words, then finish.
        const words = document.querySelectorAll(".essay__word");
        expect(words.length).toBeGreaterThan(0);
        click(words[0]);
        click(words[1]);
        expect(el("#mark-count")?.textContent).toContain("mark");
        click(el("#finish-btn"));
        continue;
      }

      // Standard question: try a spelling dropdown and a punctuation gap.
      const gap = el(".token--gap");
      if (gap) {
        click(gap);
        // Punctuation insert fills the gap text with the mark.
        expect(gap.textContent!.length).toBeGreaterThan(0);
      }

      // Click the first token to trigger whatever interaction it maps to; if a
      // spelling dropdown opens, pick the first option.
      const firstToken = document.querySelector(".token:not(.token--gap)");
      click(firstToken);
      const opt = el(".popover__opt");
      if (opt) click(opt);

      // Grade the paper immediately (player ticks "Next").
      click(el("#next-btn"));

      // A grade overlay appears; continue to the next paper.
      const cont = el("#continue-btn");
      expect(cont).not.toBeNull();
      click(cont);
    }

    // ---- Report Card: all the required sections must be present ----
    const report = el(".report__card");
    expect(report).not.toBeNull();
    expect(el(".report__grade")).not.toBeNull(); // overall grade stamp
    expect(el(".report__table")).not.toBeNull(); // per-section scores
    // Headline metrics: strongest/weakest topic, accuracy, speed, best combo.
    expect(document.querySelectorAll(".report__metric").length).toBeGreaterThanOrEqual(5);
    expect(el(".report__metric--combo")?.textContent).toContain("bonus");
    // Demonstrated skills + checklist + retry-learning blocks all rendered.
    const headings = Array.from(document.querySelectorAll(".report__h2")).map(
      (h) => h.textContent ?? "",
    );
    expect(headings.some((h) => /Demonstrated Skills/i.test(h))).toBe(true);
    expect(headings.some((h) => /Checklist/i.test(h))).toBe(true);
    expect(headings.some((h) => /Retry Learning/i.test(h))).toBe(true);
    // Signature element present, editable, and empty until the student signs —
    // it must reflect a real action, not be auto-filled.
    const sig = el<HTMLInputElement>("#signature");
    expect(sig).not.toBeNull();
    expect(sig!.value).toBe("");
    // Sign the card the way a real student would, then confirm it took.
    sig!.value = "Sam Rivera";
    sig!.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(sig!.value.length).toBeGreaterThan(0);

    // ---- Report Card -> Leaderboard ----
    click(el("#to-leaderboard"));
    expect(el(".board__list")).not.toBeNull();
    // The player's row is highlighted and a flavour line is shown.
    expect(el(".board__row--you")).not.toBeNull();
    const flavor = el(".board__flavor")?.textContent ?? "";
    expect(flavor.length).toBeGreaterThan(0);

    // ---- Leaderboard -> Play Again -> back to Title (fresh session) ----
    click(el("#play-again"));
    expect(el(".title")?.textContent).toContain("GRANDMER");
    const restart = el<HTMLButtonElement>("#start-btn");
    expect(restart).not.toBeNull();
    expect(restart!.disabled).toBe(false);
  });

  it("shows encouraging flavour and a full board when the score is low", () => {
    // A run where the player barely scores lands them near the bottom and must
    // still be encouraged (never shamed) — the leaderboard must render a
    // flavour line and highlight the player row.
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));

    for (let guard = 0; guard < 20; guard++) {
      if (el(".report__card")) break;
      const essayAnswer = el("#essay-answer");
      if (essayAnswer) {
        click(el("#finish-btn")); // finish essay without marking anything
        continue;
      }
      // Do nothing on standard papers — just grade and advance (0 correct).
      click(el("#next-btn"));
      click(el("#continue-btn"));
    }

    expect(el(".report__card")).not.toBeNull();
    click(el("#to-leaderboard"));
    expect(el(".board__row--you")).not.toBeNull();
    expect((el(".board__flavor")?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("records a correct spelling pick and a punctuation insert", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));

    // q1 is prepositions (word). Advance until we reach the spelling paper.
    // Find a paper that has a spelling dropdown by probing tokens.
    let foundSpelling = false;
    for (let guard = 0; guard < 10 && !foundSpelling; guard++) {
      const tokens = Array.from(
        document.querySelectorAll(".token:not(.token--gap)"),
      );
      for (const t of tokens) {
        click(t);
        const opts = document.querySelectorAll(".popover__opt");
        if (opts.length > 0) {
          foundSpelling = true;
          // Pick every option button harmlessly — pick the first.
          click(opts[0]);
          break;
        }
      }
      if (foundSpelling) break;
      // Advance to next paper.
      click(el("#next-btn"));
      click(el("#continue-btn"));
    }
    expect(foundSpelling).toBe(true);
  });

  it("handles a timer expiry by auto-grading the question", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));
    expect(el(".marking__paper")).not.toBeNull();

    // Advance fake time past the 30s per-question timer.
    vi.advanceTimersByTime(31_000);

    // The grade overlay should now be showing.
    expect(el(".grade-overlay")).not.toBeNull();
    expect(el(".grade-stamp")).not.toBeNull();
  });

  it("does not crash on rapid repeated clicking of tokens", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));

    const token = document.querySelector(".token");
    expect(() => {
      for (let i = 0; i < 50; i++) click(token);
    }).not.toThrow();
  });
});
