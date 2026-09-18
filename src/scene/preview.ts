/*
 * Grandmer - src/scene standalone preview harness (FEAT-002).
 *
 * A tiny developer entry point that mounts the 3D examiner's-desk scene on its
 * own so the visuals can be verified with `npm run dev` (open /scene.html) in a
 * real browser. This sandbox has NO GPU and NO headless browser, so WebGL
 * rendering cannot be verified here; this page is the manual-verification hook.
 *
 * It is intentionally separate from the main app (src/main.ts): it does not
 * touch the game flow or the happy-dom smoke test, and importing the scene here
 * ensures Vite bundles the scene code and the vendored HDRI into the static
 * build so the environment asset ships in dist/.
 */

import { createMarkingScene } from "./markingScene";

const root = document.getElementById("scene-root");
if (root) {
  const scene = createMarkingScene(root);
  // Expose a disposer on the window for manual teardown testing in the console.
  (window as unknown as { __grandmerScene?: unknown }).__grandmerScene = scene;
  // Wire an automatic teardown so navigating away from the dev harness frees the
  // renderer/GPU resources instead of leaving the disposer reachable only by
  // hand in the console. pagehide covers bfcache/tab close across browsers.
  const teardown = (): void => {
    window.removeEventListener("pagehide", teardown);
    scene.dispose();
  };
  window.addEventListener("pagehide", teardown);
}
