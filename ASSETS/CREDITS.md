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

There are **no third-party image/sprite assets** in the 2D UI layer.

## 3D scene (Three.js)

The game is being rebuilt as a 3D voxel scene rendered with Three.js. The
scene splits cleanly into original code-authored geometry and one downloaded,
openly licensed environment asset.

### Original code-authored geometry (no license required)

All of the following are built procedurally in TypeScript from Three.js
primitives (BoxGeometry / CylinderGeometry / ConeGeometry) and are original
work of the Grandmer project. No third-party model files are used for them.

- **Voxel examiner / teacher character** - grouped BoxGeometry blocks (head,
  torso, gown, arms, hands, mortarboard cap, tassel, face) with toon shading.
  See `src/scene/voxelCharacter.ts`.
- **3D pen (cursor-following)** - procedural cylinder body, grip band, conical
  nib, and cap clip. See `src/scene/pen.ts`.
- **Desk + answer paper surface** - procedural boxes (wooden desktop, front
  lip, thin paper sheet). See `src/scene/paper.ts`.
- **Answer token text + ink lasso loops** - token words are drawn to a
  `CanvasTexture` (Caveat font) on procedural plane meshes, and the pen's ink
  strokes / persistent circle loops are procedural `THREE.Line` geometry. All
  original work. See `src/screens/marking.ts` (standard papers) and
  `src/screens/essay.ts` (the essay free-for-all finale), which share the same
  procedural token-sprite and ink approach on the 3D paper.

### Downloaded 3D assets

| Asset | Type | Use | Author | License | Source |
| ----- | ---- | --- | ------ | ------- | ------ |
| lythwood_room (1k HDR) | HDRI environment map | Image-based lighting + 3D background room behind the desk | Poly Haven | CC0 1.0 (public domain) | https://polyhaven.com/a/lythwood_room |

The HDRI file is vendored into the repo at
`src/scene/assets/lythwood_room_1k.hdr` (downloaded from
`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/lythwood_room_1k.hdr`)
and bundled by Vite so the static build is self-contained. Poly Haven assets
are released under CC0 1.0, which places them in the public domain and requires
no attribution; it is recorded here for transparency.

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
