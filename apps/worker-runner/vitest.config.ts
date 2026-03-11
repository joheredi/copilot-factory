import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/worker-runner",
    environment: "node",
  },
});
