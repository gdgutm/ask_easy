import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "src/__tests__/prisma-schema.test.ts",
      "src/__tests__/session-join.test.ts",
      "src/__tests__/slide-control.test.ts",
    ],
    // Run test files sequentially to avoid database conflicts
    fileParallelism: false,
    // Run tests within each file sequentially
    sequence: {
      concurrent: false,
    },
  },
});
