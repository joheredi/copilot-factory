import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/schemas",
    environment: "node",
  },
});
