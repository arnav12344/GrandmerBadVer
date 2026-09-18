/*
 * Hand-authored inline pixel-art SVG props for the teacher's-desk aesthetic.
 * All artwork here is original CSS/SVG (no third-party art). Each prop is drawn
 * on a chunky 16x16-ish grid and scaled with image-rendering: pixelated so it
 * reads as pixel art. See ASSETS/CREDITS.md.
 */

/** Inkwell with a quill pen sticking out. */
export const inkwellQuillSvg = `
<svg class="desk-prop pixelated" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="inkwell and quill">
  <!-- quill feather -->
  <rect x="10" y="1" width="1" height="1" fill="#c9a227"/>
  <rect x="9" y="2" width="2" height="1" fill="#e0c14a"/>
  <rect x="8" y="3" width="3" height="1" fill="#c9a227"/>
  <rect x="7" y="4" width="3" height="1" fill="#e0c14a"/>
  <rect x="6" y="5" width="3" height="1" fill="#c9a227"/>
  <!-- quill shaft -->
  <rect x="5" y="6" width="2" height="1" fill="#3a2712"/>
  <rect x="5" y="7" width="1" height="1" fill="#3a2712"/>
  <rect x="4" y="8" width="1" height="1" fill="#3a2712"/>
  <!-- ink pot -->
  <rect x="3" y="9" width="8" height="1" fill="#2b2016"/>
  <rect x="2" y="10" width="10" height="4" fill="#2f3d6b"/>
  <rect x="2" y="14" width="10" height="1" fill="#1c264a"/>
  <rect x="3" y="10" width="2" height="1" fill="#4b5c96"/>
</svg>`;

/** A stack of three books. */
export const stackedBooksSvg = `
<svg class="desk-prop pixelated" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="stacked books">
  <!-- bottom book -->
  <rect x="1" y="11" width="14" height="3" fill="#a1121f"/>
  <rect x="1" y="11" width="14" height="1" fill="#c7404b"/>
  <rect x="2" y="12" width="12" height="1" fill="#fffdf5"/>
  <!-- middle book -->
  <rect x="2" y="8" width="12" height="3" fill="#2f3d6b"/>
  <rect x="2" y="8" width="12" height="1" fill="#4b5c96"/>
  <rect x="3" y="9" width="10" height="1" fill="#fffdf5"/>
  <!-- top book -->
  <rect x="3" y="5" width="10" height="3" fill="#3d7a3a"/>
  <rect x="3" y="5" width="10" height="1" fill="#5fa35b"/>
  <rect x="4" y="6" width="8" height="1" fill="#fffdf5"/>
  <!-- bookmark -->
  <rect x="11" y="5" width="1" height="4" fill="#c9a227"/>
</svg>`;

/**
 * A red ink splatter / combo burst, drawn as chunky pixel blobs radiating from
 * the centre. Purely decorative game-feel flourish thrown when the examiner
 * circles a word. Original hand-authored pixel art in the --wax-red palette; it
 * carries no correctness meaning. Rendered pointer-events:none by its wrapper.
 */
export const inkSplatSvg = `
<svg class="ink-splat__svg pixelated" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="ink splatter">
  <!-- core blob -->
  <rect x="6" y="6" width="4" height="4" fill="#a1121f"/>
  <rect x="7" y="5" width="2" height="1" fill="#c7404b"/>
  <rect x="7" y="10" width="2" height="1" fill="#c7404b"/>
  <rect x="5" y="7" width="1" height="2" fill="#c7404b"/>
  <rect x="10" y="7" width="1" height="2" fill="#c7404b"/>
  <!-- flung droplets -->
  <rect x="2" y="3" width="2" height="2" fill="#a1121f"/>
  <rect x="12" y="2" width="1" height="1" fill="#c7404b"/>
  <rect x="13" y="4" width="2" height="2" fill="#a1121f"/>
  <rect x="1" y="9" width="1" height="1" fill="#c7404b"/>
  <rect x="3" y="12" width="2" height="2" fill="#a1121f"/>
  <rect x="11" y="12" width="2" height="2" fill="#a1121f"/>
  <rect x="14" y="10" width="1" height="1" fill="#c7404b"/>
  <rect x="8" y="1" width="1" height="1" fill="#a1121f"/>
</svg>`;

/** A report card with a red grade stamp. */
export const reportCardSvg = `
<svg class="desk-prop pixelated" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="report card">
  <rect x="3" y="1" width="10" height="14" fill="#fffdf5" stroke="#2b2016" stroke-width="0.5"/>
  <rect x="4" y="3" width="8" height="1" fill="#5a4632"/>
  <rect x="4" y="5" width="8" height="1" fill="#5a4632"/>
  <rect x="4" y="7" width="8" height="1" fill="#5a4632"/>
  <rect x="4" y="9" width="6" height="1" fill="#5a4632"/>
  <!-- grade stamp -->
  <rect x="7" y="10" width="5" height="4" fill="#a1121f"/>
  <rect x="8" y="11" width="1" height="2" fill="#fffdf5"/>
  <rect x="9" y="11" width="1" height="1" fill="#fffdf5"/>
  <rect x="9" y="12" width="2" height="1" fill="#fffdf5"/>
</svg>`;
