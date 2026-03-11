import { describe, it, expect } from "vitest";

import { FakeClock, DEFAULT_INITIAL_TIME } from "./fake-clock.js";

/**
 * Tests for FakeClock — deterministic time control.
 *
 * FakeClock is foundational test infrastructure: lease expiry, heartbeat
 * staleness, cooldown windows, and scheduling decisions all depend on
 * wall-clock time. If FakeClock is broken, every time-dependent test
 * in the system is unreliable.
 */
describe("FakeClock", () => {
  /**
   * Validates the default initial time matches the documented epoch
   * (2025-01-01T00:00:00.000Z). All time-dependent tests use this as
   * their reference origin.
   */
  it("starts at DEFAULT_INITIAL_TIME by default", () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(DEFAULT_INITIAL_TIME);
    expect(clock.now()).toBe(1735689600000);
  });

  /**
   * Validates custom initial time support for tests that need to start
   * at a specific moment (e.g., testing lease expiry at a particular time).
   */
  it("accepts a custom initial time", () => {
    const custom = 1700000000000;
    const clock = new FakeClock(custom);
    expect(clock.now()).toBe(custom);
  });

  /**
   * Validates that advance() moves time forward by the exact amount.
   * This is the primary mechanism for simulating time passage in tests.
   */
  it("advances time by the specified amount", () => {
    const clock = new FakeClock();
    clock.advance(5000);
    expect(clock.now()).toBe(DEFAULT_INITIAL_TIME + 5000);
  });

  /**
   * Validates that multiple advance() calls are cumulative.
   * Tests often advance time in steps to check intermediate behavior.
   */
  it("accumulates multiple advances", () => {
    const clock = new FakeClock();
    clock.advance(1000);
    clock.advance(2000);
    clock.advance(3000);
    expect(clock.now()).toBe(DEFAULT_INITIAL_TIME + 6000);
  });

  /**
   * Validates the safety guard against backward time travel.
   * Causal ordering assumptions would break if time went backward.
   */
  it("throws RangeError on negative advance", () => {
    const clock = new FakeClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow("negative");
  });

  /**
   * Validates zero-advance is a no-op (useful for boundary conditions).
   */
  it("allows advance of zero milliseconds", () => {
    const clock = new FakeClock();
    clock.advance(0);
    expect(clock.now()).toBe(DEFAULT_INITIAL_TIME);
  });

  /**
   * Validates setTime() for absolute time jumps used in tests that need
   * to jump to a specific moment without incremental advances.
   */
  it("sets absolute time", () => {
    const clock = new FakeClock();
    const target = 2000000000000;
    clock.setTime(target);
    expect(clock.now()).toBe(target);
  });

  /**
   * Validates ISO string output for human-readable timestamp assertions.
   */
  it("returns ISO 8601 string", () => {
    const clock = new FakeClock();
    expect(clock.toISO()).toBe("2025-01-01T00:00:00.000Z");
    clock.advance(5000);
    expect(clock.toISO()).toBe("2025-01-01T00:00:05.000Z");
  });

  /**
   * Validates reset() returns to initial time for test isolation.
   */
  it("resets to initial time", () => {
    const clock = new FakeClock();
    clock.advance(10000);
    clock.reset();
    expect(clock.now()).toBe(DEFAULT_INITIAL_TIME);
  });

  /**
   * Validates reset() with custom initial time preserves the custom origin.
   */
  it("resets to custom initial time", () => {
    const custom = 1700000000000;
    const clock = new FakeClock(custom);
    clock.advance(5000);
    clock.reset();
    expect(clock.now()).toBe(custom);
  });

  /**
   * Validates createDateNow() produces a function bound to the clock.
   * This is the primary injection point for production code.
   */
  it("createDateNow returns a function tracking clock state", () => {
    const clock = new FakeClock();
    const dateNow = clock.createDateNow();

    expect(dateNow()).toBe(DEFAULT_INITIAL_TIME);
    clock.advance(1000);
    expect(dateNow()).toBe(DEFAULT_INITIAL_TIME + 1000);
  });

  /**
   * Validates that multiple createDateNow() calls from the same clock
   * share state (they all track the same timeline).
   */
  it("multiple createDateNow instances share the same clock", () => {
    const clock = new FakeClock();
    const fn1 = clock.createDateNow();
    const fn2 = clock.createDateNow();

    clock.advance(500);
    expect(fn1()).toBe(fn2());
  });
});
