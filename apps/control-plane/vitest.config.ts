import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@factory/control-plane",
    environment: "node",
  },
});
