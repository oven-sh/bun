import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { parseLog } from "../../scripts/ci-slowest-tests";

// Buildkite prefixes each line with an APC timestamp: ESC `_bk;t=<ms>` BEL.
const bk = (ts: number, body: string) => `\x1b_bk;t=${ts}\x07${body}`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

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

    const out = parseLog(log);
    expect(out.get("test/last-serial.test.ts")).toBe(4800);
    // p3 is the last dispatch before an 80s tail; header-gap timing would
    // charge it 79_990 ms. Parallel-safe spans are clamped.
    expect(out.get("test/js/node/test/parallel/p3.js")).toBeLessThanOrEqual(500);
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
});

test("scripts/buildkite-slow-tests.js does not fold batch phases into the preceding serial test", async () => {
  // Same fixture as the parallel-bucket case above plus the parallel-safe
  // phase; the standalone script shares parseLog's header contract.
  const t0 = 1700000000000;
  const fixture = [
    bk(t0 + 0, `--- ${gray("[1/10]")} test/a.test.ts`),
    bk(t0 + 100, `--- napi prebuild: 3 addon(s), 23.9s`),
    bk(t0 + 24000, `--- ${gray("[2-5/10]")} 4 files in parallel (3\u00d7)`),
    bk(t0 + 84000, `${gray("[2/10]")} test/b.test.ts ${gray("(0.50s)")}`),
    bk(t0 + 84000, `${gray("[3/10]")} test/c.test.ts ${gray("(1.25s)")}`),
    bk(t0 + 84000, `${gray("[4/10]")} test/d.test.ts ${gray("(0.01s)")}`),
    bk(t0 + 84010, `--- ${gray("[5/10]")} test/e.test.ts`),
    bk(t0 + 84210, `--- \x1b[33m[5/10] test/e.test.ts - code 1\x1b[0m`),
    bk(t0 + 94000, `--- ${gray("[5/10]")} test/e.test.ts ${gray("[attempt #2]")}`),
    bk(t0 + 94180, `--- Running 3 parallel-safe tests (3-wide)`),
    bk(t0 + 94181, `${gray("[6/10]")} test/f.test.ts`),
    bk(t0 + 94185, `${gray("[7/10]")} test/g.test.ts`),
    bk(t0 + 116000, `--- ${gray("[8/10]")} vendor/x/package.json`),
    bk(t0 + 118000, `--- End`),
  ].join("\r\r\n");

  using dir = tempDir("bk-slow-tests", { "job.log": fixture });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "..", "..", "scripts", "buildkite-slow-tests.js"),
      join(String(dir), "job.log"),
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const rows = new Map<string, number>();
  for (const m of stdout.matchAll(/^\s*\d+\.\s+(\d+\.\d+)s\s+(\S+)/gm)) rows.set(m[2], parseFloat(m[1]));

  // a.test.ts ran for 100 ms; the 23.9 s napi prebuild and 60 s bucket run
  // that follow must not be charged to it. The script only lists files > 1 s.
  expect(rows.get("test/a.test.ts")).toBeUndefined();
  expect(stdout).not.toMatch(/test\/a\.test\.ts/);
  // e.test.ts ran twice (200 ms + 180 ms); the 9.8 s retry backoff between the
  // error header and attempt #2 is harness overhead.
  expect(rows.get("test/e.test.ts")).toBeUndefined();
  expect(rows.get("test/c.test.ts")).toBe(1.25);
  expect(rows.get("vendor/x/package.json")).toBe(2.0);
  expect(stdout).not.toMatch(/code 1/);
  expect(exitCode).toBe(0);
});
