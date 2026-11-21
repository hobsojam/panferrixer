import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the game from hobsojam.github.io/panferrixer/, not the root. The dev
  // server keeps the root, so npm run dev opens where it always did.
  base: command === "build" ? "/panferrixer/" : "/",
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
}));
