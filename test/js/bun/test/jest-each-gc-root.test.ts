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

async function runFixture(fixture: string, env: Record<string, string | undefined>) {
  using dir = tempDir("jest-each-gc-template", {
    "each-gc.test.ts": fixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "each-gc.test.ts"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

// .each builds the rows of a template table. After it returns, the ScopeFunctions is
// the only owner of the rows, and the rows are the only owners of the values.
const templateFixture = `
import { test, describe, expect } from "bun:test";

const seen: unknown[][] = [];

const templateEach = (() => (() =>
  test.each\`
    name       | payload
    \${"alpha"} | \${{ list: [1, 2] }}
    \${"beta"}  | \${{ list: [3, 4] }}
  \`
)())();

const chainedTemplateEach = (() => (() =>
  describe.each\`
    name       | payload
    \${"gamma"} | \${{ list: [5, 6] }}
  \`.skipIf(false)
)())();

Bun.gc(true);

templateEach("template.each $name", ({ name, payload }) => {
  seen.push([name, ...payload.list]);
});

Bun.gc(true);

chainedTemplateEach("chained template.each $name", ({ name, payload }) => {
  test("inner", () => {
    seen.push([name, ...payload.list]);
  });
});

test("all rows survived GC", () => {
  expect(seen).toEqual([
    ["alpha", 1, 2],
    ["beta", 3, 4],
    ["gamma", 5, 6],
  ]);
});
`;

test("the rows of a test.each/describe.each template table are a GC root", async () => {
  const gcEnv: Record<string, string> = { BUN_JSC_useZombieMode: "1" };
  if (!isWindows) gcEnv.BUN_JSC_collectContinuously = "1";

  const { stderr, exitCode } = await runFixture(templateFixture, gcEnv);

  expect(stderr).toContain(" 4 pass");
  expect(stderr).toContain(" 0 fail");
  expect(exitCode).toBe(0);
});

// A collection runs while .each builds the rows, and while it makes the function that keeps
// them: the row array and its rows have no other owner then. slowPathAllocsBetweenGCs
// collects at every Nth slow allocation, so a table of 800 rows gets collections in both.
const buildFixture = `
import { test, describe, expect } from "bun:test";

const ROWS = 800;
const strings = Object.assign(["\\n  index | payload\\n", ...Array(ROWS * 2).fill(" ")], { raw: [] });
const rows = (() => (() => {
  const values = [];
  for (let i = 0; i < ROWS; i++) values.push(i, { list: [i, i + 1] });
  return describe.each(strings, ...values);
})())();

Bun.gc(true);

let sum = 0;
rows("row $index", ({ index, payload }) => {
  if (payload.list[0] === index && payload.list[1] === index + 1) sum += index;
});

test("every row survived", () => {
  expect(sum).toBe((ROWS * (ROWS - 1)) / 2);
});
`;

test.concurrent.each([3, 4])(
  "a template table survives a GC while .each builds its rows (every %i slow allocations)",
  async period => {
    const { stderr, exitCode } = await runFixture(buildFixture, {
      BUN_JSC_useZombieMode: "1",
      BUN_JSC_slowPathAllocsBetweenGCs: String(period),
    });

    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  },
);
