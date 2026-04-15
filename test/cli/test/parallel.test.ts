import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";

test("--parallel runs files across workers and aggregates totals", async () => {
  using dir = tempDir("parallel-basic", {
    "a.test.js": `import {test,expect} from "bun:test"; test("a1",()=>expect(1).toBe(1)); test("a2",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b1",()=>expect(1).toBe(1));`,
    "c.test.js": `import {test,expect} from "bun:test"; test("c1",()=>expect(1).toBe(1)); test("c2",()=>expect(1).toBe(1)); test("c3",()=>expect(1).toBe(1));`,
    "d.test.js": `import {test,expect} from "bun:test"; test("d1",()=>expect(1).toBe(1));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("--parallel: 2 workers, 4 files");
  // every file reported once
  for (const f of ["a.test.js", "b.test.js", "c.test.js", "d.test.js"]) {
    expect(stderr).toContain(f);
  }
  // summary totals are correct regardless of execution order
  expect(stderr).toContain("7 pass");
  expect(stderr).toContain("0 fail");
  expect(stderr).toContain("Ran 7 tests across 4 files.");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
  expect(exitCode).toBe(0);
});

test("--parallel surfaces failures and exits non-zero", async () => {
  using dir = tempDir("parallel-fail", {
    "ok.test.js": `import {test,expect} from "bun:test"; test("ok",()=>expect(1).toBe(1));`,
    "bad.test.js": `import {test,expect} from "bun:test"; test("bad",()=>expect(1).toBe(2));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("✗ bad.test.js");
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

test("--parallel re-queues a file when its worker crashes mid-run", async () => {
  using dir = tempDir("parallel-crash", {
    "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
    "boom.test.js": `import {test} from "bun:test"; test("boom",()=>process.exit(7));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // good files still ran and passed
  expect(stderr).toContain("✓ a.test.js");
  expect(stderr).toContain("✓ b.test.js");
  // crashed file was retried then marked failed
  expect(stderr).toContain("crashed running");
  expect(stderr).toContain("boom.test.js");
  expect(stderr).toContain("worker crashed");
  // summary counts the crash as one failure
  expect(stderr).toContain("Ran 3 tests across 3 files.");
  expect(exitCode).toBe(1);
});

test("--parallel is faster than serial for sleep-bound files", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 8; i++) {
    files[`f${i}.test.js`] =
      `import {test,expect} from "bun:test"; test("s", async()=>{await Bun.sleep(200);expect(1).toBe(1);});`;
  }
  using dir = tempDir("parallel-perf", files);

  const run = async (extra: string[]) => {
    const t0 = performance.now();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...extra],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, , code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(code).toBe(0);
    return performance.now() - t0;
  };

  const serial = await run([]);
  const parallel = await run(["--parallel=4"]);

  // 8 × 200ms serial ≈ 1600ms; 4 workers ≈ 400ms + spawn overhead.
  // We only assert parallel is meaningfully faster, not an exact ratio.
  expect(parallel).toBeLessThan(serial * 0.75);
});

test("--parallel without N defaults to >1 workers", async () => {
  using dir = tempDir("parallel-default", {
    "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toMatch(/--parallel: \d+ workers, 2 files/);
  expect(exitCode).toBe(0);
});

test("--isolate-recycle-after does not report recycles as crashes", async () => {
  using dir = tempDir("parallel-recycle", {
    "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
    "c.test.js": `import {test,expect} from "bun:test"; test("c",()=>expect(1).toBe(1));`,
    "d.test.js": `import {test,expect} from "bun:test"; test("d",()=>expect(1).toBe(1));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--isolate-recycle-after=1"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("crashed");
  expect(stderr).toContain("4 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--parallel forwards -t to workers", async () => {
  using dir = tempDir("parallel-filter", {
    "a.test.js": `import {test,expect} from "bun:test"; test("keep_a",()=>expect(1).toBe(1)); test("drop_a",()=>expect(1).toBe(2));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("drop_b",()=>expect(1).toBe(2));`,
    "c.test.js": `import {test,expect} from "bun:test"; test("keep_c",()=>expect(1).toBe(1));`,
    "d.test.js": `import {test,expect} from "bun:test"; test("drop_d",()=>expect(1).toBe(2));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "-t", "keep"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("--parallel: 2 workers, 4 files");
  // Only keep_a and keep_c run; drop_* tests would fail if executed.
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--parallel --bail stops dispatching new files after threshold", async () => {
  // Every file fails, so whichever two the Scanner hands out first will
  // trigger bail before any third file is dispatched. Order-independent.
  const files: Record<string, string> = {};
  for (const f of ["a", "b", "c", "d", "e", "f"]) {
    files[`${f}.test.js`] = `import {test,expect} from "bun:test"; test("${f}",()=>expect(1).toBe(2));`;
  }
  using dir = tempDir("parallel-bail", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--bail=1"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("--parallel: 2 workers, 6 files");
  expect(stderr).toContain("Bailed out after 1 failure");
  // At most the two initially-dispatched files ran; the other four never did.
  const m = stderr.match(/across (\d+) files?\./);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBeLessThanOrEqual(2);
  expect(exitCode).toBe(1);
});
