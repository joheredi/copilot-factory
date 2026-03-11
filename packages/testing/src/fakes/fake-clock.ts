/**
 * @module @factory/testing/fakes/fake-clock
 *
 * Deterministic clock replacement for time-dependent test scenarios.
 *
 * Many control-plane components depend on wall-clock time for lease expiry,
 * cooldown windows, audit timestamps, and scheduling decisions. Using
 * `Date.now()` directly makes those paths non-deterministic and hard to test.
 *
 * `FakeClock` provides a fully controllable time source that can be injected
 * wherever production code accepts a `() => number` clock function, giving
 * tests complete authority over the passage of time.
 *
 * @example
 * ```ts
 * const clock = new FakeClock();
 * clock.now();          // 1735689600000  (2025-01-01T00:00:00.000Z)
 * clock.advance(5000);
 * clock.now();          // 1735689605000
 * clock.toISO();        // "2025-01-01T00:00:05.000Z"
 * ```
 */

/** Default initial timestamp: 2025-01-01T00:00:00.000Z */
export const DEFAULT_INITIAL_TIME = 1735689600000 as const;

/**
 * A controllable clock for deterministic time in tests.
 *
 * Inject via `clock.now` or `clock.createDateNow()` wherever production
 * code reads the current time, then use `advance()` / `setTime()` to
 * drive time forward in a predictable, repeatable way.
 */
export class FakeClock {
  private currentTime: number;
  private readonly initialTime: number;

  /**
   * Create a new FakeClock.
   *
   * @param initialTime - Starting time in milliseconds since epoch.
   *   Defaults to {@link DEFAULT_INITIAL_TIME} (2025-01-01T00:00:00.000Z).
   */
  constructor(initialTime: number = DEFAULT_INITIAL_TIME) {
    this.currentTime = initialTime;
    this.initialTime = initialTime;
  }

  /**
   * Returns current fake time in milliseconds since epoch.
   *
   * Drop-in replacement for `Date.now()` in production code that
   * accepts an injectable clock function.
   */
  now(): number {
    return this.currentTime;
  }

  /**
   * Advance time by the given number of milliseconds.
   *
   * @param ms - Positive number of milliseconds to move forward.
   * @throws {RangeError} If `ms` is negative — time travel backward
   *   would violate causal ordering assumptions throughout the system.
   */
  advance(ms: number): void {
    if (ms < 0) {
      throw new RangeError(`Cannot advance by negative milliseconds: ${String(ms)}`);
    }
    this.currentTime += ms;
  }

  /**
   * Set time to an absolute value.
   *
   * Useful when a test needs to jump to a specific moment rather than
   * advancing incrementally.
   *
   * @param ms - Absolute time in milliseconds since epoch.
   */
  setTime(ms: number): void {
    this.currentTime = ms;
  }

  /**
   * Returns current fake time as an ISO 8601 string.
   *
   * Convenience wrapper so tests can assert on human-readable timestamps
   * without manually constructing `new Date(clock.now()).toISOString()`.
   */
  toISO(): string {
    return new Date(this.currentTime).toISOString();
  }

  /**
   * Reset to initial time.
   *
   * Intended for `beforeEach` / `afterEach` hooks so each test starts
   * from a known time origin without creating a new instance.
   */
  reset(): void {
    this.currentTime = this.initialTime;
  }

  /**
   * Create a `Date.now` replacement function bound to this clock.
   *
   * Returns a standalone `() => number` that can be passed anywhere
   * production code expects a clock function, while remaining tied to
   * this instance's controllable timeline.
   *
   * @returns A parameter-less function returning the current fake time.
   *
   * @example
   * ```ts
   * const clock = new FakeClock();
   * const dateNow = clock.createDateNow();
   * dateNow(); // 1735689600000
   * clock.advance(1000);
   * dateNow(); // 1735689601000
   * ```
   */
  createDateNow(): () => number {
    return () => this.now();
  }
}
