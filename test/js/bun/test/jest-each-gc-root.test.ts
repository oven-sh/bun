// test.each(arr) / describe.each(arr) create a ScopeFunctions whose native struct
// stores `arr` as a raw JSValue, and test.extend(fixtures) stores the merged
// fixture registry the same way. The codegen for `values: ["each", "fixtures"]`
// in jest.classes.ts emits C++ `m_each` / `m_fixtures` WriteBarriers that
// visitChildren walks, but they only protect the values if the native side
// actually populates them (`eachSetCached` / `fixturesSetCached`); otherwise the
// only reference lives in unmanaged memory the GC never scans, and a GC between
// `.each(arr)` / `.extend(fixtures)` and the trailing `("name", cb)` call frees
// the value that `callAsFunction` is about to read.
//
// useZombieMode scribbles 0xbadbeef0 over swept cells so the dangling access
// manifests as a hard crash / wrong-type error instead of a heisenbug.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const fixture = `
import { test, describe, expect } from "bun:test";

const seen: unknown[][] = [];

function gcHard() {
  // Overwrite any stale stack slots that conservative scanning might pick up,
  // then force a synchronous full collection.
  for (let i = 0; i < 64; i++) new Array(128).fill({});
  Bun.gc(true);
  for (let i = 0; i < 64; i++) new Array(128).fill({});
  Bun.gc(true);
}

// Build the .each() callees in nested frames so the table arrays are not kept
// alive by the top-level stack after these IIFEs return.
const testEach = (() => (() =>
  test.each([
    ["alpha", 1],
    ["beta", 2],
    ["gamma", 3],
  ])
)())();

const describeEach = (() => (() =>
  describe.each([["delta"], ["epsilon"]])
)())();

// .skipIf(false) routes through genericIf -> createBound, propagating the
// array JSValue into a fresh ScopeFunctions; cover that path too.
const chainedEach = (() => (() =>
  test.each([["zeta", 10], ["eta", 20]]).skipIf(false)
)())();

// test.extend() keeps the merged fixture registry in m_fixtures; it is only
// reachable from the ScopeFunctions until the trailing ("name", cb) call.
const extended = (() => (() =>
  test.extend({ theta: "theta", iota: 30 })
)())();

// .extend() -> .skipIf(false) -> .each() propagates the registry through
// genericIf/createBound and fnEach; each row is wrapped separately.
const chainedExtend = (() => (() =>
  test.extend({ suffix: "!" }).skipIf(false).each([["kappa"], ["lambda"]])
)())();

gcHard();

testEach("test.each %s", (name, num) => {
  expect(typeof name).toBe("string");
  expect(typeof num).toBe("number");
  seen.push([name, num]);
});

gcHard();

describeEach("describe.each %s", name => {
  test("inner", () => {
    expect(typeof name).toBe("string");
    seen.push([name]);
  });
});

gcHard();

chainedEach("chained.each %s", (name, num) => {
  expect(typeof name).toBe("string");
  expect(typeof num).toBe("number");
  seen.push([name, num]);
});

gcHard();

extended("test.extend fixtures", ({ theta, iota }) => {
  expect(theta).toBe("theta");
  expect(iota).toBe(30);
  seen.push([theta, iota]);
});

gcHard();

chainedExtend("chained.extend %s", (name, { suffix }) => {
  expect(typeof name).toBe("string");
  seen.push([name + suffix]);
});

test("all .each() table rows and .extend() fixtures survived GC", () => {
  expect(seen).toEqual([
    ["alpha", 1],
    ["beta", 2],
    ["gamma", 3],
    ["delta"],
    ["epsilon"],
    ["zeta", 10],
    ["eta", 20],
    ["theta", 30],
    ["kappa!"],
    ["lambda!"],
  ]);
});
`;

test("test.each/describe.each tables and test.extend fixtures are GC roots", async () => {
  using dir = tempDir("jest-each-gc-root", {
    "each-gc.test.ts": fixture,
  });

  // useZombieMode scribbles dead cells so a collected array is never silently
  // "still valid"; collectContinuously keeps the marker racing the mutator.
  // Windows + collectContinuously is prohibitively slow in CI and the code
  // path is platform-agnostic, so rely on zombie mode + explicit Bun.gc there.
  const gcEnv: Record<string, string | undefined> = {
    ...bunEnv,
    BUN_JSC_useZombieMode: "1",
  };
  if (!isWindows) gcEnv.BUN_JSC_collectContinuously = "1";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "each-gc.test.ts"],
    env: gcEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("11 pass");
  expect(stderr).toContain("0 fail");
  expect(stdout + stderr).not.toContain("Expected array");
  expect(exitCode).toBe(0);
}, 60_000);
