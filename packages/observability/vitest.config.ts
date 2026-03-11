import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/observability",
    environment: "node",
  },
});
