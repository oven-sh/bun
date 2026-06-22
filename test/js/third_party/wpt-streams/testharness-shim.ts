// WPT testharness.js shim for the vendored streams .any.js files, mapped onto
// bun:test. Only the surface those files touch is implemented. Tests whose
// names appear in `knownFailures` are registered via test.todo so the suite
// stays green while documenting the gap.

import { test as bunTest } from "bun:test";

export const knownFailures = new Map<string, string>();

function register(name: string, body: () => unknown | Promise<unknown>) {
  if (knownFailures.has(name)) {
    bunTest.todo(`${name} — ${knownFailures.get(name)}`);
    return;
  }
  bunTest(name, async () => {
    await body();
  });
}

class WPTTest {
  cleanups: Array<() => unknown> = [];
  unreached_func(msg: string) {
    return (..._args: unknown[]) => {
      throw new Error(`unreached_func: ${msg}`);
    };
  }
  step(fn: (...a: unknown[]) => unknown, ..._args: unknown[]) {
    return fn();
  }
  step_func(fn: (...a: unknown[]) => unknown) {
    return (...args: unknown[]) => fn(...args);
  }
  add_cleanup(fn: () => unknown) {
    this.cleanups.push(fn);
  }
}

const g = globalThis as any;
g.self = globalThis;

g.promise_test = (fn: (t: WPTTest) => Promise<unknown>, name: string) => {
  register(name, async () => {
    const t = new WPTTest();
    try {
      await fn(t);
    } finally {
      for (const c of t.cleanups.reverse()) await c();
    }
  });
};

// Exported (not on globalThis) — bun:test injects its own `test` per module.
export const wptTest = (fn: (t: WPTTest) => unknown, name: string) => {
  register(name, () => {
    const t = new WPTTest();
    try {
      return fn(t);
    } finally {
      for (const c of t.cleanups.reverse()) c();
    }
  });
};

g.step_timeout = (fn: () => void, ms: number) => setTimeout(fn, ms);

function fmt(v: unknown) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v && typeof v === "object") return Object.prototype.toString.call(v);
  return String(v);
}

g.assert_equals = (actual: unknown, expected: unknown, msg?: string) => {
  if (!Object.is(actual, expected)) {
    throw new Error(`assert_equals: ${msg ?? ""} expected ${fmt(expected)} got ${fmt(actual)}`);
  }
};

g.assert_not_equals = (actual: unknown, expected: unknown, msg?: string) => {
  if (Object.is(actual, expected)) throw new Error(`assert_not_equals: ${msg ?? ""} got ${fmt(actual)}`);
};

g.assert_true = (actual: unknown, msg?: string) => {
  if (actual !== true) throw new Error(`assert_true: ${msg ?? ""} got ${fmt(actual)}`);
};

g.assert_false = (actual: unknown, msg?: string) => {
  if (actual !== false) throw new Error(`assert_false: ${msg ?? ""} got ${fmt(actual)}`);
};

g.assert_unreached = (msg?: string) => {
  throw new Error(`assert_unreached: ${msg ?? ""}`);
};

g.assert_array_equals = (actual: ArrayLike<unknown>, expected: ArrayLike<unknown>, msg?: string) => {
  if (actual.length !== expected.length) {
    throw new Error(
      `assert_array_equals: ${msg ?? ""} lengths differ, expected ${expected.length} got ${actual.length}`,
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (!Object.is(actual[i], expected[i])) {
      throw new Error(
        `assert_array_equals: ${msg ?? ""} index ${i}, expected ${fmt(expected[i])} got ${fmt(actual[i])}`,
      );
    }
  }
};

g.assert_throws_js = (ctor: new (...a: unknown[]) => Error, fn: () => unknown, msg?: string) => {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ctor)) {
      throw new Error(`assert_throws_js: ${msg ?? ""} expected ${ctor.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return;
  }
  throw new Error(`assert_throws_js: ${msg ?? ""} expected ${ctor.name}, but did not throw`);
};

g.promise_rejects_js = async (
  _t: unknown,
  ctor: new (...a: unknown[]) => Error,
  promise: Promise<unknown>,
  msg?: string,
) => {
  try {
    await promise;
  } catch (e) {
    if (!(e instanceof ctor)) {
      throw new Error(`promise_rejects_js: ${msg ?? ""} expected ${ctor.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return;
  }
  throw new Error(`promise_rejects_js: ${msg ?? ""} expected rejection with ${ctor.name}, but promise fulfilled`);
};

g.promise_rejects_exactly = async (_t: unknown, expected: unknown, promise: Promise<unknown>, msg?: string) => {
  try {
    await promise;
  } catch (e) {
    if (e !== expected) {
      throw new Error(`promise_rejects_exactly: ${msg ?? ""} expected ${fmt(expected)}, got ${fmt(e)}`);
    }
    return;
  }
  throw new Error(`promise_rejects_exactly: ${msg ?? ""} expected rejection, but promise fulfilled`);
};
