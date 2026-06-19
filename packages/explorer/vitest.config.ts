import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Component-test config: jsdom DOM + Testing Library, no watch (CI/author runs).
 * Tests live next to the code under `src/**\/__tests__/*.test.tsx`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    watch: false,
  },
});
