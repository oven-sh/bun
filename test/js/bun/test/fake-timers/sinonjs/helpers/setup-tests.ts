import { vi, expect } from "bun:test";
import { promisify } from "util";

let active = false;
export class FakeTimers {
  private constructor() {}
  static install(opts: { now?: number } = { now: 0 }) {
    if (active) {
      vi.useRealTimers();
    }
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
  get setTimeout() {
    return setTimeout;
  }
  get now() {
    return Date.now();
  }
}

export function NOOP() {
  return undefined;
}

export const assert = (value: boolean) => {
  expect(value).toBeTrue();
};
Object.assign(assert, {
  equals(actual: unknown, expected: unknown) {
    expect(actual).toBe(expected);
  },
  same(actual: unknown, expected: unknown) {
    expect(actual).toBe(expected);
  },
  exception(fn: () => void, message?: string | RegExp) {
    expect(fn).toThrow(message);
  },
  calledTwice(a) {
    expect(a.calls.length).toBe(2);
  },
  alwaysCalledWith(a, arg) {
    expect(a.calls.every(c => c.includes(arg))).toBeTrue(2);
  },
});
export const refute = {};
export const sinon = {
  stub() {
    let calls = [];
    const result = (...args) => {
      calls.push(args);
    };
    result.calls = calls;
    Object.defineProperty(result, "notCalled", {
      get() {
        return calls.length === 0;
      },
    });
    Object.defineProperty(result, "calledOnce", {
      get() {
        return calls.length === 1;
      },
    });
    Object.defineProperty(result, "calledTwice", {
      get() {
        return calls.length === 2;
      },
    });
    return result;
  },
};

export const nextTickPresent = true;
export const queueMicrotaskPresent = true;
export const hrtimePresent = true;
export const hrtimeBigintPresent = true;
export const performanceNowPresent = true;
export const performanceMarkPresent = true;
export const setImmediatePresent = true;
export const utilPromisify = promisify;
export const promisePresent = true;
export const utilPromisifyAvailable = true;
export const addTimerReturnsObject = true;
export const globalObject = globalThis;
export const GlobalDate = Date;
