// Kept separate from parallel.test.ts for the reason at the top of
// parallel-startup-failure.test.ts: the tooling checks file-level pass/fail,
// and parallel.test.ts has timing-sensitive tests.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import path from "path";

// A worker writes the snapshots of its files when it exits, after it reported
// every test as passed. Two files, so that the run uses the worker pool.
async function runSnapshotFixture(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", CI: "false" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  const summary = stderr
    .split("\n")
    .map(line => line.trim())
    .filter(line => /^\d+ (pass|fail|errors?)$/.test(line));
  return { stderr, summary, exitCode };
}
const passingFile = `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`;

test("--parallel writes new inline snapshots and exits 0", async () => {
  const source = (n: number) =>
    `import {test,expect} from "bun:test"; test("inline",()=>{ expect("value-${n}").toMatchInlineSnapshot(); });`;
  using dir = tempDir("parallel-inline-snapshots", { "a.test.js": source(1), "b.test.js": source(2) });
  const { summary, exitCode } = await runSnapshotFixture(String(dir));
  expect({
    a: await Bun.file(path.join(String(dir), "a.test.js")).text(),
    b: await Bun.file(path.join(String(dir), "b.test.js")).text(),
    summary,
    exitCode,
  }).toEqual({
    a: source(1).replace("toMatchInlineSnapshot()", 'toMatchInlineSnapshot(`"value-1"`)'),
    b: source(2).replace("toMatchInlineSnapshot()", 'toMatchInlineSnapshot(`"value-2"`)'),
    summary: ["2 pass", "0 fail"],
    exitCode: 0,
  });
});

test("--parallel exits 1 when a worker cannot update an inline snapshot", async () => {
  // One call site records two values, so the worker can write neither.
  const source = `import {test,expect} from "bun:test";
test("inline", () => { for (const v of ["one", "two"]) expect(v).toMatchInlineSnapshot(); });`;
  using dir = tempDir("parallel-inline-snapshot-conflict", { "a.test.js": source, "b.test.js": passingFile });
  const { stderr, summary, exitCode } = await runSnapshotFixture(String(dir));
  expect(stderr).toContain(
    "error: Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value",
  );
  expect({ source: await Bun.file(path.join(String(dir), "a.test.js")).text(), summary, exitCode }).toEqual({
    source,
    summary: ["2 pass", "0 fail"],
    exitCode: 1,
  });
});

test("--parallel exits 1 when a worker errors while writing inline snapshots", async () => {
  using dir = tempDir("parallel-inline-snapshot-error", {
    // The test makes its own call site unparseable after the matcher ran, so
    // the write fails as a whole and not with a diagnostic for one snapshot.
    "a.test.js": `import {test,expect} from "bun:test"; import {readFileSync,writeFileSync} from "fs";
test("inline", () => {
  expect("value").toMatchInlineSnapshot();
  writeFileSync(import.meta.path, readFileSync(import.meta.path, "utf8").replace("toMatchInlineSnapshot()", 'toMatchInlineSnapshot("'));
});`,
    "b.test.js": passingFile,
  });
  const { stderr, summary, exitCode } = await runSnapshotFixture(String(dir));
  expect(stderr).toContain("SyntaxError: Failed to write inline snapshots");
  expect({ summary, exitCode }).toEqual({ summary: ["2 pass", "0 fail"], exitCode: 1 });
});

// Linux only: /dev/full can be opened, and every write to it fails, for root too.
test.skipIf(!isLinux)("--parallel exits 1 when a worker cannot write a .snap file", async () => {
  using dir = tempDir("parallel-snap-file-unwritable", {
    "a.test.js": `import {test,expect} from "bun:test"; test("snap",()=>expect("value").toMatchSnapshot());`,
    "b.test.js": passingFile,
    "__snapshots__": {},
  });
  symlinkSync("/dev/full", path.join(String(dir), "__snapshots__", "a.test.js.snap"));
  const { stderr, summary, exitCode } = await runSnapshotFixture(String(dir));
  expect(stderr).toContain("error: Failed to write snapshot file");
  expect({ summary, exitCode }).toEqual({ summary: ["2 pass", "0 fail"], exitCode: 1 });
});
