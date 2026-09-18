/*
 * Grandmer — Leaderboard screen (FEAT-004).
 *
 * The competitive-but-encouraging finish. The player's final score is inserted
 * into the mocked staff-room leaderboard, their rank computed and highlighted,
 * and positive flavour text shown: a low rank gets the exact encouragement
 * "This is just the beginning", the top spot gets the exact celebration
 * "Must be nice!". Never shaming — students who are behind are cheered on.
 *
 * A brass "Play Again" button returns to the Title, where the app rebuilds a
 * fresh session (combo, actions, timers and score all reset).
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type { RankedEntry } from "../data/leaderboard";
import {
  computePlayerRank,
  getRankFlavor,
  insertPlayerScore,
} from "../data/leaderboard";
import { buildReportCard } from "../game/session";

export function mountLeaderboard(ctx: AppContext, nav: Nav): ScreenCleanup {
  // The score shown here must match the report card exactly.
  const card = buildReportCard(ctx.session, ctx.signature);
  const score = card.totalScore;

  // A friendly display name: the signed name, else a default examiner handle.
  const playerName = (ctx.signature || "").trim() || "You";

  const ranked = insertPlayerScore(score, playerName);
  const player = computePlayerRank(score, playerName);
  const flavor = getRankFlavor(player.rank, ranked.length);

  ctx.root.innerHTML = `
    <main class="desk desk--report">
      <h1 class="title board__title">Staff Room Standings</h1>
      <p class="subtitle">You placed <strong>#${player.rank}</strong> of ${ranked.length}</p>

      <section class="report-card board__card">
        <p class="board__flavor handwriting">${escapeHtml(flavor)}</p>

        <ol class="board__list">
          ${ranked.map(rowFor).join("")}
        </ol>

        <p class="board__note">
          Every run sharpens your eye — scores never go backwards here.
        </p>
      </section>

      <div class="board__actions">
        <button class="btn btn--brass" id="play-again" type="button">Play Again ↺</button>
      </div>

      <p class="byline">Warly Works &middot; for Tuition Masters &middot; prototype</p>
    </main>
  `;

  const again = ctx.root.querySelector<HTMLButtonElement>("#play-again");
  // Navigating to "title" makes app.ts rebuild a fresh session + clear the
  // signature, so combo / actions / timers / score all reset cleanly.
  const restart = (): void => nav.go("title");
  again?.addEventListener("click", restart);
  again?.focus();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      restart();
    }
  };
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("keydown", onKey);
  };
}

/** One ranked row; the player's row is highlighted. */
function rowFor(entry: RankedEntry): string {
  const cls = entry.isPlayer ? "board__row board__row--you" : "board__row";
  const youTag = entry.isPlayer ? ` <span class="board__you-tag">you</span>` : "";
  return `<li class="${cls}">
    <span class="board__rank">#${entry.rank}</span>
    <span class="board__name">${escapeHtml(entry.name)}${youTag}</span>
    <span class="board__score">${entry.score}</span>
  </li>`;
}

/** Escape text before inserting into innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
