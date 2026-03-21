// Diagnostic test to narrow down where bytecode compilation hangs on Linux CI.
// Each step is a separate test so we can see exactly which one fails.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const entry = `console.log("Hello, world!");`;

test("1. bun build (no bytecode, no compile)", async () => {
  using dir = tempDir("bytecode-diag-1", {
    "entry.ts": entry,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--outfile=out.js", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode) throw new Error(`signal=${proc.signalCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  expect(stderr).toBe("");
  expect(code).toBe(0);
});

test("2. bun build --bytecode (no compile)", async () => {
  using dir = tempDir("bytecode-diag-2", {
    "entry.ts": entry,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--bytecode", "--outdir=out", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode) throw new Error(`signal=${proc.signalCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  expect(stderr).toBe("");
  expect(code).toBe(0);
});

test("3. bun build --compile (no bytecode)", async () => {
  using dir = tempDir("bytecode-diag-3", {
    "entry.ts": entry,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--compile", "--outfile=out", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode) throw new Error(`signal=${proc.signalCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  expect(code).toBe(0);
});

test("4. bun build --compile --bytecode (both)", async () => {
  using dir = tempDir("bytecode-diag-4", {
    "entry.ts": entry,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--compile", "--bytecode", "--outfile=out", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode) throw new Error(`signal=${proc.signalCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  expect(code).toBe(0);
});

test("5. run the compiled --bytecode binary", async () => {
  using dir = tempDir("bytecode-diag-5", {
    "entry.ts": entry,
  });
  // Build
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--compile", "--bytecode", "--outfile=out", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
      timeout: 60_000,
    });
    const code = await proc.exited;
    if (proc.signalCode || code !== 0) {
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
      throw new Error(`build failed signal=${proc.signalCode} code=${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    }
  }
  // Run
  await using proc = Bun.spawn({
    cmd: [join(String(dir), "out")],
    env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode) {
    throw new Error(`run: signal=${proc.signalCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  }
  expect(stdout).toContain("Hello, world!");
  expect(stderr).toContain("Cache hit");
  expect(code).toBe(0);
});

// Concurrent compile tests — if these hang but the sequential ones above pass,
// the issue is a concurrency/resource-exhaustion regression in --compile.
describe.concurrent("concurrent compile", () => {
  for (let i = 0; i < 10; i++) {
    test(`6.${i} bun build --compile --bytecode (concurrent)`, async () => {
      using dir = tempDir(`bytecode-diag-concurrent-${i}`, {
        "entry.ts": entry,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--target=bun",
          "--format=cjs",
          "--compile",
          "--bytecode",
          "--outfile=out",
          "entry.ts",
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
        timeout: 60_000,
      });
      const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (proc.signalCode || code !== 0) {
        throw new Error(
          `signal=${proc.signalCode} code=${code}\n` +
            `STDOUT: ${stdout.slice(0, 2000)}\n` +
            `STDERR: ${stderr.slice(0, 2000)}`,
        );
      }
      expect(code).toBe(0);
    });
  }
});
