import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", include: ["packages/shared/src/**/*.test.ts"], environment: "node" } },
      { test: { name: "realtime", include: ["apps/realtime/src/**/*.test.ts"], environment: "node" } },
      "apps/web/vitest.config.ts",
    ],
  },
});
