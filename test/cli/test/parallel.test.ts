import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("--parallel: each worker has a unique JEST_WORKER_ID and BUN_TEST_WORKER_ID", async () => {
  // Sleep so worker 0 is busy when workers 1/2 come online and pick up the
  // remaining files; otherwise one fast worker handles all three.
  const fixture = `import {test} from "bun:test"; test("t", async () => { await Bun.sleep(200); console.log("WID="+process.env.JEST_WORKER_ID+" "+process.env.BUN_TEST_WORKER_ID); });`;
  using dir = tempDir("parallel-worker-id", {
    "a.test.js": fixture,
    "b.test.js": fixture,
    "c.test.js": fixture,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=3"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = stdout + stderr;
  expect(out).not.toContain("WID=undefined");
  // 1-indexed; JEST_WORKER_ID and BUN_TEST_WORKER_ID always match.
  const seen = [...out.matchAll(/WID=(\d+) (\d+)/g)].map(m => {
    expect(m[1]).toBe(m[2]);
    return m[1];
  });
  expect(seen.sort()).toEqual(["1", "2", "3"]);
  expect(exitCode).toBe(0);

  // K<=1 serial-fallback (single file, or --parallel=1) still sets WORKER_ID=1
  // so tests can rely on it whenever --parallel is passed (matches Jest).
  using single = tempDir("parallel-worker-id-single", { "a.test.js": fixture });
  await using p2 = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=5"],
    env: bunEnv,
    cwd: String(single),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [o2, e2, c2] = await Promise.all([p2.stdout.text(), p2.stderr.text(), p2.exited]);
  expect(o2 + e2).toContain("WID=1 1");
  expect(o2 + e2).not.toContain("WID=undefined");
  expect(c2).toBe(0);
});

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

  expect(stdout).toContain("PARALLEL");
  // workers are an implementation detail; output never mentions them
  expect(stderr).not.toContain("worker");
  // every file reported once
  for (const f of ["a.test.js", "b.test.js", "c.test.js", "d.test.js"]) {
    expect(stderr).toContain(f);
  }
  // summary totals are correct regardless of execution order
  expect(stderr).toContain("7 pass");
  expect(stderr).toContain("0 fail");
  expect(stderr).toContain("Ran 7 tests across 4 files.");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"bun test <version> (<revision>) 2x PARALLEL"`);
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // good files still ran and passed
  expect(stderr).toContain("a.test.js");
  expect(stderr).toContain("b.test.js");
  // crashed file was retried then marked failed
  expect(stderr).toContain("crashed running");
  expect(stderr).toContain("boom.test.js");
  expect(stderr).toContain("(crashed:");
  // summary counts the crash as one failure
  expect(stderr).toContain("Ran 3 tests across 3 files.");
  expect(exitCode).toBe(1);
});

// Concurrency is proven deterministically by the lazy-spawn PID-count tests
// below; the timing-based "faster than serial" assertion was load-sensitive
// and removed.

test("--parallel without N is accepted and runs all files", async () => {
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  expect(stderr).toContain("Ran 2 tests across 2 files.");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");

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
  expect(exitCode).toBe(1);
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  expect(stderr).not.toContain("not yet aggregated");

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
  expect(exitCode).toBe(0);
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PARALLEL");
  // Table header + both source files present with a numeric % Lines column.
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  expect(stderr).toMatch(/lib-a\.js\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+/);
  expect(stderr).toMatch(/lib-b\.js\s+\|\s+\d+\.\d+\s+\|\s+\d+\.\d+/);
  expect(stderr).toContain("All files");
  expect(exitCode).toBe(0);
});

test("--parallel --coverage enforces coverageThreshold with lcov-only reporter", async () => {
  using dir = tempDir("parallel-coverage-threshold", {
    "bunfig.toml": `[test]\ncoverageThreshold = 0.9\ncoverageSkipTestFiles = true\n`,
    "lib.js": `export function used() { return 1; }\nexport function unused() { return 2; }\nexport function alsoUnused() { return 3; }\n`,
    "a.test.js": `import {test,expect} from "bun:test"; import {used} from "./lib.js"; test("a",()=>expect(used()).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; import {used} from "./lib.js"; test("b",()=>expect(used()).toBe(1));`,
  });

  for (const reporter of ["lcov", "text"] as const) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--coverage", `--coverage-reporter=${reporter}`, "--coverage-dir=./cov"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PARALLEL");
    expect(stderr).toContain("2 pass");
    // lib.js has 1/3 functions covered → below 0.9 threshold → must fail.
    expect({ reporter, exitCode }).toEqual({ reporter, exitCode: 1 });
  }
});

test("--parallel --dots prints one status character per test", async () => {
  using dir = tempDir("parallel-dots", {
    "a.test.js": `import {test,expect} from "bun:test";
      test("a1",()=>expect(1).toBe(1));
      test("a2",()=>expect(1).toBe(1));
      test.skip("a3",()=>{});
      test("a4",()=>expect(1).toBe(2));`,
    "b.test.js": `import {test,expect} from "bun:test";
      test("b1",()=>expect(1).toBe(1));
      test("b2",()=>expect(1).toBe(1));
      test("b3",()=>expect(1).toBe(1));
      test("b4",()=>expect(1).toBe(1));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--dots"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // No file headers in dots mode.
  expect(stderr).not.toContain(".test.js:");
  // 7 dots (6 pass + 1 skip), no per-test "(pass) name" lines for them.
  expect(stderr.match(/\./g)!.length).toBeGreaterThanOrEqual(7);
  expect(stderr).not.toMatch(/\(pass\)/);
  // The fail prints a full status line.
  expect(stderr).toContain("a4");
  expect(stderr).toContain("6 pass");
  expect(stderr).toContain("1 skip");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

test("--parallel never interleaves console output across files", async () => {
  // Two files, each test logs a marker then sleeps so the other worker has
  // time to also log. Buffered-per-test flush means a MARK line is always
  // immediately followed by its own (pass) line, never another file's MARK.
  const body = (tag: string) =>
    `import {test,expect} from "bun:test"; import {appendFileSync} from "fs";
     for (let i=0;i<3;i++) test("${tag}"+i, async()=>{ appendFileSync(process.env.PIDS, process.pid+"\\n"); console.error("MARK-${tag}-"+i); await Bun.sleep(300); expect(1).toBe(1); });`;
  using dir = tempDir("parallel-no-interleave", { "a.test.js": body("a"), "b.test.js": body("b") });
  const pids = String(dir) + "/pids.txt";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, PIDS: pids, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Serial execution would trivially avoid interleaving; assert the two files
  // actually ran in different processes so the test proves something.
  expect(new Set((await Bun.file(pids).text()).trim().split("\n")).size).toBe(2);

  for (let i = 0; i < 3; i++) {
    expect(stderr).toContain(`MARK-a-${i}`);
    expect(stderr).toContain(`MARK-b-${i}`);
  }
  // Any line immediately after a MARK-a-* line is either an a-file header,
  // an a-test (pass) line, or another MARK-a — never b's content.
  const lines = stderr.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("MARK-a-")) {
      expect(lines[i + 1].startsWith("MARK-b-")).toBe(false);
    }
    if (lines[i].startsWith("MARK-b-")) {
      expect(lines[i + 1].startsWith("MARK-a-")).toBe(false);
    }
  }
  expect(stderr).toContain("6 pass");
  expect(exitCode).toBe(0);
});

test("--parallel lazily scales workers based on file duration", async () => {
  // Each test file appends its PID so we can count distinct worker processes.
  const body = (sleepMs: number) =>
    `import {test,expect} from "bun:test"; import {appendFileSync} from "fs";
     test("t", async()=>{ appendFileSync(process.env.PIDS, process.pid+"\\n"); await Bun.sleep(${sleepMs}); expect(1).toBe(1); });`;
  const fixture = (sleepMs: number) => ({
    "a.test.js": body(sleepMs),
    "b.test.js": body(sleepMs),
    "c.test.js": body(sleepMs),
    "d.test.js": body(sleepMs),
  });
  const run = async (dir: string, scaleMs: number) => {
    const pids = dir + "/pids.txt";
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=4"],
      env: { ...bunEnv, PIDS: pids, BUN_TEST_PARALLEL_SCALE_MS: String(scaleMs) },
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode, pids: new Set((await Bun.file(pids).text()).trim().split("\n")) };
  };

  // Fast: 4 files × 0ms with a 250ms threshold. Each file (load + run +
  // isolation swap) finishes within the threshold, so the coordinator never
  // spawns a second worker. The threshold is raised from the production 5ms
  // because debug-build module load alone exceeds 5ms.
  {
    using dir = tempDir("parallel-lazy-fast", fixture(0));
    const r = await run(String(dir), 250);
    expect(r.stderr).toContain("4 pass");
    expect(r.pids.size).toBe(1);
    expect(r.exitCode).toBe(0);
  }

  // Slow: 4 files × 200ms with a 50ms threshold. The first file exceeds the
  // threshold so the coordinator spawns the remaining workers; multiple PIDs
  // appear. The exact count depends on whether the first worker finishes its
  // file before the newly-spawned workers report ready, so we only assert
  // that scale-up happened at all — the differential against the fast case
  // (which stays at exactly 1) is the proof.
  {
    using dir = tempDir("parallel-lazy-slow", fixture(200));
    const r = await run(String(dir), 50);
    expect(r.stderr).toContain("4 pass");
    expect(r.pids.size).toBeGreaterThanOrEqual(2);
    expect(r.exitCode).toBe(0);
  }
});

test("--parallel partitions by directory and steals from the end", async () => {
  // 4 dirs × 4 files, slow enough that scale-up fires before any worker
  // exhausts its own chunk. With K=4 each worker's initial chunk is one
  // directory; the assertion is that each directory's first-dispatched file
  // ran on a distinct PID (i.e. files were not round-robined across workers).
  const body = `import {test,expect} from "bun:test"; import {appendFileSync} from "fs";
    test("t", async () => {
      appendFileSync(process.env.LOG, JSON.stringify({pid: process.pid, file: import.meta.path}) + "\\n");
      await Bun.sleep(150);
      expect(1).toBe(1);
    });`;
  const files: Record<string, string> = {};
  for (const d of ["a", "b", "c", "d"]) for (let i = 0; i < 4; i++) files[`${d}/${d}${i}.test.js`] = body;
  using dir = tempDir("parallel-affinity", files);
  const log = String(dir) + "/log.ndjson";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=4"],
    env: { ...bunEnv, LOG: log, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  expect(stderr).toContain("16 pass");

  type Row = { pid: number; file: string };
  const rows: Row[] = (await Bun.file(log).text())
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  const dirOf = (r: Row) => r.file.replaceAll("\\", "/").split("/").slice(-2, -1)[0]!;
  const byPid = new Map<number, Row[]>();
  for (const r of rows) (byPid.get(r.pid) ?? byPid.set(r.pid, []).get(r.pid)!).push(r);

  // Each worker's first file is from a distinct directory (range partitioning,
  // not round-robin). With the old single-queue model, the first 4 dispatches
  // would all be a/ files (one per worker) so this set would have size 1.
  const firstDirs = new Set([...byPid.values()].map(runs => dirOf(runs[0]!)));
  expect(firstDirs.size).toBe(byPid.size);
  expect(exitCode).toBe(0);
});

test("--parallel work-stealing balances an uneven directory split", async () => {
  // 8 slow files under a/, 1 fast file each under b/, c/, d/. Sorted indices:
  // a0..a7, b0, c0, d0. With K=4 the ranges are [0,2),[2,5),[5,8),[8,11), so
  // worker 3 owns the three fast files and finishes first. It then steals
  // from the back of the largest a-range. Assertions: all 11 complete, and the
  // PID that ran d/ also ran at least one a/ file (the steal).
  const slow = `import {test,expect} from "bun:test"; import {appendFileSync} from "fs";
    test("t", async () => { appendFileSync(process.env.LOG, JSON.stringify({pid: process.pid, file: import.meta.path}) + "\\n"); await Bun.sleep(250); expect(1).toBe(1); });`;
  const fast = `import {test,expect} from "bun:test"; import {appendFileSync} from "fs";
    test("t", () => { appendFileSync(process.env.LOG, JSON.stringify({pid: process.pid, file: import.meta.path}) + "\\n"); expect(1).toBe(1); });`;
  const files: Record<string, string> = {};
  for (let i = 0; i < 8; i++) files[`a/a${i}.test.js`] = slow;
  files["b/b0.test.js"] = fast;
  files["c/c0.test.js"] = fast;
  files["d/d0.test.js"] = fast;
  using dir = tempDir("parallel-steal", files);
  const log = String(dir) + "/log.ndjson";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=4"],
    env: { ...bunEnv, LOG: log, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  expect(stderr).toContain("11 pass");
  expect(stderr).toContain("0 fail");

  type Row = { pid: number; file: string };
  const rows: Row[] = (await Bun.file(log).text())
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  // The PID that ran b0/c0/d0 (worker 3's chunk) must also appear on at least
  // one a/ file — that's the steal.
  const norm = (s: string) => s.replaceAll("\\", "/");
  const fastPid = rows.find(r => norm(r.file).includes("/d/"))!.pid;
  const aRows = rows.filter(r => norm(r.file).includes("/a/"));
  expect(aRows.length).toBe(8);
  expect(aRows.some(r => r.pid === fastPid)).toBe(true);
  expect(exitCode).toBe(0);
});

test("--parallel writes new snapshots from every worker", async () => {
  const body = (n: number) =>
    `import {test,expect} from "bun:test"; test("snap",()=>expect("value-${n}").toMatchSnapshot());`;
  using dir = tempDir("parallel-snapshots", {
    "a.test.js": body(1),
    "b.test.js": body(2),
    "c.test.js": body(3),
    "d.test.js": body(4),
  });

  // First run creates snapshots; with 4 workers each worker's only file is its
  // last file, so this exercises the explicit flush before worker exit.
  await using first = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=4", "--update-snapshots"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", CI: "false" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout1, stderr1, code1] = await Promise.all([first.stdout.text(), first.stderr.text(), first.exited]);
  expect(stdout1).toContain("PARALLEL");
  expect(stderr1).toContain("4 pass");
  expect(code1).toBe(0);

  for (const f of ["a", "b", "c", "d"]) {
    const snap = `${dir}/__snapshots__/${f}.test.js.snap`;
    expect(await Bun.file(snap).exists()).toBe(true);
  }

  // Second run must pass against the snapshots written by the first.
  await using second = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=4"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", CI: "false" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout2, stderr2, code2] = await Promise.all([second.stdout.text(), second.stderr.text(), second.exited]);
  expect(stdout2).toContain("PARALLEL");
  expect(stderr2).toContain("4 pass");
  expect(stderr2).toContain("0 fail");
  expect(code2).toBe(0);
});

test("--parallel: a test producing a >64MB result line is truncated, not treated as a crash", async () => {
  // Test name just over the 64MB IPC frame limit → the per-test status line
  // itself exceeds it. The encoder must truncate so the receiver doesn't drop
  // the channel and mark the whole file as crashed.
  using dir = tempDir("parallel-huge-frame", {
    "huge.test.js": `import {test,expect} from "bun:test"; test("X".repeat(68_000_000),()=>expect(1).toBe(2));`,
    "ok.test.js": `import {test,expect} from "bun:test"; test("ok",()=>expect(1).toBe(1));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const result = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]),
    Bun.sleep(60000).then(() => "TIMEOUT" as const),
  ]);
  expect(result).not.toBe("TIMEOUT");
  const [stdout, stderr, exitCode] = result as [string, string, number];
  expect(stdout).toContain("PARALLEL");
  // The huge test failed normally (not "crashed"), the truncation marker is
  // present, and ok.test.js's pass survived on the other worker.
  expect(stderr).not.toContain("crashed");
  expect(stderr).toContain("[output truncated:");
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
}, 90_000);

test("--parallel: a test writing garbage to fd 3 does not hang the coordinator", async () => {
  using dir = tempDir("parallel-hostile-fd3", {
    "ok.test.js": `import {test,expect} from "bun:test"; test("ok",()=>expect(1).toBe(1));`,
    "bad.test.js": `import {test} from "bun:test"; import {writeSync} from "fs";
      test("bad",()=>{ writeSync(3, Buffer.from([0xff,0xff,0xff,0xff,0x42])); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const result = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]),
    Bun.sleep(15000).then(() => "TIMEOUT" as const),
  ]);
  expect(result).not.toBe("TIMEOUT");
  const [stdout, stderr, exitCode] = result as [string, string, number];
  expect(stdout).toContain("PARALLEL");
  // ok.test.js's pass survives; bad.test.js's worker is treated as crashed once
  // its IPC pipe is dropped, then retried. We don't assert exact counts (the
  // retry may also corrupt fd 3) — only that the run completes deterministically.
  expect(stderr).toContain("Ran ");
  expect([0, 1]).toContain(exitCode);
});

test("--parallel --randomize without --seed is reproducible via the printed seed", async () => {
  const mk = (tag: string) =>
    `import {test,expect} from "bun:test";\n` +
    "abcdefgh"
      .split("")
      .map(n => `test("${n}",()=>{console.error("ORDER:${tag}:${n}");expect(1).toBe(1);});`)
      .join("\n");
  using dir = tempDir("parallel-randomize-seed", { "a.test.ts": mk("a"), "b.test.ts": mk("b") });

  const run = async (extra: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--randomize", ...extra, "./a.test.ts", "./b.test.ts"],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PARALLEL");
    expect(stderr).toContain("16 pass");
    expect(exitCode).toBe(0);
    const order = (tag: string) => [...stderr.matchAll(new RegExp(`ORDER:${tag}:(\\w)`, "g"))].map(m => m[1]).join("");
    const seed = stderr.match(/--seed=(\d+)/)?.[1];
    return { stderr, a: order("a"), b: order("b"), seed };
  };

  const first = await run([]);
  expect(first.seed).toBeDefined();
  expect(first.a.length).toBe(8);
  expect(first.b.length).toBe(8);

  const second = await run([`--seed=${first.seed}`]);
  // Within-file ordering must match exactly when the printed seed is replayed.
  expect({ a: second.a, b: second.b }).toEqual({ a: first.a, b: first.b });
});

test("--parallel forwards --conditions to workers", async () => {
  using dir = tempDir("parallel-conditions", {
    "node_modules/condpkg/package.json": JSON.stringify({
      name: "condpkg",
      exports: { ".": { development: "./dev.js", default: "./prod.js" } },
    }),
    "node_modules/condpkg/dev.js": `export const variant = "dev";`,
    "node_modules/condpkg/prod.js": `export const variant = "prod";`,
    "a.test.ts": `import {test,expect} from "bun:test"; import {variant} from "condpkg"; test("a",()=>expect(variant).toBe("dev"));`,
    "b.test.ts": `import {test,expect} from "bun:test"; import {variant} from "condpkg"; test("b",()=>expect(variant).toBe("dev"));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--conditions=development"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--parallel --reporter=junit emits a synthetic suite for crashed files", async () => {
  using dir = tempDir("parallel-junit-crash", {
    "ok.test.js": `import {test,expect} from "bun:test"; test("ok",()=>expect(1).toBe(1));`,
    "crash.test.js": `import {test} from "bun:test"; test("boom",()=>process.kill(process.pid, "SIGKILL"));`,
  });
  const out = String(dir) + "/out.xml";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--reporter=junit", `--reporter-outfile=${out}`],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).not.toBe(0);
  const xml = await Bun.file(out).text();

  // The crashed file gets a synthetic suite so outer totals == sum of children.
  expect(xml).toContain('<testsuite name="crash.test.js"');
  expect(xml).toContain("worker process crashed before reporting results");

  const outerTests = Number(xml.match(/<testsuites[^>]*\btests="(\d+)"/)![1]);
  const outerFail = Number(xml.match(/<testsuites[^>]*\bfailures="(\d+)"/)![1]);
  const innerTests = [...xml.matchAll(/<testsuite [^>]*\btests="(\d+)"/g)].reduce((a, m) => a + Number(m[1]), 0);
  const innerFail = [...xml.matchAll(/<testsuite [^>]*\bfailures="(\d+)"/g)].reduce((a, m) => a + Number(m[1]), 0);
  expect({ innerTests, innerFail }).toEqual({ innerTests: outerTests, innerFail: outerFail });
});

test("--parallel: SIGTERM on coordinator kills workers and their grandchildren", async () => {
  const grandchild = `
    require("fs").appendFileSync(process.env.PIDS, "grandchild=" + process.pid + "\\n");
    setTimeout(() => {}, 8000);
  `;
  const fixture = `
    import { test } from "bun:test";
    import { appendFileSync } from "fs";
    test("slow", async () => {
      const child = Bun.spawn({
        cmd: [process.execPath, "grandchild.cjs"],
        env: process.env,
        stdout: "ignore",
        stderr: "ignore",
      });
      appendFileSync(process.env.PIDS, "worker=" + process.pid + "\\n");
      appendFileSync(process.env.PIDS, "spawned=" + child.pid + "\\n");
      await Bun.sleep(60000);
    });
  `;
  using dir = tempDir("parallel-deathsig", {
    "a.test.ts": fixture,
    "b.test.ts": fixture,
    "grandchild.cjs": grandchild,
  });
  const pids = String(dir) + "/pids.txt";

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=0"],
    env: { ...bunEnv, PIDS: pids },
    cwd: String(dir),
    stdout: "ignore",
    stderr: "ignore",
  });

  // Wait for both workers and both grandchildren to log their PIDs.
  const wanted = (re: RegExp, n: number) =>
    (
      Bun.file(pids)
        .text()
        .catch(() => "") as Promise<string>
    ).then(t => [...t.matchAll(re)].length >= n);
  for (let i = 0; i < 200; i++) {
    if ((await wanted(/^worker=/gm, 2)) && (await wanted(/^grandchild=/gm, 2))) break;
    await Bun.sleep(25);
  }
  const log = await Bun.file(pids).text();
  const workers = [...log.matchAll(/^worker=(\d+)/gm)].map(m => Number(m[1]));
  const grandchildren = [...log.matchAll(/^grandchild=(\d+)/gm)].map(m => Number(m[1]));
  expect(workers.length).toBeGreaterThanOrEqual(2);
  expect(grandchildren.length).toBeGreaterThanOrEqual(2);

  proc.kill("SIGTERM");
  await proc.exited;

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // The coordinator's signal handler kills each worker's process group, so
  // workers and grandchildren should both be gone. Allow a short window for
  // signal delivery.
  let outstanding: number[] = [];
  for (let i = 0; i < 100; i++) {
    outstanding = [...workers, ...grandchildren].filter(alive);
    if (outstanding.length === 0) break;
    await Bun.sleep(25);
  }
  // Clean up survivors so a failing run doesn't leak processes.
  for (const pid of outstanding)
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  expect(outstanding).toEqual([]);
}, 15000);
