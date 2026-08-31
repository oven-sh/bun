import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { containerWaitLine, isPhaseGroupHeader, parseLog } from "../../scripts/ci-slowest-tests";
import { parseLog as parseDurations } from "../../scripts/update-test-durations.mjs";

// Buildkite prefixes each line with an APC timestamp: ESC `_bk;t=<ms>` BEL.
const bk = (ts: number, body: string) => `\x1b_bk;t=${ts}\x07${body}`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
// What each file is charged (container start-up excluded; see the last describe).
const chargedMs = (log: string) => Object.fromEntries([...parseLog(log)].map(([file, { ms }]) => [file, ms]));

describe("scripts/ci-slowest-tests.ts parseLog", () => {
  test("does not charge the parallel-safe phase to the last serial test", () => {
    // runner.node.mjs prints serial headers via startGroup (`--- [N/M] path`)
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

    const out = chargedMs(log);
    expect(out["test/last-serial.test.ts"]).toBe(4800);
    // p3 is the last dispatch before an 80s tail; header-gap timing would
    // charge it 79_990 ms. Parallel-safe spans are clamped.
    expect(out["test/js/node/test/parallel/p3.js"]).toBe(500);
    expect(out["test/a.test.ts"]).toBe(1000);
    expect(out["vendor/x/package.json"]).toBe(200);
  });

  test("sums retry attempts and normalizes Windows path separators", () => {
    const log = [
      bk(0, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts`),
      bk(3000, `--- \x1b[33m[1/2] test\\cli\\install\\flaky.test.ts - code 1\x1b[0m`),
      bk(10000, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts ${gray("[attempt #2]")}`),
      bk(14000, `--- ${gray("[2/2]")} test\\next.test.ts`),
      bk(15000, `--- End`),
    ].join("\n");

    const out = chargedMs(log);
    // First attempt 3s + second attempt 4s; the retry backoff between the
    // failure label and attempt #2 is not the test's wall clock.
    expect(out["test/cli/install/flaky.test.ts"]).toBe(7000);
    expect(out["test/next.test.ts"]).toBe(1000);
  });

  test("closes the last serial test at the parallel-phase group header when no parallel headers follow", () => {
    // Shard with zero parallel-safe tests: the group header never prints, but
    // `--- End` still terminates the open span.
    const noParallel = [bk(100, `--- ${gray("[1/1]")} test/only.test.ts`), bk(900, `--- End`)].join("\n");
    expect(chargedMs(noParallel)["test/only.test.ts"]).toBe(800);

    // Shard where the parallel phase prints its group header but (e.g. via a
    // filter) runs nothing: the open serial span must close there, not at the
    // next `[N/M]` header an arbitrary distance later.
    const emptyParallel = [
      bk(100, `--- ${gray("[1/2]")} test/last.test.ts`),
      bk(1100, `--- Running 0 parallel-safe tests (4-wide)`),
      bk(60000, `--- ${gray("[2/2]")} vendor/x/package.json`),
      bk(60100, `--- End`),
    ].join("\n");
    expect(chargedMs(emptyParallel)["test/last.test.ts"]).toBe(1000);

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
    expect(chargedMs(truncated)).toEqual({
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

    expect(chargedMs(log)).toEqual({
      "test/before.test.ts": 61,
      "test/b.test.ts": 500,
      "test/c.test.ts": 1250,
      "test/d.test.ts": 10,
      "test/e.test.ts": 200,
      "test/after.test.ts": 100,
    });
  });

  test("ignores stray `--- ` lines that are test output, not group headers", () => {
    // pipeTestStdout in runner.node.mjs sanitises `--- ` in streamed test
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
    expect(chargedMs(log)).toEqual({
      "test/package.json": 900,
      "test/cli/install/bun-patch.test.ts": 11643,
      "test/next.test.ts": 100,
    });
  });
});

describe("phase-header boundary", () => {
  // The three log parsers share this allowlist; if runner.node.mjs grows a new
  // phase between the serial tests and the next `[N/M]` header, add it here and
  // to isPhaseGroupHeader.
  test.each([
    [true, `--- napi prebuild: 3 addon(s), 23.9s`],
    [true, `--- [52-257/829] 206 files in parallel (3\u00d7)`],
    [true, `--- Running 444 parallel-safe tests (3-wide)`],
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
});

describe("container start-up wait", () => {
  // awaitService (test/docker/index.ts) blocks the test process until its
  // docker-compose service is up and prints how long that took, so whichever
  // file on a shard first touches a cold service has the container start
  // inside its measured time. The parsers take the reported waits off the
  // file and (ci-slowest) report them separately. Serial shapes are from build
  // #99854, the bucket ones from #99975.
  const ready = (service: string, waitedMs: number) =>
    `Container ready via docker-compose: ${service} at 127.0.0.1:32774 (waited ${waitedMs}ms)`;
  const log = [
    // Ran for 44 ms but was the shard's first mysql_plain user: 22.4 s charged.
    bk(0, `--- ${gray("[1/12]")} test/regression/issue/24850.test.ts`),
    bk(10, `coordinator: ensuring mysql_plain`),
    bk(22410, ready("mysql_plain", 22400)),
    // Two services, mysql already up and postgres cold, so the wait is on the
    // file's *second* describe; the timestamp of the first line says nothing
    // about it. The second line shares a physical line with a pending progress
    // dot (two `_bk;t=` markers on one line).
    bk(22444, `--- ${gray("[2/12]")} test/js/sql/sql-statement-cache-hash-collision.test.ts`),
    bk(22559, ready("mysql_plain", 2)),
    bk(22633, `\x1b[32m.\x1b[0m`) + bk(37394, ready("postgres_plain", 14750)),
    // Three container describes that were all prestarted, with ~4 s of real
    // tests between each ready line. Subtracting header->last-line here would
    // hide 8 s of the file's 12.5 s; only the reported waits come off.
    bk(37479, `--- ${gray("[3/12]")} test/js/sql/sql-mysql.test.ts`),
    bk(37575, ready("mysql_plain", 4)),
    bk(41586, ready("mysql_native_password", 0)),
    bk(45590, ready("mysql_tls", 1)),
    // A log written before the wait was reported: charged as-is.
    bk(49984, `--- ${gray("[4/12]")} test/js/sql/old-harness.test.ts`),
    bk(50100, `Container ready via docker-compose: postgres_plain at 127.0.0.1:5432`),
    bk(64984, `--- ${gray("[5/12]")} test/plain.test.ts`),
    // Parallel bucket: `bun test --parallel` flushes each file's output as a
    // block under a `<path>:` line, with progress dots and the shard-wide
    // coordinator's lines in between; per-file times arrive afterwards on the
    // summary lines. sql-empty-column-name's 0.01s is today's summary figure
    // (test time only, so the wait floors it at 0); two-waits carries a figure
    // that includes its hooks, the shape #37483 gives the runner.
    bk(65084, `--- ${gray("[6-9/12]")} 4 files in parallel (3\u00d7)`),
    bk(65090, `bun test v1.4.0 3\u00d7 PARALLEL`),
    bk(65400, Buffer.alloc(40, ".").toString()),
    bk(65400, ``),
    bk(65400, `test/js/web/streams/streams.test.js:`),
    bk(65400, `here`),
    bk(74380, `..........`) + bk(86190, `coordinator: mariadb_plain ready`),
    bk(86200, ``),
    bk(86200, `test/js/sql/sql-empty-column-name.test.ts:`),
    bk(86200, ready("mariadb_plain", 21090)),
    bk(86200, `.`),
    bk(86300, `test/js/sql/two-waits.test.ts:`),
    // Output mentioning another file is not a block header.
    bk(86300, `    at x (/build/test/js/sql/other.test.ts:4:2)`),
    bk(86300, ready("postgres_plain", 3000)),
    bk(86300, ready("mysql_plain", 250)),
    bk(86310, `Ran 40 tests across 4 files. [21.22s]`),
    bk(86400, `${gray("[6/12]")} test/js/web/streams/streams.test.js ${gray("(0.40s)")}`),
    bk(86400, `${gray("[7/12]")} test/js/sql/sql-empty-column-name.test.ts ${gray("(0.01s)")}`),
    bk(86400, `${gray("[8/12]")} test/js/sql/two-waits.test.ts ${gray("(3.50s)")}`),
    bk(86400, `${gray("[9/12]")} test/silent.test.ts ${gray("(0.10s)")}`),
    // Each attempt is adjusted by its own wait: the first attempt waited 5 s
    // and failed, the retry found the container up.
    bk(86410, `--- ${gray("[10/12]")} test/js/sql/flaky.test.ts`),
    bk(91450, ready("postgres_plain", 5000)),
    bk(91500, `--- \x1b[33m[10/12] test/js/sql/flaky.test.ts - code 1\x1b[0m`),
    bk(101500, `--- ${gray("[10/12]")} test/js/sql/flaky.test.ts ${gray("[attempt #2]")}`),
    bk(101510, ready("postgres_plain", 0)),
    // The wait is measured inside the test process and the gap by the agent; a
    // wait that rounds past the gap floors at 0 rather than going negative.
    bk(101700, `--- ${gray("[11/12]")} test/js/sql/skew.test.ts`),
    bk(101900, ready("postgres_plain", 250)),
    bk(101900, `--- ${gray("[12/12]")} test/last.test.ts`),
    bk(102000, `--- End`),
  ].join("\r\r\n");

  test("scripts/ci-slowest-tests.ts charges each file its own time and reports the wait separately", () => {
    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/regression/issue/24850.test.ts": { ms: 44, containerMs: 22400 },
      "test/js/sql/sql-statement-cache-hash-collision.test.ts": { ms: 283, containerMs: 14752 },
      "test/js/sql/sql-mysql.test.ts": { ms: 12500, containerMs: 5 },
      "test/js/sql/old-harness.test.ts": { ms: 15000, containerMs: 0 },
      "test/plain.test.ts": { ms: 100, containerMs: 0 },
      "test/js/web/streams/streams.test.js": { ms: 400, containerMs: 0 },
      "test/js/sql/sql-empty-column-name.test.ts": { ms: 0, containerMs: 21090 },
      "test/js/sql/two-waits.test.ts": { ms: 250, containerMs: 3250 },
      "test/silent.test.ts": { ms: 100, containerMs: 0 },
      "test/js/sql/flaky.test.ts": { ms: 90 + 200, containerMs: 5000 },
      "test/js/sql/skew.test.ts": { ms: 0, containerMs: 250 },
      "test/last.test.ts": { ms: 100, containerMs: 0 },
    });
  });

  test("scripts/update-test-durations.mjs keeps the wait out of expected-durations.json", () => {
    // This parser records first attempts only (`[attempt #2]` is not a path).
    expect(parseDurations(log)).toEqual([
      ["test/regression/issue/24850.test.ts", 44],
      ["test/js/sql/sql-statement-cache-hash-collision.test.ts", 283],
      ["test/js/sql/sql-mysql.test.ts", 12500],
      ["test/js/sql/old-harness.test.ts", 15000],
      ["test/plain.test.ts", 100],
      ["test/js/web/streams/streams.test.js", 400],
      ["test/js/sql/sql-empty-column-name.test.ts", 0],
      ["test/js/sql/two-waits.test.ts", 250],
      ["test/silent.test.ts", 100],
      ["test/js/sql/flaky.test.ts", 90],
      ["test/js/sql/skew.test.ts", 0],
      ["test/last.test.ts", 100],
    ]);
  });

  test("awaitService prints the line the parsers subtract", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "ci-slowest-tests.fixture.ts")],
      // The fixture's describeWithContainer resolves its service from the
      // environment, so no docker is involved on any lane.
      env: { ...bunEnv, BUN_TEST_SERVICE_mysql_plain: "127.0.0.1:1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stdout.split("\n").find(l => l.startsWith("Container ready via docker-compose:"));
    expect(line).toMatch(/^Container ready via docker-compose: mysql_plain at 127\.0\.0\.1:1 \(waited \d+ms\)$/);
    expect(line).toMatch(containerWaitLine);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);

    // The real line, as a shard log would carry it, comes off the file's gap in
    // both parsers.
    const waited = parseInt(containerWaitLine.exec(line!)![1], 10);
    const shard = [bk(0, `--- ${gray("[1/1]")} test/x.test.ts`), bk(5, line!), bk(2000, `--- End`)].join("\r\r\n");
    expect(parseLog(shard).get("test/x.test.ts")).toEqual({ ms: 2000 - waited, containerMs: waited });
    expect(parseDurations(shard)).toEqual([["test/x.test.ts", 2000 - waited]]);
  });
});
