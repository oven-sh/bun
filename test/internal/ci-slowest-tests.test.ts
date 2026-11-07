import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { failedBucketAttempt, isPhaseGroupHeader } from "../../scripts/ci-log-phase.mjs";
import { addLog, slowestRows, tableLines, type Agg } from "../../scripts/ci-slowest-tests";
import { entryOfProgram, parseLog as parseDurations } from "../../scripts/update-test-durations.mjs";

// Buildkite prefixes each line with an APC timestamp: ESC `_bk;t=<ms>` BEL.
const bk = (ts: number, body: string) => `\x1b_bk;t=${ts}\x07${body}`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

// What ci:slowest has for each file of one job log, the sum of the file's attempts, by the fold that the script runs.
const parseLog = (log: string) => {
  const agg = new Map<string, Agg>();
  addLog(agg, "one platform", log);
  return new Map([...agg].map(([file, a]) => [file, a.perPlat.get("one platform")!]));
};

describe("scripts/ci-slowest-tests.ts addLog", () => {
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
    [true, `--- Disk and memory pressure`],
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

// A file that fails in its `bun test --parallel` bucket has no `[N/M]` line for that run. The runner opens a group for
// it, `--- <path> - K failing in the parallel batch (X.XXs)`, and then runs the file again, alone, as a serial test.
describe("a file that fails in its parallel bucket", () => {
  const failedInBucket = (path: string, failing: number, seconds: string) =>
    `--- ${path} - ${failing} failing in the parallel batch ${gray(`(${seconds}s)`)}`;
  const retryingAlone = (failed: number, unfinished = 0) =>
    `\x1b[33mparallel bucket: retrying ${failed} failed and ${unfinished} unfinished file(s) one at a time\x1b[0m`;

  // Lines of build 137632, debian 13 x64-asan, job 01a1a834-7687-4bcc-8a22-115e18a35494. The timestamps count from the
  // header of the bucket. The bucket reached its limit of 10 minutes while `regexp` still ran. Five files failed in
  // it. Two are kept here, and the counts in the headers and in the retry line are adjusted to that. Both pass alone.
  const passed = "test/bundler/compile-trim-capabilities.test.ts";
  const mocked = "test/aot/a-mocked-commonjs-file-keeps-its-own-exports.test.ts";
  const regexp = "test/aot/a-regexp-literal-of-two-layers-is-made-once.test.ts";
  const bucketThenPassAlone = [
    bk(0, `--- ${gray("[372-406/684]")} 35 files in parallel (7\u00d7)`),
    bk(600230, `\x1b[31mInterrupted\x1b[0m while still running:`),
    // `bun test` says what the file took too. That is the run of the runner's line below, not one more.
    bk(600230, `  ${regexp} \x1b[2m(599s)\x1b[0m`),
    bk(600852, ``),
    bk(600854, `${gray("[404/684]")} ${passed} ${gray("(2.07s)")}`),
    bk(600854, failedInBucket(mocked, 1, "240.23")),
    bk(600854, `\x1b[31m\u2717\x1b[0m it says what plain Bun says, as one program and in layers`),
    bk(600854, `    test timed out`),
    bk(600854, ``),
    bk(600854, failedInBucket(regexp, 1, "599.93")),
    bk(600854, `\x1b[31m\u2717\x1b[0m (interrupted)`),
    bk(600854, `    interrupted while still running`),
    bk(600854, ``),
    bk(600855, retryingAlone(2)),
    bk(600855, `--- ${gray("[405/684]")} ${mocked}`),
    bk(636393, `--- ${gray("[406/684]")} ${regexp}`),
    bk(786245, `--- ${gray("[407-494/684]")} 88 files in parallel (7\u00d7)`),
  ];

  // Lines of build 137815, debian 13 x64-asan, job 01a1adc4-0c2e-4ee7-9d0b-430120ef94ae, cut down the same way.
  // `imported` passes alone. `twice` fails each of the 4 times it runs alone, and its last attempt is its longest.
  const slowPass = "test/aot/a-source-file-that-a-test-writes-anew-is-read-from-disk.test.ts";
  const imported = "test/aot/a-name-imported-from-a-built-in-module-keeps-what-the-module-had-at-the-link.test.ts";
  const twice = "test/aot/modules-in-a-test-run-twice.test.ts";
  const bucketThenFailAlone = [
    bk(0, `--- ${gray("[322-362/633]")} 41 files in parallel (7\u00d7)`),
    bk(600314, `\x1b[31mInterrupted\x1b[0m while still running:`),
    bk(600314, `  ${twice} \x1b[2m(186s)\x1b[0m`),
    bk(600917, `${gray("[326/633]")} ${slowPass} ${gray("(344.85s)")}`),
    bk(600919, failedInBucket(imported, 7, "281.80")),
    bk(600919, `\x1b[31m\u2717\x1b[0m names of node:module that are first used behind the stores`),
    bk(600919, `    test timed out`),
    bk(600920, failedInBucket(twice, 4, "186.26")),
    bk(600920, `\x1b[31m\u2717\x1b[0m mock.module of a file that has run: twice`),
    bk(600920, `    expect(received).toEqual(expected)`),
    bk(600920, retryingAlone(2)),
    bk(908108, `--- ${gray("[361/633]")} ${imported}`),
    bk(938426, `--- ${gray("[362/633]")} ${twice}`),
    bk(1135131, `--- \x1b[33m[362/633] ${twice} - code 1\x1b[0m`),
    // Between a failure and the next attempt the runner waits 5 to 15 s. No attempt is charged for that.
    bk(1142767, `--- ${gray("[362/633]")} ${twice} ${gray("[attempt #2]")}`),
    bk(1339346, `--- \x1b[33m[362/633] ${twice} - code 1\x1b[0m`),
    bk(1345503, `--- ${gray("[362/633]")} ${twice} ${gray("[attempt #3]")}`),
    bk(1541980, `--- \x1b[33m[362/633] ${twice} - code 1\x1b[0m`),
    bk(1548046, `--- ${gray("[362/633]")} ${twice} ${gray("[attempt #4]")}`),
    bk(1744979, `--- \x1b[31m[362/633] ${twice} - code 1\x1b[0m`),
    bk(1745052, `--- ${gray("[363-447/633]")} 85 files in parallel (7\u00d7)`),
  ];

  // Lines of build 137632, debian 13 x64-asan, job 01a1a834-7685-4bc3-9831-b229ee18ba12: the two files that failed in
  // this bucket. `run` fails each of the 4 times it runs alone, and its bucket attempt is its longest.
  const library = "test/aot/library-modules-in-a-layered-test-run.test.ts";
  const run = "test/aot/modules-in-a-test-run.test.ts";
  const bucketAttemptIsLongest = [
    bk(0, `--- ${gray("[395-428/703]")} 34 files in parallel (7\u00d7)`),
    bk(350833, failedInBucket(library, 1, "120.21")),
    bk(350833, failedInBucket(run, 2, "300.36")),
    bk(350833, retryingAlone(2)),
    bk(350833, `--- ${gray("[427/703]")} ${library}`),
    bk(371159, `--- ${gray("[428/703]")} ${run}`),
    bk(554113, `--- \x1b[33m[428/703] ${run} - code 1\x1b[0m`),
    bk(566487, `--- ${gray("[428/703]")} ${run} ${gray("[attempt #2]")}`),
    bk(751531, `--- \x1b[33m[428/703] ${run} - code 1\x1b[0m`),
    bk(765709, `--- ${gray("[428/703]")} ${run} ${gray("[attempt #3]")}`),
    bk(947859, `--- \x1b[33m[428/703] ${run} - code 1\x1b[0m`),
    bk(962775, `--- ${gray("[428/703]")} ${run} ${gray("[attempt #4]")}`),
    bk(1147497, `--- \x1b[31m[428/703] ${run} - code 1\x1b[0m`),
    bk(1147580, `--- ${gray("[429-517/703]")} 89 files in parallel (7\u00d7)`),
  ];

  // Lines of build 137815, ubuntu 25.04 x64, job 01a1adc4-0c39-4421-97f9-7f64e804f163: a file that builds no
  // executable. One test fails in the bucket. Alone the file passes, and takes longer than in the bucket.
  const quick = "test/snippets/segfault-todo.test.js";
  const net = "test/js/node/net/node-net.test.ts";
  const aloneIsLonger = [
    bk(0, `--- ${gray("[316-405/592]")} 90 files in parallel (3\u00d7)`),
    bk(45942, `${gray("[404/592]")} ${quick} ${gray("(0.01s)")}`),
    bk(45942, failedInBucket(net, 1, "5.61")),
    bk(45942, `\x1b[31m\u2717\x1b[0m a partial writev keeps exactly the unsent suffix`),
    bk(45942, `    client failed (exit 3): precondition failed: no direct write left data in the native buffer`),
    bk(45942, retryingAlone(1)),
    bk(45943, `--- ${gray("[405/592]")} ${net}`),
    bk(52661, `--- Running 187 parallel-safe tests (3-wide)`),
  ];

  test("scripts/ci-slowest-tests.ts adds the bucket attempt to the attempts alone", () => {
    // Without its bucket attempt `regexp` is a file of 150 s. Where it passes in its bucket, it takes 576 s.
    expect(Object.fromEntries(parseLog(bucketThenPassAlone.join("\r\r\n")))).toEqual({
      [passed]: 2070,
      [mocked]: 240230 + 35538,
      [regexp]: 599930 + 149852,
    });
    expect(Object.fromEntries(parseLog(bucketThenFailAlone.join("\r\r\n")))).toEqual({
      [slowPass]: 344850,
      [imported]: 281800 + 30318,
      [twice]: 186260 + 196705 + 196579 + 196477 + 196933,
    });
    expect(Object.fromEntries(parseLog(aloneIsLonger.join("\r\r\n")))).toEqual({
      [quick]: 10,
      [net]: 5610 + 6718,
    });
  });

  test("scripts/update-test-durations.mjs samples the bucket attempt, and not the attempts alone", () => {
    // The sample of a file is its first attempt in a job. A file of a bucket runs beside other files, and the runner
    // divides its duration by the number of files at once. The rerun alone is a retry: alone `regexp` took a quarter
    // of its time in the bucket.
    expect(parseDurations(bucketThenPassAlone.join("\r\r\n"))).toEqual([
      [passed, 2070],
      [mocked, 240230],
      [regexp, 599930],
    ]);
    expect(parseDurations(bucketThenFailAlone.join("\r\r\n"))).toEqual([
      [slowPass, 344850],
      [imported, 281800],
      [twice, 186260],
    ]);
    expect(parseDurations(aloneIsLonger.join("\r\r\n"))).toEqual([
      [quick, 10],
      [net, 5610],
    ]);
  });

  test("a file that did not finish in the bucket has no such line, and both parsers take its run alone", () => {
    // No log of the three builds has an unfinished file. These lines follow runParallelBucket in
    // scripts/runner.node.ts: a file that a crash or the time limit kept from finishing gets no line, and runs alone
    // after the files that failed.
    const log = [
      bk(0, `--- ${gray("[1-3/5]")} 3 files in parallel (3\u00d7)`),
      bk(9000, `${gray("[1/5]")} test/ok.test.ts ${gray("(1.00s)")}`),
      bk(9000, failedInBucket("test/failed.test.ts", 1, "4.00")),
      bk(9001, retryingAlone(1, 1)),
      bk(9001, `--- ${gray("[2/5]")} test/failed.test.ts`),
      bk(11001, `--- ${gray("[3/5]")} test/unfinished.test.ts`),
      bk(14001, `--- ${gray("[4/5]")} test/serial.test.ts`),
      bk(14501, `--- End`),
    ].join("\n");
    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/ok.test.ts": 1000,
      "test/failed.test.ts": 4000 + 2000,
      "test/unfinished.test.ts": 3000,
      "test/serial.test.ts": 500,
    });
    expect(parseDurations(log)).toEqual([
      ["test/ok.test.ts", 1000],
      ["test/failed.test.ts", 4000],
      ["test/unfinished.test.ts", 3000],
      ["test/serial.test.ts", 500],
    ]);
  });

  test("both parsers keep the bucket attempt when the log ends before the file runs alone", () => {
    // The job is killed after the runner has printed what failed in the bucket.
    const killed = bucketThenFailAlone.slice(0, 10).join("\r\r\n");
    expect(Object.fromEntries(parseLog(killed))).toEqual({ [slowPass]: 344850, [imported]: 281800, [twice]: 186260 });
    expect(parseDurations(killed)).toEqual([
      [slowPass, 344850],
      [imported, 281800],
      [twice, 186260],
    ]);
  });

  test("both parsers read the line where it ends in three carriage returns", () => {
    // Most lines of a log end in `\r\r\n`. In the darwin logs some of the runner's lines end in `\r\r\r\n`.
    const log = bucketThenPassAlone.join("\r\r\r\n");
    expect(Object.fromEntries(parseLog(log))).toEqual({
      [passed]: 2070,
      [mocked]: 240230 + 35538,
      [regexp]: 599930 + 149852,
    });
    expect(parseDurations(log)).toEqual([
      [passed, 2070],
      [mocked, 240230],
      [regexp, 599930],
    ]);
  });

  test("the group of a failed file ends the test that runs before it, as every header of the runner does", () => {
    // The runner prints the header of the bucket first. A parser does not depend on that.
    const log = [
      bk(0, `--- ${gray("[1/3]")} test/serial.test.ts`),
      bk(1000, failedInBucket("test/b.test.ts", 1, "2.00")),
      bk(9000, `--- ${gray("[2/3]")} test/b.test.ts`),
      bk(9500, `--- End`),
    ].join("\n");
    expect(Object.fromEntries(parseLog(log))).toEqual({ "test/serial.test.ts": 1000, "test/b.test.ts": 2000 + 500 });
    expect(parseDurations(log)).toEqual([
      ["test/serial.test.ts", 1000],
      ["test/b.test.ts", 2000],
    ]);
  });

  test.each([
    [`--- ${regexp} - 1 failing in the parallel batch (599.93s)`, { path: regexp, ms: 599930 }],
    [`--- test/a.test.ts - 12 failing in the parallel batch (0.04s)`, { path: "test/a.test.ts", ms: 40 }],
    // 64.88 * 1000 is 64879.99999999999.
    [`--- test/a.test.ts - 1 failing in the parallel batch (64.88s)`, { path: "test/a.test.ts", ms: 64880 }],
    // The one line of the 389 in the three builds that names no .ts file.
    [
      `--- test/js/web/websocket/websocket.test.js - 1 failing in the parallel batch (1.00s)`,
      { path: "test/js/web/websocket/websocket.test.js", ms: 1000 },
    ],
    // Other groups and lines that name a file.
    [`--- scripts/ci-remap-server/package.json`, null],
    [`--- a/index.js`, null],
    [`--- test/a.test.ts`, null],
    [`--- [5/8] test/a.test.ts - code 1`, null],
    [`[3/8] test/a.test.ts (1.25s)`, null],
    [`  test/a.test.ts (599s)`, null],
    // Not the whole line, or no test file.
    [`test/a.test.ts - 1 failing in the parallel batch (1.00s)`, null],
    [`--- test/a.test.ts - 1 failing in the parallel batch (1.00s) and more`, null],
    [`--- test/package.json - 1 failing in the parallel batch (1.00s)`, null],
  ])("failedBucketAttempt(%j)", (body, expected) => {
    expect(failedBucketAttempt(body)).toEqual(expected);
  });

  test("a row of ci:slowest says how many attempts its time adds up, and how long the longest took", () => {
    const agg = new Map<string, Agg>();
    // Three shards of one platform.
    addLog(agg, "debian 13 x64-asan", bucketThenFailAlone.join("\r\r\n"));
    addLog(agg, "debian 13 x64-asan", bucketThenPassAlone.join("\r\r\n"));
    addLog(agg, "debian 13 x64-asan", bucketAttemptIsLongest.join("\r\r\n"));
    addLog(agg, "ubuntu 25.04 x64", aloneIsLonger.join("\r\r\n"));
    // On this platform `imported` passes in its bucket, and that one attempt takes longer than its two on
    // debian 13 x64-asan. `twice` fails in the bucket and passes alone.
    addLog(
      agg,
      "debian 13 x64",
      [
        bk(0, `--- ${gray("[90-180/367]")} 91 files in parallel (3\u00d7)`),
        bk(350400, `${gray("[95/367]")} ${imported} ${gray("(350.00s)")}`),
        bk(350400, failedInBucket(twice, 4, "77.53")),
        bk(350401, retryingAlone(1)),
        bk(350401, `--- ${gray("[180/367]")} ${twice}`),
        bk(405639, `--- ${gray("[181/367]")} vendor/elysia/package.json`),
        bk(406000, `--- End`),
      ].join("\n"),
    );

    // `attempts` and `maxAttemptMs` are those of `maxPlat`: `maxMs` is the sum of that many attempts. The longest is
    // the first of 5 for `run`, the last of 5 for `twice`, the first of 2 for `regexp` and the second of 2 for `net`.
    expect(slowestRows(agg, 500)).toEqual([
      { file: run, maxMs: 1035230, maxPlat: "debian 13 x64-asan", attempts: 5, maxAttemptMs: 300360 },
      { file: twice, maxMs: 972954, maxPlat: "debian 13 x64-asan", attempts: 5, maxAttemptMs: 196933 },
      { file: regexp, maxMs: 749782, maxPlat: "debian 13 x64-asan", attempts: 2, maxAttemptMs: 599930 },
      { file: imported, maxMs: 350000, maxPlat: "debian 13 x64", attempts: 1, maxAttemptMs: 350000 },
      { file: slowPass, maxMs: 344850, maxPlat: "debian 13 x64-asan", attempts: 1, maxAttemptMs: 344850 },
      { file: mocked, maxMs: 275768, maxPlat: "debian 13 x64-asan", attempts: 2, maxAttemptMs: 240230 },
      { file: library, maxMs: 140536, maxPlat: "debian 13 x64-asan", attempts: 2, maxAttemptMs: 120210 },
      { file: net, maxMs: 12328, maxPlat: "ubuntu 25.04 x64", attempts: 2, maxAttemptMs: 6718 },
      { file: passed, maxMs: 2070, maxPlat: "debian 13 x64-asan", attempts: 1, maxAttemptMs: 2070 },
      { file: quick, maxMs: 10, maxPlat: "ubuntu 25.04 x64", attempts: 1, maxAttemptMs: 10 },
    ]);
    expect(tableLines(slowestRows(agg, 2))).toEqual([
      "rank\tseconds\tfile\tslowest_platform\tattempts\tlongest_attempt",
      `1\t1035.23\t${run}\tdebian 13 x64-asan\t5\t300.36`,
      `2\t972.95\t${twice}\tdebian 13 x64-asan\t5\t196.93`,
    ]);
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
