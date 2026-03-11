import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/infrastructure",
    environment: "node",
  },
});
