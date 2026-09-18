/*
 * @vitest-environment happy-dom
 *
 * End-to-end gameplay smoke test (FEAT-004 lasso rework).
 *
 * Drives the real screen state machine through a full run in a DOM
 * environment: Title -> Begin -> Marking (circle suspected errors with the
 * lasso) -> flip through the paper stack with Prev/Next (deferred grading, no
 * per-paper grade overlay) -> essay free-for-all -> Finish & Grade -> the
 * signed Report Card (hits / misses / false alarms + preserved metrics) -> the
 * Leaderboard with rank + flavour -> Play Again -> back to Title with a fresh
 * session. It also covers revisable circles, circle persistence across flips,
 * and per-paper timer expiry ending the run.
 *
 * Grading is NEVER revealed during marking; the report card is the only place
 * correctness surfaces. Real drag geometry and SVG layout are untestable in
 * happy-dom (getBoundingClientRect returns zero-size boxes), so circling is
 * driven here via the Enter/Space keyboard toggle fallback the marking and
 * essay screens expose. The pure lasso hit-test has its own unit tests.
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

/**
 * Toggle a token's circle via the keyboard fallback (Enter). Real drag
 * geometry cannot be simulated in happy-dom, so the lasso screens expose an
 * Enter/Space toggle on the focused token; this drives that path.
 */
function toggle(node: Element | null): void {
  node?.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
}

describe("Grandmer gameplay (FEAT-004) end-to-end", () => {
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

  it("plays a full run: Title -> lasso marking -> Report Card -> Leaderboard -> Play Again", () => {
    const app = el("#app")!;
    startApp(app);

    // Title -> Marking
    click(el("#start-btn"));
    expect(el(".marking__paper")).not.toBeNull();
    expect(el(".timer-bar__fill")).not.toBeNull();
    // The lasso capture layer is present (real drag geometry is untestable in
    // happy-dom, so marking is driven via the keyboard toggle fallback below).
    expect(el(".lasso-layer")).not.toBeNull();
    // No dropdown / popover / instant-check UI survives from the old model.
    expect(el(".popover")).toBeNull();

    // Walk through every paper by FLIPPING with Next (deferred grading: no
    // per-paper grade overlay). On each standard paper circle the first token
    // via the keyboard fallback, asserting NO grade/outcome is revealed during
    // marking. The essay finishes the run; otherwise Finish & Grade does.
    let circledAtLeastOnce = false;
    for (let guard = 0; guard < 20; guard++) {
      if (el(".report__card")) break;

      const essayAnswer = el("#essay-answer");
      if (essayAnswer) {
        // Essay free-for-all: circle a couple of words via keyboard, finish.
        const words = document.querySelectorAll(".essay__word");
        expect(words.length).toBeGreaterThan(0);
        toggle(words[0]);
        toggle(words[1]);
        expect(el("#mark-count")?.textContent).toContain("mark");
        click(el("#finish-btn"));
        continue;
      }

      // Standard paper: circle the first token (keyboard toggle draws ink).
      const firstToken = document.querySelector(".token:not(.token--gap)");
      toggle(firstToken);
      circledAtLeastOnce = true;
      expect(el(".ink-circle")).not.toBeNull();
      // Grading must NOT be revealed while marking: no overlay, and the token
      // never gets a correct/wrong class.
      expect(el(".grade-overlay")).toBeNull();
      expect(firstToken!.classList.contains("token--correct")).toBe(false);
      expect(firstToken!.classList.contains("token--wrong")).toBe(false);

      // Flip to the next paper without grading. On the final standard paper
      // this hands off into the essay via the router.
      click(el("#next-btn"));
    }
    expect(circledAtLeastOnce).toBe(true);

    // ---- Report Card: all the required sections must be present ----
    const report = el(".report__card");
    expect(report).not.toBeNull();
    expect(el(".report__grade")).not.toBeNull(); // overall grade stamp
    expect(el(".report__table")).not.toBeNull(); // per-section scores
    // Headline metrics: strongest/weakest topic, accuracy, speed, best combo.
    expect(document.querySelectorAll(".report__metric").length).toBeGreaterThanOrEqual(5);
    expect(el(".report__metric--combo")?.textContent).toContain("bonus");

    // ---- Circle Accuracy breakdown: hits / misses / false alarms ----
    expect(el(".report__circle-stat--hits")).not.toBeNull();
    expect(el(".report__circle-stat--misses")).not.toBeNull();
    expect(el(".report__circle-stat--false")).not.toBeNull();
    // Each stat shows a numeric count.
    for (const sel of [
      ".report__circle-stat--hits",
      ".report__circle-stat--misses",
      ".report__circle-stat--false",
    ]) {
      const value = el(`${sel} .report__circle-value`)?.textContent ?? "";
      expect(value).toMatch(/^\d+$/);
    }
    // hits + misses must equal the total real errors across marked papers, so
    // at least one real error exists to have been caught or missed.
    const hits = Number(
      el(".report__circle-stat--hits .report__circle-value")?.textContent ?? "0",
    );
    const misses = Number(
      el(".report__circle-stat--misses .report__circle-value")?.textContent ?? "0",
    );
    expect(hits + misses).toBeGreaterThan(0);

    // Demonstrated skills + checklist + retry-learning blocks all rendered.
    const headings = Array.from(document.querySelectorAll(".report__h2")).map(
      (h) => h.textContent ?? "",
    );
    expect(headings.some((h) => /Circle Accuracy/i.test(h))).toBe(true);
    expect(headings.some((h) => /Demonstrated Skills/i.test(h))).toBe(true);
    expect(headings.some((h) => /Checklist/i.test(h))).toBe(true);
    expect(headings.some((h) => /Retry Learning/i.test(h))).toBe(true);

    // Signature element present, editable, and empty until the student signs -
    // it must reflect a real action, not be auto-filled.
    const sig = el<HTMLInputElement>("#signature");
    expect(sig).not.toBeNull();
    expect(sig!.value).toBe("");
    // Sign the card the way a real student would, then confirm it took.
    sig!.value = "Sam Rivera";
    sig!.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(sig!.value).toBe("Sam Rivera");

    // ---- Report Card -> Leaderboard ----
    click(el("#to-leaderboard"));
    expect(el(".board__list")).not.toBeNull();
    // The player's row is highlighted and a flavour line is shown.
    expect(el(".board__row--you")).not.toBeNull();
    const flavor = el(".board__flavor")?.textContent ?? "";
    expect(flavor.length).toBeGreaterThan(0);
    // The signed name carries through to the player's row.
    expect(el(".board__row--you")?.textContent).toContain("Sam Rivera");

    // ---- Leaderboard -> Play Again -> back to Title (fresh session) ----
    click(el("#play-again"));
    expect(el(".title")?.textContent).toContain("GRANDMER");
    const restart = el<HTMLButtonElement>("#start-btn");
    expect(restart).not.toBeNull();
    expect(restart!.disabled).toBe(false);

    // Fresh session: starting again lands on paper 1 with no circles drawn.
    click(el("#start-btn"));
    expect(el(".marking__count")?.textContent).toContain("Paper 1");
    expect(el(".ink-circle")).toBeNull();
  });

  it("shows encouraging flavour and a full board when the score is low", () => {
    // A run where the player never circles anything lands near the bottom and
    // must still be encouraged (never shamed): the leaderboard renders a
    // flavour line and highlights the player row, and the report card still
    // shows the hits/misses/false-alarms breakdown.
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
      // Do nothing on standard papers - just flip past them (0 circles).
      click(el("#next-btn"));
    }

    expect(el(".report__card")).not.toBeNull();
    // No circles at all -> zero hits, zero false alarms, but real errors were
    // missed, so misses must be positive (the breakdown is meaningful).
    expect(
      el(".report__circle-stat--hits .report__circle-value")?.textContent,
    ).toBe("0");
    expect(
      el(".report__circle-stat--false .report__circle-value")?.textContent,
    ).toBe("0");
    expect(
      Number(
        el(".report__circle-stat--misses .report__circle-value")?.textContent ??
          "0",
      ),
    ).toBeGreaterThan(0);

    click(el("#to-leaderboard"));
    expect(el(".board__row--you")).not.toBeNull();
    expect((el(".board__flavor")?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("circles a token with revisable ink and no instant right/wrong feedback", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));

    const token = document.querySelector(".token:not(.token--gap)");
    expect(token).not.toBeNull();

    // Circle it: persistent red ink appears and the token is marked (but never
    // shown as correct/wrong - grading is deferred to the report card).
    toggle(token);
    expect(el(".ink-circle")).not.toBeNull();
    expect(token!.classList.contains("token--circled")).toBe(true);
    expect(token!.classList.contains("token--correct")).toBe(false);
    expect(token!.classList.contains("token--wrong")).toBe(false);
    expect(el(".grade-overlay")).toBeNull();

    // Re-circling the same token removes it (revisable), clearing its ink.
    toggle(token);
    expect(token!.classList.contains("token--circled")).toBe(false);
    expect(el(".ink-circle")).toBeNull();
  });

  it("flips between papers with Prev/Next and persists circles across flips", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));
    expect(el(".marking__count")?.textContent).toContain("Paper 1");

    // Circle the first token on paper 1.
    const firstToken = document.querySelector(".token:not(.token--gap)");
    toggle(firstToken);
    expect(el(".ink-circle")).not.toBeNull();

    // Flip forward (no grading happens on a flip), then back: the circle must
    // still be there and remain revisable.
    click(el("#next-btn"));
    expect(el(".report__card")).toBeNull();
    expect(el(".marking__count")?.textContent).toContain("Paper 2");

    click(el("#prev-btn"));
    expect(el(".marking__count")?.textContent).toContain("Paper 1");
    const backToken = document.querySelector(".token:not(.token--gap)");
    expect(backToken!.classList.contains("token--circled")).toBe(true);
    expect(el(".ink-circle")).not.toBeNull();

    // Still revisable after flipping back: toggling again removes the circle.
    toggle(backToken);
    expect(backToken!.classList.contains("token--circled")).toBe(false);
    expect(el(".ink-circle")).toBeNull();
  });

  it("handles a per-paper timer expiry by finishing the run to the report card", () => {
    const app = el("#app")!;
    startApp(app);
    click(el("#start-btn"));
    expect(el(".marking__paper")).not.toBeNull();

    // Advance fake time past the 30s per-paper timer.
    vi.advanceTimersByTime(31_000);

    // Timer expiry ends the stack and reveals grading on the report card;
    // grading is never shown during marking.
    expect(el(".report__card")).not.toBeNull();
    expect(el(".grade-overlay")).toBeNull();
    // The deferred breakdown still renders after a timed-out run.
    expect(el(".report__circle-stat--hits")).not.toBeNull();
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
