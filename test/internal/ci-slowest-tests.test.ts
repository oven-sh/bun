import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isPhaseGroupHeader } from "../../scripts/ci-log-phase.mjs";
import { parseLog } from "../../scripts/ci-slowest-tests";
import { entryOfProgram, parseLog as parseDurations } from "../../scripts/update-test-durations.mjs";

// Buildkite prefixes each line with an APC timestamp: ESC `_bk;t=<ms>` BEL.
const bk = (ts: number, body: string) => `\x1b_bk;t=${ts}\x07${body}`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

describe("scripts/ci-slowest-tests.ts parseLog", () => {
  test("does not charge the parallel-safe phase to the last serial test", () => {
    // runner.node.ts prints serial headers via startGroup (`--- [N/M] path`)
    // and parallel-safe headers via plain console.log (`[N/M] path`). A regex
    // that insists on `--- ` treats the first parallel header as invisible and
    // the last serial test swallows the whole phase (79.5s observed for a
    // 4.8s test on build #79247).
    const log = [
      bk(1000, `--- ${gray("[1/6]")} test/a.test.ts`),
      bk(2000, "Ran 1 test across 1 file."),
      bk(2000, `--- ${gray("[2/6]")} test/last-serial.test.ts`),
      bk(6800, "Ran 1 test across 1 file."),
      bk(6800, `--- Running 3 parallel-safe tests (4-wide)`),
      bk(6801, `${gray("[3/6]")} test/js/node/test/parallel/p1.js`),
      bk(6803, `${gray("[4/6]")} test/js/node/test/parallel/p2.js`),
      bk(6810, `${gray("[5/6]")} test/js/node/test/parallel/p3.js`),
      bk(86800, `--- ${gray("[6/6]")} vendor/x/package.json`),
      bk(87000, `--- End`),
    ].join("\r\r\n");

    const out = parseLog(log);
    expect(out.get("test/last-serial.test.ts")).toBe(4800);
    // p3 is the last dispatch before an 80s tail; header-gap timing would
    // charge it 79_990 ms. Parallel-safe spans are clamped.
    expect(out.get("test/js/node/test/parallel/p3.js")).toBe(500);
    expect(out.get("test/a.test.ts")).toBe(1000);
    expect(out.get("vendor/x/package.json")).toBe(200);
  });

  test("sums retry attempts and normalizes Windows path separators", () => {
    const log = [
      bk(0, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts`),
      bk(3000, `--- \x1b[33m[1/2] test\\cli\\install\\flaky.test.ts - code 1\x1b[0m`),
      bk(10000, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts ${gray("[attempt #2]")}`),
      bk(14000, `--- ${gray("[2/2]")} test\\next.test.ts`),
      bk(15000, `--- End`),
    ].join("\n");

    const out = parseLog(log);
    // First attempt 3s + second attempt 4s; the retry backoff between the
    // failure label and attempt #2 is not the test's wall clock.
    expect(out.get("test/cli/install/flaky.test.ts")).toBe(7000);
    expect(out.get("test/next.test.ts")).toBe(1000);
  });

  test("closes the last serial test at the parallel-phase group header when no parallel headers follow", () => {
    // Shard with zero parallel-safe tests: the group header never prints, but
    // `--- End` still terminates the open span.
    const noParallel = [bk(100, `--- ${gray("[1/1]")} test/only.test.ts`), bk(900, `--- End`)].join("\n");
    expect(parseLog(noParallel).get("test/only.test.ts")).toBe(800);

    // Shard where the parallel phase prints its group header but (e.g. via a
    // filter) runs nothing: the open serial span must close there, not at the
    // next `[N/M]` header an arbitrary distance later.
    const emptyParallel = [
      bk(100, `--- ${gray("[1/2]")} test/last.test.ts`),
      bk(1100, `--- Running 0 parallel-safe tests (4-wide)`),
      bk(60000, `--- ${gray("[2/2]")} vendor/x/package.json`),
      bk(60100, `--- End`),
    ].join("\n");
    expect(parseLog(emptyParallel).get("test/last.test.ts")).toBe(1000);

    // Job killed mid-run: no `--- End`. The still-open span (usually the test
    // that caused the timeout) is charged to the last timestamp seen rather
    // than dropped, since it is exactly the file a slow-test report should
    // surface.
    const truncated = [
      bk(100, `--- ${gray("[1/2]")} test/fast.test.ts`),
      bk(300, `--- ${gray("[2/2]")} test/hung.test.ts`),
      bk(400, "bun test v1.4.0"),
      bk(600300, "still running..."),
    ].join("\n");
    expect(Object.fromEntries(parseLog(truncated))).toEqual({
      "test/fast.test.ts": 200,
      "test/hung.test.ts": 600000,
    });
  });

  test("does not charge the parallel-bucket phase to the preceding serial test", () => {
    // runParallelBucket opens a `--- [A-B/M] K files in parallel` group (not a
    // `[N/M]` header), runs one `bun test --parallel`, then prints a summary
    // `[N/M] <path> (X.XXs)` per file. The summary's inline timing is the only
    // usable per-file number; the APC timestamps on those lines are all the
    // moment the summary flushed. `--- napi prebuild: ...` is another
    // non-[N/M] startGroup that precedes the bucket on shards with native
    // addons.
    const log = [
      bk(0, `--- ${gray("[1/8]")} test/before.test.ts`),
      bk(61, `--- napi prebuild: 3 addon(s), 23.9s`),
      bk(61, `prebuild: 3 built`),
      bk(24000, `--- ${gray("[2-5/8]")} 4 files in parallel (3\u00d7)`),
      bk(24010, `bun test v1.4.0 3\u00d7 PARALLEL`),
      bk(83500, Buffer.alloc(50, ".").toString()),
      bk(84000, `${gray("[2/8]")} test/b.test.ts ${gray("(0.50s)")}`),
      bk(84000, `${gray("[3/8]")} test/c.test.ts ${gray("(1.25s)")}`),
      bk(84000, `${gray("[4/8]")} test/d.test.ts ${gray("(0.01s)")}`),
      bk(84001, `parallel bucket: retrying 1 failed file(s) one at a time`),
      bk(84010, `--- ${gray("[5/8]")} test/e.test.ts`),
      bk(84210, `--- ${gray("[6/8]")} test/after.test.ts`),
      bk(84310, `--- End`),
    ].join("\r\r\n");

    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/before.test.ts": 61,
      "test/b.test.ts": 500,
      "test/c.test.ts": 1250,
      "test/d.test.ts": 10,
      "test/e.test.ts": 200,
      "test/after.test.ts": 100,
    });
  });

  test("ignores stray `--- ` lines that are test output, not group headers", () => {
    // pipeTestStdout in runner.node.ts sanitises `--- ` in streamed test
    // output, but a chunk boundary can split the token and the coordinator/
    // retry-preview paths write raw. Seen in build #86086: a `bun patch` diff
    // inside `test/cli/install/bun-patch.test.ts`'s span and `--- ps ---`
    // from test/docker/index.ts inside the `test/package.json` span.
    const log = [
      bk(100, `--- ${gray("[1/3]")} test/package.json`),
      bk(150, `--- ps ---`),
      bk(160, `--- logs ---`),
      bk(1000, `--- ${gray("[2/3]")} test/cli/install/bun-patch.test.ts`),
      bk(1500, `diff --git a/index.js b/index.js`),
      bk(1500, `--- a/index.js`),
      bk(1500, `+++ b/index.js`),
      bk(12643, `--- ${gray("[3/3]")} test/next.test.ts`),
      bk(12743, `--- End`),
    ].join("\n");
    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/package.json": 900,
      "test/cli/install/bun-patch.test.ts": 11643,
      "test/next.test.ts": 100,
    });
  });
});

describe("phase-header boundary", () => {
  // Both log parsers share this allowlist (scripts/ci-log-phase.mjs); if
  // runner.node.ts grows a new phase between the serial tests and the next
  // `[N/M]` header, add it there and here.
  test.each([
    [true, `--- napi prebuild: 3 addon(s), 23.9s`],
    [true, `--- [52-257/829] 206 files in parallel (3\u00d7)`],
    [true, `--- Running 444 parallel-safe tests (3-wide)`],
    [true, `--- Running 217 programs compiled ahead of time (3-wide)`],
    [true, `--- Running 9 files that build many executables (3-wide)`],
    [true, `--- End`],
    [true, `--- Summary`],
    [true, `--- Received SIGTERM, exiting...`],
    [false, `--- a/index.js`],
    [false, `--- ps ---`],
    [false, `--- logs ---`],
    [false, `------`],
    [false, `--- `],
    [false, `--- [52/829] test/a.test.ts`],
  ])("%p %s", (expected, body) => {
    expect(isPhaseGroupHeader(body)).toBe(expected);
  });
});

test("what .buildkite/update-test-durations.yml runs with node imports no TypeScript", () => {
  const root = join(import.meta.dir, "..", "..");
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, "utf8").matchAll(/^import .* from "(\.[^"]+)";$/gm)].flatMap(([, path]) => {
      const imported = join(dirname(file), path);
      return /\.m?ts$/.test(imported) ? [imported] : [imported, ...importsOf(imported)];
    });
  const commands = readFileSync(join(root, ".buildkite", "update-test-durations.yml"), "utf8");
  const scripts = [...commands.matchAll(/^ +node (scripts\/\S+)/gm)].map(([, script]) => script);
  expect(scripts).toContain("scripts/update-parallel-allowlist.mjs");
  expect(scripts.filter(script => importsOf(join(root, script)).some(file => /\.m?ts$/.test(file)))).toEqual([]);
});

describe("scripts/update-test-durations.mjs parseLog", () => {
  test("does not charge napi prebuild or the parallel-bucket phase to the preceding serial test", () => {
    const log = [
      bk(0, `--- ${gray("[1/8]")} test/before.test.ts`),
      bk(61, `--- napi prebuild: 3 addon(s), 23.9s`),
      bk(24000, `--- ${gray("[2-5/8]")} 4 files in parallel (3\u00d7)`),
      bk(84000, `${gray("[2/8]")} test/b.test.ts ${gray("(0.50s)")}`),
      bk(84000, `${gray("[3/8]")} test/c.test.ts ${gray("(1.25s)")}`),
      bk(84010, `--- ${gray("[4/8]")} test/cli/install/bun-patch.test.ts`),
      bk(84500, `--- a/index.js`),
      bk(95653, `--- Running 2 parallel-safe tests (4-wide)`),
      bk(95654, `${gray("[5/8]")} test/js/node/test/parallel/p1.js`),
      bk(95657, `${gray("[6/8]")} test/js/node/test/parallel/p2.js`),
      bk(98000, `--- End`),
    ].join("\r\r\n");

    // parseDurations returns [path, ms][]; multiple entries per path are
    // median'd downstream so we can compare raw output.
    expect(parseDurations(log)).toEqual([
      ["test/before.test.ts", 61],
      ["test/b.test.ts", 500],
      ["test/c.test.ts", 1250],
      ["test/cli/install/bun-patch.test.ts", 11643],
      ["test/js/node/test/parallel/p1.js", 3],
      ["test/js/node/test/parallel/p2.js", 500],
    ]);
  });

  test("does not charge the programs compiled ahead of time to the preceding test, and times them by what they say", () => {
    // A program's line says what it took: its own build or its share of one, and its run.
    const log = [
      bk(0, `--- ${gray("[1/5]")} test/last-serial.test.ts`),
      bk(700, `--- Running 3 programs compiled ahead of time (4-wide)`),
      bk(90000, `${gray("[2/5]")} test/aot/parallel/a.ts ${gray("(compile 1400 ms, run 14 ms)")}`),
      bk(90001, `${gray("[3/5]")} test/aot/parallel/b/main.ts ${gray("(compile 2990 ms, run 9 ms)")}`),
      bk(90002, `${gray("[4/5]")} test/aot/parallel/workers/c.mjs ${gray("(compile 9400 ms, run 310 ms)")}`),
      bk(90100, `--- ${gray("[5/5]")} vendor/x/package.json`),
      bk(90300, `--- End`),
    ].join("\r\r\n");

    expect(parseDurations(log)).toEqual([
      ["test/last-serial.test.ts", 700],
      ["test/aot/parallel/a.ts", 1414],
      ["test/aot/parallel/b/main.ts", 2999],
      ["test/aot/parallel/workers/c.mjs", 9710],
      ["vendor/x/package.json", 200],
    ]);
    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/last-serial.test.ts": 700,
      "vendor/x/package.json": 200,
    });
  });

  test("a program compiled ahead of time has an entry once it took long, and keeps it", () => {
    expect(entryOfProgram({ default: 400, asan: 2100 }, undefined)).toBeUndefined();
    expect(entryOfProgram({ default: 900, asan: 4000 }, undefined)).toEqual({ default: 900, asan: 4000 });
    // It shares a build since it has the entry, and takes little there.
    expect(entryOfProgram({ default: 300, asan: 1200 }, { default: 900 })).toEqual({ default: 900 });
  });
});
