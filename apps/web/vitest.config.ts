import { defineProject } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineProject({
  plugins: [solid()],
  resolve: { conditions: ["browser", "development"] },
  test: { name: "web", include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom" },
});
