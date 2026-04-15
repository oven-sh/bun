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

  expect(stderr).toContain("bad.test.js");
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
  expect(stderr).toContain("a.test.js");
  expect(stderr).toContain("b.test.js");
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

test("--parallel prints per-test lines contiguously per file", async () => {
  using dir = tempDir("parallel-output", {
    "a.test.js": `import {test,expect} from "bun:test";
      test("alpha-one",()=>expect(1).toBe(1));
      test("alpha-two",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test";
      test("bravo-one",()=>expect(1).toBe(1));
      test("bravo-two",()=>expect(1).toBe(1));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Per-test lines appear (matching serial output, not just per-file summary).
  expect(stderr).toContain("alpha-one");
  expect(stderr).toContain("alpha-two");
  expect(stderr).toContain("bravo-one");
  expect(stderr).toContain("bravo-two");
  // Tests from one file print contiguously: between alpha-one and alpha-two
  // there is no bravo-* line, regardless of which worker finished first.
  const a1 = stderr.indexOf("alpha-one");
  const a2 = stderr.indexOf("alpha-two");
  const between = stderr.slice(Math.min(a1, a2), Math.max(a1, a2));
  expect(between).not.toContain("bravo-");
  expect(exitCode).toBe(0);
});

test("--parallel aggregates failure summary across workers", async () => {
  // 25+ passes so the end-of-run "N tests failed:" repeat section prints.
  const files: Record<string, string> = {};
  for (let i = 0; i < 24; i++) {
    files[`ok${i}.test.js`] = `import {test,expect} from "bun:test"; test("ok${i}",()=>expect(1).toBe(1));`;
  }
  files["bad.test.js"] = `import {test,expect} from "bun:test"; test("uniquefail",()=>expect(1).toBe(2));`;
  using dir = tempDir("parallel-repeat", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=4"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("24 pass");
  expect(stderr).toContain("1 fail");
  // The repeat-at-end section reprints the failure line (so it appears twice).
  const occurrences = stderr.split("uniquefail").length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(2);
  expect(exitCode).toBe(1);
});

test("--parallel --reporter=junit produces a merged report covering all files", async () => {
  using dir = tempDir("parallel-junit", {
    "a.test.js": `import {test,expect} from "bun:test"; test("ta",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("tb",()=>expect(1).toBe(1));`,
    "c.test.js": `import {test,expect} from "bun:test"; test("tc",()=>expect(1).toBe(2));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--reporter=junit", "--reporter-outfile=out.xml"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(1);

  const xml = await Bun.file(String(dir) + "/out.xml").text();
  expect(xml).toContain('<testsuites name="bun test"');
  expect(xml).toContain("</testsuites>");
  // All three files' suites present.
  expect(xml).toContain("a.test.js");
  expect(xml).toContain("b.test.js");
  expect(xml).toContain("c.test.js");
  // All three test cases present.
  expect(xml).toContain('name="ta"');
  expect(xml).toContain('name="tb"');
  expect(xml).toContain('name="tc"');
  // Exactly one outer testsuites element (not one per worker).
  expect(xml.split("<testsuites ").length - 1).toBe(1);
  expect(xml.split("</testsuites>").length - 1).toBe(1);
});
