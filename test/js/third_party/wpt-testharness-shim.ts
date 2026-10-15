// Minimal WPT testharness.js shim mapped onto bun:test, shared by the
// wpt-h2 and wpt-streams runners. It covers the surface their vendored
// .any.js files (and streams/resources/*.js) actually touch:
//
//   test / promise_test / async_test
//   assert_{equals,not_equals,true,false,array_equals,object_equals,
//           unreached,throws_js,throws_exactly,throws_dom,greater_than}
//   promise_rejects_{js,exactly,dom}
//   t.step / t.step_func / t.step_func_done / t.unreached_func / t.add_cleanup
//   step_timeout
//
// The vendored files are byte-identical to upstream; every adaptation lives
// here or in each suite's runner. Registration of subtests is delegated to
// the runner through `setRegistrar` so that each runner decides how a WPT
// subtest maps onto bun:test (todo/failing policy lives in the runner).
//
// Faithful WPT semantics the shim enforces (see wpt-streams.test.ts for how
// that runner maps expected failures):
//   - `promise_test` bodies must return a thenable.
//   - A subtest that times out still runs its `t.add_cleanup`s, so a hung
//     body cannot leave patched globals installed for later subtests.
//   - The shim's own bookkeeping never goes through user-patchable prototype
//     methods, so the patched-global.any.js subtests observe only the
//     implementation, never the harness.
// A rejection that ends up unhandled while a subtest runs fails that subtest
// too, but that is bun:test's own built-in behavior — see the "Unhandled
// rejections" section below for why the shim neither can nor needs to
// re-implement it.

import { isASAN } from "harness";

/** How the runner receives each WPT subtest. `run` resolves on PASS and
 * rejects on FAIL; a rejection whose Error.name is "WPTTimeout" is a hang. */
export type SubtestKind = "test" | "promise_test" | "async_test";
export type Registrar = (name: string, run: () => Promise<void>, kind?: SubtestKind) => void;

let registrar: Registrar = () => {
  throw new Error("wpt testharness-shim: setRegistrar() was not called");
};
export function setRegistrar(r: Registrar) {
  registrar = r;
}

// Wall-clock budget for a single WPT subtest (body + cleanups). It must be
// smaller than bun:test's default per-test timeout (5000ms; this suite never
// overrides it) so a hang is always reported as a named `WPTTimeout` — and,
// in record mode, journaled — instead of bun killing the body mid-flight.
// ASAN/debug builds run several times slower, so they get 3x; that can only
// reduce false TIMEOUTs. 1500 * 3 = 4500ms leaves 500ms for cleanups.
export let SUBTEST_TIMEOUT_MS = 1500 * (isASAN ? 3 : 1);
// WPT's `// META: timeout=long` multiplies the budget; idlharness's `idl_test
// setup` runs every member subtest inline, so it needs the long budget.
export function setSubtestTimeout(ms: number): number {
  const prev = SUBTEST_TIMEOUT_MS;
  SUBTEST_TIMEOUT_MS = ms;
  return prev;
}

// ---------------------------------------------------------------------------
// assertion helpers (semantics follow upstream resources/testharness.js)

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function fail(message: string): never {
  throw new AssertionError(message);
}

export function format_value(val: unknown): string {
  if (Array.isArray(val)) return `[${(val as unknown[]).map(format_value).join(", ")}]`;
  switch (typeof val) {
    case "string":
      return JSON.stringify(val);
    case "symbol":
    case "bigint":
    case "function":
      return String(val);
    case "object":
      if (val === null) return "null";
      try {
        const ctor = (val as any).constructor?.name;
        if (val instanceof Error) return `${(val as Error).name}: ${(val as Error).message}`;
        return `object "${String(val)}" (${ctor})`;
      } catch {
        return "[object]";
      }
    default:
      return String(val);
  }
}

// Upstream testharness.js `same_value`: NaN equals NaN, but +0 and -0 are
// distinct (everything else is `===`).
function sameValue(x: unknown, y: unknown): boolean {
  if ((y as any) !== (y as any)) return (x as any) !== (x as any);
  if (x === 0 && y === 0) return 1 / (x as number) === 1 / (y as number);
  return x === y;
}

function assert_equals(actual: unknown, expected: unknown, description?: string) {
  if (typeof actual !== typeof expected) {
    fail(
      `assert_equals: ${description ?? ""} expected (${typeof expected}) ${format_value(expected)} but got (${typeof actual}) ${format_value(actual)}`,
    );
  }
  if (!sameValue(actual, expected)) {
    fail(`assert_equals: ${description ?? ""} expected ${format_value(expected)} but got ${format_value(actual)}`);
  }
}

function assert_not_equals(actual: unknown, expected: unknown, description?: string) {
  if (sameValue(actual, expected)) {
    fail(`assert_not_equals: ${description ?? ""} got disallowed value ${format_value(actual)}`);
  }
}

function assert_true(actual: unknown, description?: string) {
  if (actual !== true) fail(`assert_true: ${description ?? ""} expected true got ${format_value(actual)}`);
}

function assert_false(actual: unknown, description?: string) {
  if (actual !== false) fail(`assert_false: ${description ?? ""} expected false got ${format_value(actual)}`);
}

function assert_array_equals(actual: any, expected: any, description?: string) {
  if (typeof actual !== "object" || actual === null || !("length" in actual)) {
    fail(`assert_array_equals: ${description ?? ""} value is ${format_value(actual)}, expected array`);
  }
  if (actual.length !== expected.length) {
    fail(
      `assert_array_equals: ${description ?? ""} lengths differ, expected array ${format_value(expected)} length ${expected.length}, got ${format_value(actual)} length ${actual.length}`,
    );
  }
  for (let i = 0; i < actual.length; i++) {
    const aHas = Object.prototype.hasOwnProperty.call(actual, i);
    const eHas = Object.prototype.hasOwnProperty.call(expected, i);
    if (aHas !== eHas) {
      fail(`assert_array_equals: ${description ?? ""} property ${i}, property expected to be ${eHas} but was ${aHas}`);
    }
    if (!sameValue(actual[i], expected[i])) {
      fail(
        `assert_array_equals: ${description ?? ""} expected property ${i} to be ${format_value(expected[i])} but got ${format_value(actual[i])} (expected array ${format_value(expected)} got ${format_value(actual)})`,
      );
    }
  }
}

// Byte-for-byte port of upstream testharness.js's assert_object_equals: walk the
// ACTUAL object's enumerable properties and recurse whenever actual[p] is a non-null
// object (regardless of expected[p]'s type), then require expected's properties to
// exist on actual. Browsers and Node run the suite under exactly these semantics.
function assert_object_equals(actual: any, expected: any, description?: string) {
  if (typeof actual !== "object" || actual === null) {
    fail(`assert_object_equals: ${description ?? ""} value is ${format_value(actual)}, expected object`);
  }
  const stack: unknown[] = [];
  function check(a: any, e: any) {
    stack.push(a);
    for (const p in a) {
      if (!Object.prototype.hasOwnProperty.call(e, p)) {
        fail(`assert_object_equals: ${description ?? ""} unexpected property "${p}"`);
      }
      if (typeof a[p] === "object" && a[p] !== null) {
        if (!stack.includes(a[p])) check(a[p], e[p]);
      } else if (!Object.is(a[p], e[p])) {
        fail(
          `assert_object_equals: ${description ?? ""} property "${p}" expected ${format_value(e[p])} got ${format_value(a[p])}`,
        );
      }
    }
    for (const p in e) {
      if (!Object.prototype.hasOwnProperty.call(a, p)) {
        fail(`assert_object_equals: ${description ?? ""} expected property "${p}" missing`);
      }
    }
    stack.pop();
  }
  check(actual, expected);
}

function assert_own_property(object: any, property_name: any, description?: string) {
  if (!Object.prototype.hasOwnProperty.call(object, property_name)) {
    fail(`assert_own_property: ${description ?? ""} expected property ${format_value(property_name)} missing`);
  }
}

function assert_inherits(object: any, property_name: any, description?: string) {
  const d = description ?? "";
  const isObj = (typeof object === "object" && object !== null) || typeof object === "function";
  if (!isObj) fail(`assert_inherits: ${d} provided value is not an object`);
  if (!("hasOwnProperty" in object)) fail(`assert_inherits: ${d} provided value has no hasOwnProperty method`);
  if (Object.prototype.hasOwnProperty.call(object, property_name)) {
    fail(`assert_inherits: ${d} property ${format_value(property_name)} found on object expected in prototype chain`);
  }
  if (!(property_name in object)) {
    fail(`assert_inherits: ${d} property ${format_value(property_name)} not found in prototype chain`);
  }
}

function assert_class_string(object: any, class_string: string, description?: string) {
  const actual = {}.toString.call(object);
  const expected = `[object ${class_string}]`;
  if (!Object.is(actual, expected)) {
    fail(`assert_class_string: ${description ?? ""} expected ${format_value(expected)} but got ${format_value(actual)}`);
  }
}

function assert_regexp_match(actual: any, expected: RegExp, description?: string) {
  if (!expected.test(actual)) {
    fail(`assert_regexp_match: ${description ?? ""} expected ${String(expected)} but got ${format_value(actual)}`);
  }
}

function assert_in_array(actual: any, expected: any[], description?: string) {
  if (expected.indexOf(actual) === -1) {
    fail(
      `assert_in_array: ${description ?? ""} value ${format_value(actual)} not in array ${format_value(expected)}`,
    );
  }
}

function assert_greater_than(actual: any, expected: any, description?: string) {
  if (!(typeof actual === "number" && actual > expected)) {
    fail(
      `assert_greater_than: ${description ?? ""} expected a number greater than ${format_value(expected)} but got ${format_value(actual)}`,
    );
  }
}

function assert_unreached(description?: string) {
  fail(`assert_unreached: ${description ?? "reached unreachable code"}`);
}

// ---------------------------------------------------------------------------
// assert_throws_* / promise_rejects_*: one checker per "what was thrown"
// contract, one driver for sync throws and one for rejections.

type ThrownCheck = (e: unknown, context: string, description?: string) => void;

const checkThrownJs =
  (ctor: any): ThrownCheck =>
  (e: any, context, description) => {
    // Mirrors testharness.js assert_throws_js_impl: an error-like object (name + message)
    // of the right constructor. It deliberately does NOT require a `stack` property:
    // engines may omit it for errors created with no JavaScript frames on the stack.
    if (!(e instanceof Object) || !("name" in e) || !("message" in e)) {
      fail(`${context}: ${description ?? ""} threw ${format_value(e)}, not an error type`);
    }
    if (!(e instanceof ctor)) {
      fail(`${context}: ${description ?? ""} threw ${format_value(e)} (${e.name}), expected instance of ${ctor.name}`);
    }
  };

const checkThrownExactly =
  (expected: unknown): ThrownCheck =>
  (e, context, description) => {
    if (e !== expected) {
      fail(
        `${context}: ${description ?? ""} threw/rejected with ${format_value(e)} but we expected ${format_value(expected)}`,
      );
    }
  };

const checkThrownDom =
  (name: string): ThrownCheck =>
  (e: any, context, description) => {
    if (typeof e !== "object" || e === null || !(e instanceof DOMException)) {
      fail(`${context}: ${description ?? ""} rejected/threw ${format_value(e)}, expected a DOMException`);
    }
    if (e.name !== name) {
      fail(`${context}: ${description ?? ""} expected DOMException "${name}" but got "${e.name}"`);
    }
  };

function assertThrows(context: string, check: ThrownCheck, fn: () => unknown, description?: string) {
  try {
    fn();
  } catch (e) {
    return void check(e, context, description);
  }
  fail(`${context}: ${description ?? ""} did not throw`);
}

async function promiseRejects(context: string, check: ThrownCheck, promise: Promise<unknown>, description?: string) {
  let value: unknown;
  try {
    value = await promise;
  } catch (e) {
    return void check(e, context, description);
  }
  fail(`${context}: ${description ?? ""} ${format_value(value)} did not reject`);
}

const assert_throws_js = (ctor: any, fn: () => unknown, description?: string) =>
  assertThrows("assert_throws_js", checkThrownJs(ctor), fn, description);
const assert_throws_exactly = (expected: unknown, fn: () => unknown, description?: string) =>
  assertThrows("assert_throws_exactly", checkThrownExactly(expected), fn, description);
const assert_throws_dom = (name: string, fn: () => unknown, description?: string) =>
  assertThrows("assert_throws_dom", checkThrownDom(name), fn, description);
const promise_rejects_js = (_t: unknown, ctor: any, promise: Promise<unknown>, description?: string) =>
  promiseRejects("promise_rejects_js", checkThrownJs(ctor), promise, description);
const promise_rejects_exactly = (_t: unknown, expected: unknown, promise: Promise<unknown>, description?: string) =>
  promiseRejects("promise_rejects_exactly", checkThrownExactly(expected), promise, description);
const promise_rejects_dom = (_t: unknown, name: string, promise: Promise<unknown>, description?: string) =>
  promiseRejects("promise_rejects_dom", checkThrownDom(name), promise, description);

// ---------------------------------------------------------------------------
// Test object handed to test()/promise_test() bodies.

class WPTTest {
  name: string;
  cleanups: Array<() => unknown> = [];
  // First error raised inside a t.step()/step_func() callback. WPT's step()
  // swallows the exception (so stream machinery is not perturbed by an
  // assertion failure inside e.g. an underlying sink method) and fails the
  // subtest afterwards; we mirror that.
  stepError: unknown = undefined;
  hasStepError = false;

  constructor(name: string) {
    this.name = name;
  }

  step<T>(fn: (...a: any[]) => T, thisObj?: unknown, ...args: any[]): T | undefined {
    try {
      return fn.apply(thisObj === undefined ? this : thisObj, args);
    } catch (e) {
      if (!this.hasStepError) {
        this.hasStepError = true;
        this.stepError = e;
      }
      // An exception inside a step fails the test immediately in WPT; for
      // async_test that also completes it (otherwise `done()` never runs).
      this.done();
      return undefined;
    }
  }

  step_func(fn: (...a: any[]) => unknown, thisObj?: unknown) {
    const t = this;
    return function (this: unknown, ...args: any[]) {
      return t.step(fn, thisObj === undefined ? this : thisObj, ...args);
    };
  }

  step_func_done(fn?: (...a: any[]) => unknown, thisObj?: unknown) {
    const t = this;
    return function (this: unknown, ...args: any[]) {
      if (fn) t.step(fn, thisObj === undefined ? this : thisObj, ...args);
      t.done();
    };
  }

  unreached_func(description?: string) {
    return this.step_func(() => assert_unreached(description));
  }

  step_timeout(fn: (...a: any[]) => unknown, timeout: number, ...args: any[]) {
    return setTimeout(
      this.step_func(() => fn(...args)),
      timeout,
    );
  }

  add_cleanup(fn: () => unknown) {
    this.cleanups.push(fn);
  }

  // async_test completion signal: resolved by t.done() (or by a failing step).
  readonly #done = Promise.withResolvers<void>();
  get donePromise(): Promise<void> {
    return this.#done.promise;
  }
  done() {
    this.#done.resolve();
  }

  // Cleanups run exactly once: the timeout path runs them eagerly, and the
  // abandoned body's own `finally` must not run them a second time.
  #ranCleanups = false;
  async runCleanups() {
    if (this.#ranCleanups) return;
    this.#ranCleanups = true;
    for (const fn of this.cleanups) {
      await fn();
    }
  }

  throwIfStepFailed() {
    if (this.hasStepError) throw this.stepError;
  }
}

// ---------------------------------------------------------------------------
// Unhandled rejections.
//
// bun:test itself already implements per-subtest unhandled-rejection failure,
// unconditionally: under `bun test`, VirtualMachine::unhandled_rejection()
// short-circuits every unhandled rejection into the test runner (which fails
// the currently active test) BEFORE `process`/`self` `unhandledRejection`
// listeners are ever consulted (src/jsc/VirtualMachine.rs, `isBunTest`). Two
// consequences this shim depends on and that were verified empirically:
//   1. A `process.on("unhandledRejection"/"rejectionHandled")` listener NEVER
//      fires inside `bun test`, so a shim-level tracker built on those events
//      is dead code. The runner's old process-global no-op handler was
//      likewise dead: it never suppressed anything.
//   2. bun:test is STRICTER than WPT here: WPT forgives a rejection that gets
//      a handler attached later (`rejectionHandled`); bun:test does not. That
//      strictness cannot be relaxed from userland. It currently causes zero
//      failures across the vendored suite.
// The only thing the shim adds is the trailing task drain in `runToDrained`
// below, which holds the subtest open for two extra turns so settle-adjacent
// fallout from the body is attributed to the subtest that caused it.

const macrotask = () => new Promise<void>(r => setTimeout(r, 0));

async function runToDrained(run: () => Promise<void>): Promise<void> {
  let failure: unknown;
  let failed = false;
  try {
    await run();
  } catch (e) {
    failure = e;
    failed = true;
  }
  await macrotask();
  await macrotask();
  if (failed) throw failure;
}

// ---------------------------------------------------------------------------
// test()/promise_test()/async_test() registration. Each subtest is handed to
// the runner as an async `run` closure; the runner maps it onto bun:test.

// This function must not call `.then`/`.catch`/`.finally` on any promise: the
// patched-global.any.js subtests replace `Promise.prototype.then` inside their
// bodies, and the harness's own bookkeeping must not be observable through (or
// broken by) user-patched prototypes. `await` never consults `.then` on a
// native promise, so every chain here goes through an async function instead.
function withTimeout(t: WPTTest, body: Promise<void>): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(async () => {
    // Run the cleanups before reporting the hang: an abandoned body must not
    // leave patched globals (e.g. an Object.prototype getter) installed.
    try {
      await t.runCleanups();
    } catch {}
    const err = new Error(`WPT subtest "${t.name}" did not settle within ${SUBTEST_TIMEOUT_MS}ms`);
    err.name = "WPTTimeout";
    reject(err);
  }, SUBTEST_TIMEOUT_MS);
  (async () => {
    try {
      await body;
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      clearTimeout(timer);
    }
  })();
  return promise;
}

function runSubtest(fn: (t: WPTTest) => unknown, name: string, requireThenable: boolean): Promise<void> {
  const t = new WPTTest(name);
  return runToDrained(() =>
    withTimeout(
      t,
      (async () => {
        try {
          const result = fn(t);
          if (
            requireThenable &&
            (result === null || result === undefined || typeof (result as any).then !== "function")
          ) {
            throw new AssertionError(
              `promise_test: test body must return a 'thenable' object (returned ${format_value(result)})`,
            );
          }
          await result;
          // Let a t.step_func firing in the settle-adjacent window land
          // before deciding whether a step failed.
          await macrotask();
          t.throwIfStepFailed();
        } finally {
          await t.runCleanups();
        }
      })(),
    ),
  );
}

// Exported (not installed on globalThis) because bun:test injects its own
// `test` binding into every module it loads; the runner feeds this in as a
// Function-constructor parameter instead. WPT's sync test() also accepts
// (name) or (fn) alone, but the vendored streams files always pass (fn, name).
const registerSubtest = (requireThenable: boolean) => (fn: (t: WPTTest) => unknown, name: string) =>
  registrar(name, () => runSubtest(fn, name, requireThenable), requireThenable ? "promise_test" : "test");

export const wptTest = registerSubtest(false);

const g = globalThis as any;

// promise_test bodies MUST return a thenable (upstream fails them otherwise);
// the sync test() must not, which is what makes the two non-identical.
g.promise_test = registerSubtest(true);

// async_test(fn, name): the body runs synchronously and the subtest completes
// when t.done() fires (or a step throws, which marks it failed and done).
// async_test(fn, name) runs the body and completes on t.done(); the upstream
// single-argument form async_test(name) creates and RETURNS the Test object so
// the caller can drive it manually with t.step()/t.done() (idlharness does this
// for every member test).
g.async_test = (fnOrName: ((t: WPTTest) => unknown) | string, name?: string) => {
  if (typeof fnOrName === "string") {
    const t = new WPTTest(fnOrName);
    registrar(
      fnOrName,
      () =>
        runToDrained(() =>
        withTimeout(
          t,
          (async () => {
            try {
              await t.donePromise;
              await macrotask();
              t.throwIfStepFailed();
            } finally {
              await t.runCleanups();
            }
          })(),
        ),
      ),
      "async_test",
    );
    return t;
  }
  const fn = fnOrName;
  const testName = name!;
  registrar(testName, () => {
    const t = new WPTTest(testName);
    return runToDrained(() =>
      withTimeout(
        t,
        (async () => {
          try {
            const done = t.donePromise;
            fn(t);
            await done;
            await macrotask();
            t.throwIfStepFailed();
          } finally {
            await t.runCleanups();
          }
        })(),
      ),
    );
  }, "async_test");
  return undefined;
};

g.step_timeout = (fn: (...a: any[]) => unknown, timeout: number, ...args: any[]) => setTimeout(fn, timeout, ...args);

g.assert_equals = assert_equals;
g.assert_not_equals = assert_not_equals;
g.assert_true = assert_true;
g.assert_false = assert_false;
g.assert_array_equals = assert_array_equals;
g.assert_object_equals = assert_object_equals;
g.assert_greater_than = assert_greater_than;
g.assert_own_property = assert_own_property;
g.assert_inherits = assert_inherits;
g.assert_class_string = assert_class_string;
g.assert_regexp_match = assert_regexp_match;
g.assert_in_array = assert_in_array;
g.assert_unreached = assert_unreached;
g.assert_throws_js = assert_throws_js;
g.assert_throws_exactly = assert_throws_exactly;
g.assert_throws_dom = assert_throws_dom;
g.promise_rejects_js = promise_rejects_js;
g.promise_rejects_exactly = promise_rejects_exactly;
g.promise_rejects_dom = promise_rejects_dom;
g.format_value = format_value;

// testharness.js APIs the shim deliberately does not implement. None of the
// vendored files use them today; a future re-vendor that does must fail
// loudly per call instead of silently truncating a file.
for (const name of [
  "setup",
  "promise_setup",
  "add_completion_callback",
  "subsetTest",
  "fetch_tests_from_worker",
  "single_test",
  "assert_implements",
  "assert_implements_optional",
]) {
  g[name] = () => {
    throw new Error(`wpt shim: ${name}() is not implemented`);
  };
}

// The .any.js "self" global. In Bun `self` already aliases globalThis; make it
// explicit so resource scripts assigning `self.foo = ...` create globals.
g.self = globalThis;

// /common/gc.js prefers the standardized TestUtils.gc() when present; wire it
// to Bun's synchronous full collection.
g.TestUtils = {
  gc: async () => {
    Bun.gc(true);
  },
};
