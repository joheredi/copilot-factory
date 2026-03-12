import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/web-ui",
    environment: "jsdom",
    css: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
