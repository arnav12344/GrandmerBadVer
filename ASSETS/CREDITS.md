# Asset Credits & Licenses

Grandmer is an investor-facing prototype. Every asset below is free/openly
licensed (CC0 / public domain / SIL Open Font License). No copyrighted or
unlicensed art or fonts are used.

## Visual art / sprites

All decorative pixel art (inkwell, quill, stacked books, report card, desk
woodgrain, grade stamps, timer bar, ink splatter / combo burst, hand-drawn
lasso ink strokes, stress-line vignette, favicon) is **hand-authored original
work** by the Grandmer project, drawn as inline SVG and CSS. See:

- `src/assets/props.ts` — inline pixel-art SVG props (inkwell/quill, stacked
  books, report card, and the ink-splatter / combo-burst flourish)
- `src/styles/theme.css` — CSS-drawn desk surface, cards, stamps, timer bar,
  hand-drawn lasso ink strokes, the intensifying stress-line vignette, the
  urgent-timer pulse, and the ink-splatter burst animation
- `index.html` — inline SVG favicon

There are **no third-party image/sprite assets** in this project.

## Fonts

Fonts are self-hosted (bundled by Vite via the `@fontsource` packages) and are
not hotlinked from any external service.

| Font           | Use                     | Author / Foundry        | License                              | Source                                              |
| -------------- | ----------------------- | ----------------------- | ------------------------------------ | --------------------------------------------------- |
| Press Start 2P | Pixel display / UI font | CodeMan38 (Cody Boisclair) | SIL Open Font License 1.1 (OFL-1.1) | https://fonts.google.com/specimen/Press+Start+2P    |
| Caveat         | Handwritten student answers | Impallari Type (Pablo Impallari) | SIL Open Font License 1.1 (OFL-1.1) | https://fonts.google.com/specimen/Caveat            |

Both fonts are delivered via the `@fontsource/press-start-2p` and
`@fontsource/caveat` npm packages, which redistribute the original Google Fonts
files under their respective OFL-1.1 licenses.

## Summary

- Art: 100% hand-authored (original), no external license required.
- Fonts: 2 third-party fonts, both OFL-1.1 (permissive, redistributable).
