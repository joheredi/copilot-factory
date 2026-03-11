import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/web-ui",
    environment: "node",
  },
});
