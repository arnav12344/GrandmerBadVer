# Grandmer: The Error Hunt

**Grandmer** by **Warly Works** (for **Tuition Masters**) is a youth-friendly,
browser-based English/grammar **"error hunt"** detective game for students aged
roughly 12–16. This repository is an **investor-facing mock / prototype**: a
polished, self-contained slice that plays end to end in the browser with no
backend.

You step into the shoes of a trained examiner racing the clock to grade a stack
of student papers before exam results are due. Grab your red pen, scan each
handwritten answer, and circle the mistakes you spot.

## The learning loop

Each session is short (about 1–5 minutes per paper, 20–30 minutes total) and is
designed to be educational, immersive, and **non-shaming**. Every mistake is an
opportunity, never a punishment.

The marking is **circle-only with deferred grading**: you do not get told
whether a circle was right while you work. You back your own eye, and the truth
is revealed only at the end.

1. **Scan** a single student answer. There are no automatic clues; you read
   actively like an examiner marking a real paragraph.
2. **Circle** anything that looks wrong by drawing a freehand red-pen **lasso**
   around the word or spot (pointer, touch, or a keyboard fallback). Draw a loop
   around the same word again to rub the circle out. There is no instant right
   or wrong.
3. **Flip** back and forth through the pages of the paper stack with Prev / Next
   to review and revise your circles as often as you like before you commit.
4. **Beat the timer.** A prominent per-paper timer adds speed pressure, escalating
   in urgency as it drains. Finish & Grade (or let the timer run out) to end the
   whole stack.
5. The **final paper is an essay "free-for-all"**: open, ungraded marking with a
   generous timer, your call.
6. **Grading is revealed only at the end** on the Report Card as **hits**,
   **misses**, and **false alarms**.

Across the run the game trains **prepositions, verb tenses, spelling,
punctuation, and sentence structure**.

### Game feel

Grandmer is built to read as a fast, tense marking game rather than a worksheet:

- a **marking-streak** meter that climbs as you circle in quick succession (an
  honest tempo meter, not a correctness spoiler, since grading is deferred),
- **speed pressure** from the escalating per-paper timer, where faster correct
  catches are worth more in the final score,
- **stress lines** that close in around the desk and intensify as time runs low,
  plus a brief screen shake and ink-splatter flourishes on key moments.

All of the tension is atmospheric. Nothing flashes "wrong" at you while you mark,
and reduced-motion preferences soften or disable the heavier effects.

### End-of-session payoff

- **Report Card** (signed by the student): per-section scores, an overall grade
  stamp, a **Circle Accuracy** breakdown of **hits** (real errors caught),
  **misses** (real errors left uncircled) and **false alarms** (circled a spot
  that was actually fine), plus **Strongest** and **Weakest** topic, **Speed**
  and **Accuracy**, and **Best Combo** (longest run of consecutive correct
  catches) with the bonus it added to the score. Plus **Demonstrated Skills**, a
  **Checklist** of topics to correct, and **Retry Learning**: each missed or
  false-alarmed error with a short explanation and a resource to brush up on the
  topic. The signature line starts empty and accepts the student's typed name.
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
  SVG, including the hand-drawn lasso ink strokes, the stress-line vignette, and
  the ink-splatter flourishes. Fonts (Press Start 2P, Caveat) are self-hosted via
  `@fontsource`.

The code is organised so the pure logic is separate from rendering:

- `src/data/`: mocked content (questions with tagged hidden errors, leaderboard).
- `src/game/`: pure, DOM-free logic (scoring, combo, grading, metrics, and the
  lasso hit-test in `lasso.ts`); unit-tested.
- `src/screens/`: per-screen UI (title, marking, essay, report card, leaderboard).
- `src/styles/`: the pixel-art theme.
- `src/app.ts`: the screen state machine (Title -> Marking -> Report Card -> Leaderboard).

The lasso hit-testing is kept pure and DOM-free (`resolveLasso` takes a loop of
points plus measured word boxes and returns which words the loop encloses), so
it is fully unit-testable with injected geometry rather than relying on live SVG
layout.

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
accuracy/speed, the lasso hit-test, leaderboard) plus an end-to-end happy-dom
smoke test that drives a full run (Title -> circle papers with the lasso -> flip
between pages (circles persist) -> essay -> **Report Card** with hits / misses /
false alarms and a signature -> **Leaderboard** -> **Play Again**) and fails if
the flow breaks. Because happy-dom cannot simulate real pointer-drag geometry or
SVG layout, the smoke test drives circling through the keyboard toggle fallback;
the pure lasso geometry has its own unit tests.

## Assets & licensing

All visual art is original, hand-authored CSS/SVG; the two fonts are OFL-1.1.
See [`ASSETS/CREDITS.md`](ASSETS/CREDITS.md) for full source and license
details.
