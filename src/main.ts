/*
 * Grandmer — app bootstrap.
 *
 * Loads the OFL fonts + theme, then hands control to the screen state machine
 * (Title -> Marking -> ReportCard -> Leaderboard) defined in src/app.ts.
 */

// Self-hosted OFL fonts (bundled by Vite, no external hotlinking).
import "@fontsource/press-start-2p";
import "@fontsource/caveat";

import "./styles/theme.css";
import { startApp } from "./app";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  startApp(app);
}
