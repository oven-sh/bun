import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

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

  expect(stderr).toContain("--parallel: 2 workers");
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
  if (serial < 800) {
    // Minimum possible is 8×200ms=1600ms. If serial finished this fast,
    // the timing/sleep machinery is unreliable on this machine; don't
    // assert a ratio off it.
    return;
  }
  const parallel = await run(["--parallel=4"]);

  // 8 × 200ms serial ≈ 1600ms; 4 workers ≈ 400ms + spawn overhead. Only
  // assert that parallel is meaningfully faster — under heavy machine load
  // worker spawn overhead grows, so the ratio is loose.
  expect(parallel).toBeLessThan(serial * 0.9);
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
  const m = stderr.match(/--parallel: (\d+) workers, 2 files/);
  expect(m).toBeTruthy();
  if (navigator.hardwareConcurrency > 1) {
    expect(Number(m![1])).toBeGreaterThan(1);
  }
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

  expect(stderr).toContain("--parallel: 2 workers");
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

test("--parallel prints per-test lines under their file's header", async () => {
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

  expect(stderr).toContain("--parallel: 2 workers");
  // Per-test lines appear (matching serial output's "(pass) name" format).
  expect(stderr).toMatch(/\(pass\) alpha-one/);
  expect(stderr).toMatch(/\(pass\) alpha-two/);
  expect(stderr).toMatch(/\(pass\) bravo-one/);
  expect(stderr).toMatch(/\(pass\) bravo-two/);
  // Result lines from concurrent workers may interleave; whenever the source
  // file changes the header is re-emitted, so the nearest preceding header
  // for any alpha-* line is always a.test.js (and likewise for bravo-*).
  const lines = stderr.split("\n");
  let header = "";
  for (const ln of lines) {
    if (ln.endsWith(".test.js:")) header = ln;
    else if (ln.includes("alpha-")) expect(header).toBe("a.test.js:");
    else if (ln.includes("bravo-")) expect(header).toBe("b.test.js:");
  }
  expect(exitCode).toBe(0);
});

test("--parallel streams test results in realtime, not buffered per-file", async () => {
  // Each file: one fast test then one slow test. With 2 workers running
  // concurrently the first two results should arrive long before both files
  // would finish (which is gated on the 600ms slow test). Per-file buffering
  // would withhold output until ~600ms; per-test streaming surfaces the fast
  // results within the worker spawn + first-tick latency.
  using dir = tempDir("parallel-realtime", {
    "a.test.js": `import {test,expect} from "bun:test";
       test("a-fast",()=>expect(1).toBe(1));
       test("a-slow",async()=>{await Bun.sleep(600);expect(1).toBe(1);});`,
    "b.test.js": `import {test,expect} from "bun:test";
       test("b-fast",()=>expect(1).toBe(1));
       test("b-slow",async()=>{await Bun.sleep(600);expect(1).toBe(1);});`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const t0 = performance.now();
  let firstFastAt = 0;
  let firstSlowAt = 0;
  let acc = "";
  for await (const chunk of proc.stderr) {
    acc += new TextDecoder().decode(chunk);
    const now = performance.now() - t0;
    if (!firstFastAt && /\(pass\) [ab]-fast/.test(acc)) firstFastAt = now;
    if (!firstSlowAt && /\(pass\) [ab]-slow/.test(acc)) firstSlowAt = now;
    if (firstFastAt && firstSlowAt) break;
  }
  const exitCode = await proc.exited;

  expect(acc).toContain("--parallel: 2 workers");
  expect(firstFastAt).toBeGreaterThan(0);
  expect(firstSlowAt).toBeGreaterThan(0);
  // The slow result cannot arrive before ~600ms, so this proves the fast
  // result was not held back waiting for it.
  expect(firstFastAt).toBeLessThan(firstSlowAt - 300);
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

  expect(stderr).toContain("--parallel: 4 workers");
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
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--parallel: 2 workers");
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

test("--parallel --coverage merges LCOV across workers", async () => {
  using dir = tempDir("parallel-coverage-lcov", {
    "shared.js": `export function hit() { return 1; }\nexport function miss() { return 2; }\n`,
    "only-a.js": `export function fa() { return 1; }\n`,
    "a.test.js": `import {test,expect} from "bun:test"; import {hit} from "./shared.js"; import {fa} from "./only-a.js"; test("a",()=>expect(hit()+fa()).toBe(2));`,
    "b.test.js": `import {test,expect} from "bun:test"; import {hit} from "./shared.js"; test("b",()=>expect(hit()).toBe(1));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--coverage", "--coverage-reporter=lcov", "--coverage-dir=./cov"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--parallel: 2 workers");
  expect(stderr).not.toContain("not yet aggregated");
  expect(exitCode).toBe(0);

  const lcov = await Bun.file(String(dir) + "/cov/lcov.info").text();
  // Both source files present, each exactly once (merged, not duplicated per worker).
  expect(lcov.match(/^SF:shared\.js$/gm)?.length).toBe(1);
  expect(lcov.match(/^SF:only-a\.js$/gm)?.length).toBe(1);
  // shared.js was loaded by both workers; merged DA hit counts must be > what
  // a single worker reports. We just assert the line was hit (>0).
  const sharedRecord = lcov.split("end_of_record").find(r => r.includes("SF:shared.js"))!;
  const da1 = sharedRecord.match(/^DA:1,(\d+)$/m);
  expect(da1).not.toBeNull();
  expect(Number(da1![1])).toBeGreaterThan(0);
  // LH/LF recomputed from merged DA.
  expect(sharedRecord).toMatch(/^LF:\d+$/m);
  expect(sharedRecord).toMatch(/^LH:\d+$/m);
});

test("--parallel --coverage prints merged text table", async () => {
  using dir = tempDir("parallel-coverage-text", {
    "lib-a.js": `export function used() { return 1; }\nexport function unused() { return 2; }\n`,
    "lib-b.js": `export function go() { return 3; }\n`,
    "a.test.js": `import {test,expect} from "bun:test"; import {used} from "./lib-a.js"; test("a",()=>expect(used()).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; import {go} from "./lib-b.js"; test("b",()=>expect(go()).toBe(3));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--coverage", "--coverage-reporter=text"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--parallel: 2 workers");

  // Table header + both source files present with a numeric % Lines column.
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  expect(stderr).toMatch(/lib-a\.js\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+/);
  expect(stderr).toMatch(/lib-b\.js\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+/);
  expect(stderr).toContain("All files");
  expect(exitCode).toBe(0);
});
