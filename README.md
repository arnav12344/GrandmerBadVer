# Grandmer — The Error Hunt

**Grandmer** by **Warly Works** (for **Tuition Masters**) is a youth-friendly,
browser-based English/grammar **"error hunt"** detective game for students aged
roughly 12–16. This repository is an **investor-facing mock / prototype**: a
polished, self-contained slice that plays end to end in the browser with no
backend.

You step into the shoes of a trained examiner racing the clock to grade a stack
of student papers before exam results are due. Grab your red pen, scan each
handwritten answer, and hunt down the mistakes.

## The learning loop

Each session is short (about 1–5 minutes per paper, 20–30 minutes total) and is
designed to be educational, immersive, and **non-shaming** — every mistake is an
opportunity, never a punishment.

1. **Scan** a single student answer. There are no automatic clues; you read
   actively like an examiner marking a real paragraph.
2. **Click** the spot where something looks wrong.
3. **Fix** it:
   - a misspelling opens a **dropdown** of candidate spellings,
   - a missing mark is **inserted** where you click (e.g. a comma or full stop),
   - a wrong word (preposition / tense / structure) is picked from choices.
4. **Beat the timer.** When the clock runs out (or you tick "Grade"), the paper
   is graded, a wax-red stamp lands (e.g. "C- Poor"), and brief feedback names
   the error types involved.
5. The **final paper is an essay "free-for-all"** — open marking, your call.

Across the run the game trains **prepositions, verb tenses, spelling,
punctuation, and sentence structure**.

### End-of-session payoff

- **Report Card** (signed by the student): per-section scores, an overall grade
  stamp, **Strongest** and **Weakest** topic, **Speed** and **Accuracy**, and
  **Best Combo** (longest correct streak) with the bonus it added to the score.
  Plus **Demonstrated Skills**, a **Checklist** of topics to correct, and
  **Retry Learning** — each wrong answer with a short explanation and a resource
  to brush up on the topic.
- **Leaderboard**: your score is inserted into a mocked staff-room board and your
  rank is highlighted with encouraging, competitive-but-never-discouraging
  flavour text (a low rank hears *"This is just the beginning"*, the top spot
  hears *"Must be nice!"*).
- **Play Again** resets the session cleanly and returns to the title.

## Tech stack

- **TypeScript** (vanilla, no UI framework) for a lightweight, trivially
  hostable demo.
- **Vite** for the dev server and the static production build (`dist/`).
- **Vitest** (+ happy-dom) for unit tests of the pure game logic and an
  end-to-end DOM smoke test.
- Pixel-art **teacher's-desk** aesthetic drawn with hand-authored CSS and inline
  SVG. Fonts (Press Start 2P, Caveat) are self-hosted via `@fontsource`.

The code is organised so the pure logic is separate from rendering:

- `src/data/` — mocked content (questions with tagged hidden errors, leaderboard).
- `src/game/` — pure, DOM-free logic (scoring, combo, grading, metrics); unit-tested.
- `src/screens/` — per-screen UI (title, marking, essay, report card, leaderboard).
- `src/styles/` — the pixel-art theme.
- `src/app.ts` — the screen state machine (Title → Marking → Report Card → Leaderboard).

## Getting started

Prerequisites: **Node 22+** and npm.

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (hot reload) and open the printed local URL
npm run dev
```

### Production build & preview

```bash
# Type-check and build the static site into dist/
npm run build

# Serve the built site locally to sanity-check the production bundle
npm run preview
```

The `dist/` output is a fully static site and can be hosted anywhere (no
backend required).

## Running the tests

```bash
npm test
```

This runs the full Vitest suite: pure logic units (scoring, combo, grading,
accuracy/speed, error matching, leaderboard) plus an end-to-end happy-dom smoke
test that drives a full run — Title → marking papers → essay → **Report Card**
→ **Leaderboard** → **Play Again** — and fails if the flow breaks.

## Assets & licensing

All visual art is original, hand-authored CSS/SVG; the two fonts are OFL-1.1.
See [`ASSETS/CREDITS.md`](ASSETS/CREDITS.md) for full source and license
details.
