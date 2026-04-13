// https://github.com/oven-sh/bun/issues/29243
//
// Bun was rejecting unreachable top-level `await` at parse time when
// targeting a non-ESM output format. esbuild parses the `await`, lets DCE
// drop the unreachable branch, and only then reports the CJS / TLA
// incompatibility. This test locks in the same behaviour for `bun build`.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --format=cjs drops an unreachable top-level await before reporting TLA", async () => {
  using dir = tempDir("issue-29243-dead-tla", {
    "entry.js": `if (typeof TEST === "undefined" ? false : TEST) {
  await import("node:fs");
}
foo();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--minify", "--format=cjs", "--define", "TEST=false"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("foo();\n");
  expect(exitCode).toBe(0);
});

test("bun build --format=cjs still rejects a live top-level await", async () => {
  using dir = tempDir("issue-29243-live-tla", {
    "entry.js": `await import("node:fs");
foo();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`Top-level await is currently not supported with the "cjs" output format`);
  expect(exitCode).not.toBe(0);
});

test("await can still be used as an identifier at module scope in CJS output", async () => {
  using dir = tempDir("issue-29243-await-ident", {
    "entry.js": `var await = 42;
globalThis.output = await;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("var await = 42");
  expect(stdout).toContain("globalThis.output = await");
  expect(exitCode).toBe(0);
});

test("await inside a non-async function nested in a CJS file still reports a useful error", async () => {
  using dir = tempDir("issue-29243-nested-await", {
    "entry.js": `function notAsync() {
  await something();
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`"await" can only be used inside an "async" function`);
  expect(exitCode).not.toBe(0);
});
