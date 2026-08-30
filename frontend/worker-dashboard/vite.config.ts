import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.VITEST ? "test" : "production",
    ),
  },
  server: {
    fs: {
      allow: [resolve(rootDir, "../..")],
    },
  },
  build: {
    target: "es2020",
    minify: "oxc",
    outDir: resolve(rootDir, "../../panel/worker/assets/dashboard"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(rootDir, "src/entry.tsx"),
      name: "GarbonaWorkerDashboard",
      formats: ["iife"],
      fileName: () => "dashboard.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css"))
            ? "dashboard.css"
            : "[name][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
