import { vi, expect } from "bun:test";

let active = false;
export class FakeTimers {
  private constructor() {}
  static install(opts: { now?: number } = { now: 0 }) {
    if (active) throw new Error("FakeTimers already active");
    active = true;
    vi.useFakeTimers({ now: opts.now });
    return new FakeTimers();
  }
  uninstall() {
    vi.useRealTimers();
    active = false;
  }
  tick(ms: number) {
    vi.advanceTimersByTime(ms);
  }
  hrtime(...args: Parameters<typeof process.hrtime>) {
    return process.hrtime(...args);
  }
  get now() {
    return Date.now();
  }
}

export const assert = {
  equals(actual: unknown, expected: unknown) {
    expect(actual).toBe(expected);
  },
};

export const hrtimePresent = true;
