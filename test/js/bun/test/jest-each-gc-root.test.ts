// test.each(arr) / describe.each(arr) create a ScopeFunctions whose Zig struct
// stores `arr` as a raw jsc.JSValue. The codegen for `values: ["each"]` in
// jest.classes.ts emits a C++ `m_each` WriteBarrier that visitChildren walks,
// but the Zig side never called `eachSetCached` to populate it — so the only
// reference to `arr` lived in unmanaged memory the GC never scans. If GC ran
// between `.each(arr)` and the trailing `("name", cb)` call, the array could
// be collected and `callAsFunction` would iterate a freed cell.
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

test("all .each() table rows survived GC", () => {
  expect(seen).toEqual([
    ["alpha", 1],
    ["beta", 2],
    ["gamma", 3],
    ["delta"],
    ["epsilon"],
    ["zeta", 10],
    ["eta", 20],
  ]);
});
`;

test("test.each/describe.each table array is a GC root", async () => {
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

  expect(stderr).toContain("8 pass");
  expect(stderr).toContain("0 fail");
  expect(stdout + stderr).not.toContain("Expected array");
  expect(exitCode).toBe(0);
}, 60_000);
