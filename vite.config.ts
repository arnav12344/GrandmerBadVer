import { defineConfig } from "vite";
import { resolve } from "node:path";

// Static build for a trivially hostable investor demo.
// Relative base so the built dist/ can be served from any subpath.
export default defineConfig({
  base: "./",
  // Treat 3D asset formats as static assets so importing them yields a bundled
  // URL (Vite does not recognise .hdr/.glb/.gltf out of the box).
  assetsInclude: ["**/*.hdr", "**/*.glb", "**/*.gltf"],
  build: {
    outDir: "dist",
    target: "es2020",
    rollupOptions: {
      // Two pages: the game (index.html) and a standalone 3D scene preview
      // (scene.html) used for manual WebGL verification via `npm run dev`.
      // The preview entry also ensures the scene code and vendored HDRI are
      // bundled into dist/ so the environment asset ships in the static build.
      input: {
        main: resolve(__dirname, "index.html"),
        scene: resolve(__dirname, "scene.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
