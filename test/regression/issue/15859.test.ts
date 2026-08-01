import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/15859
//
// Reading `error.stack` before rethrowing caused the uncaught-exception printer
// to show wrong line numbers for non-top frames (double source-mapped) and to
// drop frames without a function name.

const fixture = `import * as i1 from "util";
import * as i2 from "util";
import * as i3 from "util";
function err() {
    throw new Error()
};
function f1(){
    err()
}
function f2(){

}
try {
    f1();
} catch (error: any) {
    let x = error.stack
    throw error
}
`;

test("uncaught exception frames are not double source-mapped after reading error.stack", async () => {
  using dir = tempDir("issue-15859", {
    "test.ts": fixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  // f1's body calls err() on line 8. Before the fix this printed line 13
  // (source-mapped twice).
  expect(stderr).toContain("at f1 ");
  expect(stderr).toMatch(/at f1 \(.*test\.ts:8:5\)/);
  expect(stderr).not.toMatch(/at f1 \(.*test\.ts:13:/);
  // err() throws on line 5; this frame was already correct (top frame).
  expect(stderr).toMatch(/at err \(.*test\.ts:5:/);
  expect(exitCode).toBe(1);
});

test("uncaught exception printer keeps the anonymous top-level frame after reading error.stack", async () => {
  using dir = tempDir("issue-15859-anon", {
    "test.ts": fixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  // The try block calls f1() on line 14 from module scope (no function name).
  // Before the fix this frame was dropped entirely because the .stack string
  // parser could not handle "at <url>:<line>:<col>" frames.
  expect(stderr).toMatch(/at .*test\.ts:14:5/);
  expect(exitCode).toBe(1);
});

test("uncaught exception frames match error.stack after reading it", async () => {
  using dir = tempDir("issue-15859-match", {
    "test.ts": `import * as i1 from "util";
import * as i2 from "util";
import * as i3 from "util";
function err() {
    throw new Error()
};
function f1(){
    err()
}
function f2(){

}
try {
    f1();
} catch (error: any) {
    console.log(error.stack)
    throw error
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const extract = (s: string) => [...s.matchAll(/test\.ts:(\d+):(\d+)/g)].map(m => `${m[1]}:${m[2]}`);

  const stackPositions = extract(stdout);
  const printedPositions = extract(stderr);

  expect(stackPositions.length).toBeGreaterThanOrEqual(3);
  expect(printedPositions).toEqual(stackPositions);
  expect(exitCode).toBe(1);
});
