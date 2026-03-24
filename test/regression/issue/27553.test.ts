import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("String.raw preserves null bytes in tagged template literals", async () => {
  // Create a source file with a literal null byte (0x00) inside a tagged template literal.
  // The null byte must be an actual byte in the source, not an escape sequence.
  const source = Buffer.concat([
    Buffer.from("const s = String.raw`"),
    Buffer.from([0x00]),
    Buffer.from("`;\nconsole.log(s.length);\nconsole.log(s.charCodeAt(0));\n"),
  ]);

  using dir = tempDir("issue-27553", {
    "test.js": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("1\n0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("null bytes in untagged template literals are preserved", async () => {
  const source = Buffer.concat([
    Buffer.from("const s = `"),
    Buffer.from([0x00]),
    Buffer.from("`;\nconsole.log(s.length);\nconsole.log(s.charCodeAt(0));\n"),
  ]);

  using dir = tempDir("issue-27553-untagged", {
    "test.js": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("1\n0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("null bytes in String.raw with surrounding content", async () => {
  const source = Buffer.concat([
    Buffer.from("const s = String.raw`hello"),
    Buffer.from([0x00]),
    Buffer.from("world`;\nconsole.log(s.length);\nconsole.log(s.charCodeAt(5));\n"),
  ]);

  using dir = tempDir("issue-27553-embedded", {
    "test.js": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("11\n0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
