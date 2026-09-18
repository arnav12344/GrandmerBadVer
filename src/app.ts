/*
 * Grandmer — app shell & screen state machine (FEAT-003).
 *
 * A tiny, framework-free router. Screens are functions that mount into #app
 * and are handed a `nav` object to request transitions. The app owns the live
 * game session and carries it (plus any signature the player enters) between
 * screens so the Report Card / Leaderboard can be built from real play data.
 *
 * Flow: Title -> Marking (loops over questions) -> ReportCard -> Leaderboard.
 */

import { createSession, type GameState } from "./game/session";
import { QUESTIONS } from "./data/questions";
import { mountTitle } from "./screens/title";
import { mountMarking } from "./screens/marking";
import { mountReportCard } from "./screens/reportCard";
import { mountLeaderboard } from "./screens/leaderboard";

/** The screens the app can show. */
export type ScreenName = "title" | "marking" | "reportCard" | "leaderboard";

/**
 * Shared, mutable app context threaded through every screen. Screens read the
 * session, mutate it via the pure helpers, and hand it back on transition.
 */
export interface AppContext {
  root: HTMLElement;
  /** The live game session (rebuilt when a new run starts). */
  session: GameState;
  /** Player-entered signature for the report card (filled on the report screen). */
  signature: string;
}

/** Navigation surface handed to each screen. */
export interface Nav {
  go(screen: ScreenName): void;
}

/**
 * A screen mounts its DOM into the root and returns an optional cleanup
 * function (used to clear timers/intervals before the next screen mounts).
 */
export type ScreenCleanup = (() => void) | void;
export type Screen = (ctx: AppContext, nav: Nav) => ScreenCleanup;

export function startApp(root: HTMLElement): void {
  const ctx: AppContext = {
    root,
    session: createSession(QUESTIONS),
    signature: "",
  };

  let cleanup: ScreenCleanup;

  const nav: Nav = {
    go(screen: ScreenName) {
      // Always tear down the previous screen's timers before swapping.
      if (typeof cleanup === "function") {
        cleanup();
      }
      cleanup = undefined;
      root.innerHTML = "";
      mount(screen);
    },
  };

  function mount(screen: ScreenName): void {
    switch (screen) {
      case "title":
        // A fresh run starts a fresh session.
        ctx.session = createSession(QUESTIONS);
        ctx.signature = "";
        cleanup = mountTitle(ctx, nav);
        break;
      case "marking":
        cleanup = mountMarking(ctx, nav);
        break;
      case "reportCard":
        cleanup = mountReportCard(ctx, nav);
        break;
      case "leaderboard":
        cleanup = mountLeaderboard(ctx, nav);
        break;
    }
  }

  mount("title");
}
