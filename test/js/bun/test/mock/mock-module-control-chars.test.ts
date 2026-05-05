import { expect, mock, test } from "bun:test";

// Regression tests for mock.module() specifier validation. These cover the
// interaction between the early-return guard in JSMock__jsModuleMock and the
// downstream resolver call.

test("mock.module does not crash on bare specifiers with bracket / control characters", () => {
  // These specifiers used to reach the resolver auto-install code path and
  // reentrantly tick the JS event loop from inside the running mock call,
  // causing a flaky use-after-poison in UnboundedQueue.popBatch. The fix
  // skips resolve for bare specifiers that can never be valid module names.
  const specifiers = [
    "function Float32Array() { [native code] },,,[object Object],",
    "(parens)",
    "{braces}",
    "[brackets]",
    "foo\u0000bar",
    "foo\nbar",
    "foo\rbar",
    "foo\tbar",
    "foo bar",
  ];
  for (const specifier of specifiers) {
    expect(() => mock.module(specifier, () => ({ default: 1 }))).not.toThrow();
  }
});

test("mock.module still accepts relative paths containing space or bracket characters", () => {
  // Regression for an overly broad character filter that rejected space and
  // bracket characters on all specifiers, silently breaking mocks for paths
  // like `./my module.js` (spaces on macOS/Windows) or `./[id]/page.ts`
  // (Next.js dynamic routes). Relative paths never reach the auto-install
  // code path the guard was designed to prevent, so they must pass through
  // the resolver as usual.
  expect(() => mock.module("./mock-module-fixture-with space.js", () => ({ default: 1 }))).not.toThrow();
  expect(() => mock.module("./mock-module-fixture-[dynamic].js", () => ({ default: 1 }))).not.toThrow();
});

test("mock.module skips the resolver for bare specifiers with bracket characters", () => {
  // The fix's observable effect: bare specifiers containing characters never
  // valid in an npm package name (brackets, parens, braces, whitespace) skip
  // the full resolver call, while relative paths with the same characters
  // still go through the resolver. Without the fix, both paths invoke the
  // resolver and take comparable time; with the fix, the bracket-bare case
  // is an early return and should be much faster than the relative case.
  //
  // Warm up both paths so the comparison isn't skewed by first-call overhead.
  for (let i = 0; i < 30; i++) {
    mock.module(`(warm-bare-${i})`, () => ({}));
    mock.module(`./warm-rel-${i}.js`, () => ({}));
  }

  const N = 500;

  const bareStart = performance.now();
  for (let i = 0; i < N; i++) {
    mock.module(`(bracket-bare-${i})`, () => ({ default: i }));
  }
  const bareTime = performance.now() - bareStart;

  const relStart = performance.now();
  for (let i = 0; i < N; i++) {
    mock.module(`./nonexistent-rel-${i}.js`, () => ({ default: i }));
  }
  const relTime = performance.now() - relStart;

  // Without the fix, this ratio is ~1.0 (both paths go through the resolver).
  // With the fix, bare+brackets skips the resolver and the ratio is <0.2.
  // 0.5 leaves a wide safety margin in both directions.
  expect(bareTime / relTime).toBeLessThan(0.5);
});
