// https://github.com/oven-sh/bun/issues/23275
// UTF-8 BOM in bunfig.toml should not cause parsing errors

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bunfig.toml with UTF-8 BOM should parse correctly", async () => {
  // UTF-8 BOM is the byte sequence: 0xEF 0xBB 0xBF
  const utf8BOM = "\uFEFF";

  using dir = tempDir("bunfig-bom", {
    "bunfig.toml":
      utf8BOM +
      `
[install]
exact = true
`,
    "index.ts": `console.log("test");`,
    "package.json": JSON.stringify({
      name: "test-bom",
      version: "1.0.0",
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not have the "Unexpected" error that was reported in the issue
  expect(stderr).not.toContain("Unexpected");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("test");
  expect(exitCode).toBe(0);
});

test("bunfig.toml without BOM should still work", async () => {
  using dir = tempDir("bunfig-no-bom", {
    "bunfig.toml": `
[install]
exact = true
`,
    "index.ts": `console.log("test");`,
    "package.json": JSON.stringify({
      name: "test-no-bom",
      version: "1.0.0",
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unexpected");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("test");
  expect(exitCode).toBe(0);
});

test("bunfig.toml with BOM and actual content should parse the content correctly", async () => {
  const utf8BOM = "\uFEFF";

  using dir = tempDir("bunfig-bom-content", {
    "bunfig.toml":
      utf8BOM +
      `
logLevel = "debug"

[install]
production = true
`,
    "index.ts": `console.log("hello");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("hello");
  expect(stderr).not.toContain("Unexpected");
  expect(exitCode).toBe(0);
});
