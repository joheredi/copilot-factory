import { describe, it, expect } from "vitest";
import { cn } from "./utils";

/**
 * Tests for the cn() utility function.
 *
 * Validates that the class merging utility correctly combines,
 * deduplicates, and resolves conflicting Tailwind CSS classes.
 * This is foundational — every shadcn/ui component depends on cn().
 */
describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes via clsx syntax", () => {
    const isHidden = false;
    expect(cn("base", isHidden && "hidden", "visible")).toBe("base visible");
  });

  it("deduplicates conflicting Tailwind classes", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles array inputs", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles object inputs (clsx conditional syntax)", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});
