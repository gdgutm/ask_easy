import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "happy-dom",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/__tests__/prisma-schema.test.ts",
      "src/__tests__/session-join.test.ts",
      "src/__tests__/slide-control.test.ts",
    ],
  },
});
