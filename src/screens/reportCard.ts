/*
 * Grandmer — Report Card screen (FEAT-004).
 *
 * The end-of-run payoff. Built entirely from real play data via
 * buildReportCard(session, signature), rendered as a pixel-art report card on
 * old paper. Surfaces everything the learning philosophy calls for:
 *  - per-section scores + an overall wax-red grade stamp,
 *  - Strongest Topic and Weakest Topic,
 *  - Speed and Accuracy (both clearly surfaced),
 *  - Best Combo (max consecutive correct) and the bonus it added to the score,
 *  - Demonstrated Skills (categories the player did well at),
 *  - a Checklist of items to correct (weak categories),
 *  - Retry Learning: each wrong answer with a short explanation AND a resource
 *    to brush up on the topic,
 *  - a handwritten student Signature line (prefilled, editable) so the card is
 *    "signed by the student".
 *
 * A brass button carries the player on to the Leaderboard.
 */

import type { AppContext, Nav, ScreenCleanup } from "../app";
import type {
  ErrorCategory,
  ReportCard,
  RetryLearningItem,
  SectionScore,
} from "../game/types";
import { buildReportCard } from "../game/session";
import { computeTopicStrengths } from "../game/scoring";

/** Human-friendly labels for each grammar category. */
const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  preposition: "Prepositions",
  tense: "Verb Tenses",
  spelling: "Spelling",
  punctuation: "Punctuation",
  "sentence-structure": "Sentence Structure",
};

/** A category counts as a "demonstrated skill" at or above this accuracy. */
const STRONG_THRESHOLD = 0.6;

export function mountReportCard(ctx: AppContext, nav: Nav): ScreenCleanup {
  // Build the card from live play data. Prefill the signature with any name the
  // player already entered this run (empty on a fresh run).
  const card = buildReportCard(ctx.session, ctx.signature);

  // Demonstrated skills vs. checklist come from per-category performance.
  const strengths = computeTopicStrengths(ctx.session.actions);
  const demonstrated = strengths
    .filter((s) => s.attempts > 0 && s.accuracy >= STRONG_THRESHOLD)
    .sort((a, b) => b.accuracy - a.accuracy);
  const checklist = strengths
    .filter((s) => s.attempts > 0 && s.accuracy < STRONG_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy);

  const accuracyPct = Math.round(card.accuracy * 100);
  const speedSeconds = card.speedMsPerAction / 1000;
  const speedLabel =
    speedSeconds > 0 ? `${speedSeconds.toFixed(1)}s / mark` : "—";

  ctx.root.innerHTML = `
    <main class="desk desk--report">
      <div class="report__stamp-row" aria-hidden="true">
        <span class="grade-stamp report__grade">${escapeHtml(card.overallGrade.grade)} ${escapeHtml(card.overallGrade.label)}</span>
      </div>

      <section class="report-card report__card">
        <header class="report__head">
          <h1 class="report__title">Report Card</h1>
          <p class="report__sub">Grandmer &middot; Examiner's Assessment</p>
          <p class="report__overall">
            Total Score <strong>${card.totalScore}</strong>
            &middot; Overall <strong>${card.overallPercent}%</strong>
            &middot; Grade <strong>${escapeHtml(card.overallGrade.grade)}</strong>
          </p>
        </header>

        <!-- ---- Per-section scores ---- -->
        <section class="report__block">
          <h2 class="report__h2">Scores by Section</h2>
          <table class="report__table">
            <thead>
              <tr><th>Section</th><th>Correct</th><th>Score</th></tr>
            </thead>
            <tbody>
              ${card.sectionScores.map(sectionRow).join("")}
              ${card.sectionScores.length === 0 ? `<tr><td colspan="3">No sections marked.</td></tr>` : ""}
            </tbody>
          </table>
        </section>

        <!-- ---- Headline metrics ---- -->
        <section class="report__block report__metrics">
          <div class="report__metric">
            <span class="report__metric-label">Strongest Topic</span>
            <span class="report__metric-value">${topicLabel(card.strongestTopic)}</span>
          </div>
          <div class="report__metric">
            <span class="report__metric-label">Weakest Topic</span>
            <span class="report__metric-value">${topicLabel(card.weakestTopic)}</span>
          </div>
          <div class="report__metric">
            <span class="report__metric-label">Accuracy</span>
            <span class="report__metric-value">${accuracyPct}%</span>
          </div>
          <div class="report__metric">
            <span class="report__metric-label">Speed</span>
            <span class="report__metric-value">${escapeHtml(speedLabel)}</span>
          </div>
          <div class="report__metric report__metric--combo">
            <span class="report__metric-label">Best Combo</span>
            <span class="report__metric-value">${card.bestCombo} in a row
              <small class="report__combo-bonus">+${card.comboBonus} bonus</small>
            </span>
          </div>
        </section>

        <!-- ---- Demonstrated skills ---- -->
        <section class="report__block">
          <h2 class="report__h2">Demonstrated Skills</h2>
          ${
            demonstrated.length > 0
              ? `<ul class="report__skills">${demonstrated
                  .map(
                    (s) =>
                      `<li class="report__skill">✓ ${CATEGORY_LABELS[s.category]} <small>(${Math.round(s.accuracy * 100)}%)</small></li>`,
                  )
                  .join("")}</ul>`
              : `<p class="report__empty">Keep marking — your strengths will show here next run.</p>`
          }
        </section>

        <!-- ---- Checklist of items to correct ---- -->
        <section class="report__block">
          <h2 class="report__h2">Checklist — Topics to Correct</h2>
          ${
            checklist.length > 0
              ? `<ul class="report__checklist">${checklist
                  .map(
                    (s) =>
                      `<li class="report__check"><span class="report__box">☐</span> Revisit ${CATEGORY_LABELS[s.category]} <small>(${Math.round(s.accuracy * 100)}%)</small></li>`,
                  )
                  .join("")}</ul>`
              : `<p class="report__empty">Nothing flagged — sharp marking, examiner!</p>`
          }
        </section>

        <!-- ---- Retry learning ---- -->
        <section class="report__block">
          <h2 class="report__h2">Retry Learning</h2>
          ${
            card.retryLearning.length > 0
              ? `<ol class="report__retry">${card.retryLearning
                  .map(retryItem)
                  .join("")}</ol>`
              : `<p class="report__empty">No mistakes to review — a flawless run!</p>`
          }
        </section>

        <!-- ---- Student signature ---- -->
        <section class="report__block report__sign">
          <label class="report__sign-label" for="signature">Signed by the student:</label>
          <input
            id="signature"
            class="handwriting report__sign-input"
            type="text"
            value="${escapeHtml(card.studentSignature)}"
            placeholder="Sign your name here…"
            aria-label="student signature"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="report__sign-line" aria-hidden="true"></span>
        </section>
      </section>

      <button class="btn btn--brass" id="to-leaderboard" type="button">
        See the Leaderboard →
      </button>
    </main>
  `;

  // Keep the signature in the shared context so the leaderboard / a rebuild
  // reflect what the student wrote.
  const sigInput = ctx.root.querySelector<HTMLInputElement>("#signature");
  if (sigInput) {
    ctx.signature = sigInput.value;
    sigInput.addEventListener("input", () => {
      ctx.signature = sigInput.value;
    });
  }

  const toBoard = ctx.root.querySelector<HTMLButtonElement>("#to-leaderboard");
  const go = (): void => nav.go("leaderboard");
  toBoard?.addEventListener("click", go);

  const onKey = (e: KeyboardEvent): void => {
    // Enter advances, unless the signature field is focused (let them type).
    if (e.key === "Enter" && document.activeElement !== sigInput) {
      e.preventDefault();
      go();
    }
  };
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("keydown", onKey);
  };
}

/** One row in the per-section score table. */
function sectionRow(s: SectionScore): string {
  return `<tr>
    <td>${escapeHtml(s.section)}</td>
    <td>${s.correct}/${s.attempts}</td>
    <td>${s.percent}%</td>
  </tr>`;
}

/** One retry-learning entry: what was wrong + explanation + resource link. */
function retryItem(item: RetryLearningItem): string {
  return `<li class="report__retry-item">
    <p class="report__retry-cat">${CATEGORY_LABELS[item.category]} &middot; <span class="report__retry-section">${escapeHtml(item.section)}</span></p>
    <p class="report__retry-what">${escapeHtml(item.whatWasWrong)}</p>
    <p class="report__retry-why">${escapeHtml(item.explanation)}</p>
    <p class="report__retry-res">Brush up: <a href="${escapeAttr(item.resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.resource.title)}</a></p>
  </li>`;
}

/** Category label for a metric, or an em-free dash when none. */
function topicLabel(cat: ErrorCategory | null): string {
  return cat ? CATEGORY_LABELS[cat] : "-";
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

/** Escape a URL for use in an href attribute. */
function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export type { ReportCard };
