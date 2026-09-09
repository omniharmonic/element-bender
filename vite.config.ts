import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  plugins: [glsl()],
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
  server: {
    port: 5173,
    open: true,
  },
});
