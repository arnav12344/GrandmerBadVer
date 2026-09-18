import { defineConfig } from "vite";

// Static build for a trivially hostable investor demo.
// Relative base so the built dist/ can be served from any subpath.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
