import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isPhaseGroupHeader } from "../../scripts/ci-log-phase.mjs";
import { createLogFetcher, parseLog, type Job } from "../../scripts/ci-slowest-tests";
import { parseLog as parseDurations } from "../../scripts/update-test-durations.mjs";

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
    expect(Object.fromEntries(parseLog(log))).toEqual({
      "test/package.json": 900,
      "test/cli/install/bun-patch.test.ts": 11643,
      "test/next.test.ts": 100,
    });
  });
});

describe("phase-header boundary", () => {
  // Both log parsers share this allowlist (scripts/ci-log-phase.mjs); if
  // runner.node.mjs grows a new phase between the serial tests and the next
  // `[N/M]` header, add it there and here.
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

// Stands in for api.buildkite.com. `respond` gets the job id from
// `/jobs/<id>/log.txt` and the count of requests for that job so far.
function logServer(respond: (id: string, hit: number, req: Request) => Response) {
  const hits: Record<string, number> = {};
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const id = new URL(req.url).pathname.split("/")[2];
      hits[id] = (hits[id] ?? 0) + 1;
      return respond(id, hits[id], req);
    },
  });
  return {
    hits,
    job: (id: string, name = ":debian: 13 x64 - test-bun"): Job => ({
      id,
      name,
      raw_log_url: `${server.url}jobs/${id}/log.txt`,
    }),
    [Symbol.dispose]: () => void server.stop(true),
  };
}

const refuse = (status: number, headers: Record<string, string> = {}) => new Response("", { status, headers });

// The 429 that api.buildkite.com sent on 2026-09-14 when the per-user limit was
// used up and the organization window had just reset. It has no Retry-After,
// and `RateLimit-Reset` is for the limit that was not exceeded.
const rateLimited = (reset: number) =>
  Response.json(
    {
      message: `You have exceeded your rest_user API rate limit. Please wait ${reset} seconds before making more requests.`,
      scope: "rest_user",
      limit: 200,
      current: 200,
      reset,
    },
    {
      status: 429,
      headers: {
        "RateLimit-Scope": "rest",
        "RateLimit-Remaining": "195",
        "RateLimit-Reset": "60",
        "RateLimit-User-Scope": "rest_user",
        "RateLimit-User-Remaining": "0",
        "RateLimit-User-Reset": `${reset}`,
      },
    },
  );

describe("scripts/ci-slowest-tests.ts createLogFetcher", () => {
  // `sleep` records the wait and returns at once, so no test waits for real.
  function fetcher(cacheDir: string) {
    const waits: number[] = [];
    const fetchLog = createLogFetcher({ token: "secret", cacheDir, sleep: async ms => void waits.push(ms) });
    return { waits, fetchLog };
  }

  test("waits out a 429, then stores the log in the cache", async () => {
    using cacheDir = tempDir("ci-slowest-cache", {});
    const authorizations: (string | null)[] = [];
    using api = logServer((id, hit, req) => {
      authorizations.push(req.headers.get("authorization"));
      return hit === 1 ? rateLimited(7) : new Response("the log");
    });

    const { waits, fetchLog } = fetcher(String(cacheDir));
    expect(await fetchLog(api.job("a"))).toBe("the log");
    // `reset` counts whole seconds, so the fetcher waits one more.
    expect({ waits, hits: api.hits, authorizations }).toEqual({
      waits: [8000],
      hits: { a: 2 },
      authorizations: ["Bearer secret", "Bearer secret"],
    });
    expect(readFileSync(join(String(cacheDir), "a.log"), "utf8")).toBe("the log");

    // A second run reads the cache and sends no request.
    expect(await fetcher(String(cacheDir)).fetchLog(api.job("a"))).toBe("the log");
    expect(api.hits).toEqual({ a: 2 });
  });

  test.each<[string, () => Response, number[]]>([
    ["the reset of the limit that was exceeded", () => rateLimited(36), [37_000, 37_000]],
    ["Retry-After on a 429 that has one", () => refuse(429, { "Retry-After": "7" }), [8000, 8000]],
    ["an exponential backoff on a 429 with no hint", () => refuse(429), [1000, 2000]],
    ["Retry-After on a 503", () => refuse(503, { "Retry-After": "2" }), [3000, 3000]],
    [
      "an exponential backoff on a 502 from a proxy",
      () => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "RateLimit-Reset": "30" } }),
      [1000, 2000],
    ],
    [
      "an exponential backoff on an HTTP-date Retry-After",
      () => refuse(429, { "Retry-After": "Mon, 14 Sep 2026 06:00:00 GMT" }),
      [1000, 2000],
    ],
    ["maxWaitMs and one second at most", () => rateLimited(3600), [61_000, 61_000]],
  ])("waits for %s", async (_, refusal, expected) => {
    using cacheDir = tempDir("ci-slowest-cache", {});
    using api = logServer((id, hit) => (hit <= 2 ? refusal() : new Response("the log")));

    const { waits, fetchLog } = fetcher(String(cacheDir));
    expect(await fetchLog(api.job("a"))).toBe("the log");
    expect({ waits, hits: api.hits }).toEqual({ waits: expected, hits: { a: 3 } });
  });

  test("gives up after 6 requests and leaves nothing in the cache", async () => {
    using cacheDir = tempDir("ci-slowest-cache", {});
    using api = logServer(() => rateLimited(1));

    const { waits, fetchLog } = fetcher(String(cacheDir));
    const job = api.job("a");
    expect(await fetchLog(job).catch(e => e.message)).toBe(`429 ${job.raw_log_url} (6 attempts)`);
    expect({ waits, hits: api.hits }).toEqual({ waits: [2000, 2000, 2000, 2000, 2000], hits: { a: 6 } });
    expect(existsSync(join(String(cacheDir), "a.log"))).toBe(false);
  });

  test("does not retry a status that a retry cannot fix", async () => {
    using cacheDir = tempDir("ci-slowest-cache", {});
    using api = logServer(() => Response.json({ message: "Not Found" }, { status: 404 }));

    const { waits, fetchLog } = fetcher(String(cacheDir));
    const job = api.job("a");
    expect(await fetchLog(job).catch(e => e.message)).toBe(`404 ${job.raw_log_url}`);
    expect({ waits, hits: api.hits }).toEqual({ waits: [], hits: { a: 1 } });
  });

  test("one 429 holds back the other downloads until the wait is over", async () => {
    using cacheDir = tempDir("ci-slowest-cache", {});
    const waiting = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let resumed = false;
    const duringTheWait: string[] = [];
    using api = logServer((id, hit) => {
      if (id === "a" && hit === 1) return rateLimited(5);
      if (!resumed && id !== "ping") duringTheWait.push(id);
      return new Response(`log of ${id}`);
    });
    const fetchLog = createLogFetcher({
      token: "secret",
      cacheDir: String(cacheDir),
      sleep() {
        waiting.resolve();
        return resume.promise;
      },
    });

    const a = fetchLog(api.job("a"));
    await waiting.promise;
    const b = fetchLog(api.job("b"));
    // A request for "b" that did not wait reaches the server before this round trip ends.
    await fetch(api.job("ping").raw_log_url);
    resumed = true;
    resume.resolve();

    expect(await Promise.all([a, b])).toEqual(["log of a", "log of b"]);
    expect({ duringTheWait, hits: api.hits }).toEqual({ duringTheWait: [], hits: { a: 2, b: 1, ping: 1 } });
  });
});

// The script gets the job list from `bk build view`, so these tests put a `bk`
// on PATH that prints a canned build. The stand-in is a shell script.
describe.skipIf(isWindows)("bun scripts/ci-slowest-tests.ts --json", () => {
  const script = join(import.meta.dir, "../../scripts/ci-slowest-tests.ts");
  const oneFileLog = (file: string, ms: number) => [bk(0, `--- [1/1] ${file}`), bk(ms, `--- End`)].join("\n");

  function fixture(api: ReturnType<typeof logServer>) {
    const dir = tempDir("ci-slowest", {
      "bin/bk": `#!/bin/sh\ncat "$(dirname "$0")/../build.json"\n`,
      "build.json": JSON.stringify({
        jobs: [
          api.job("a", ":debian: 13 x64 - test-bun"),
          api.job("b", ":windows: 2019 x64 - test-bun"),
          api.job("c", ":debian: 13 x64 - test-bun"),
        ],
      }),
    });
    chmodSync(join(String(dir), "bin/bk"), 0o755);
    return dir;
  }

  async function run(dir: string, ...flags: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), script, "1234", "--json", ...flags],
      env: {
        ...bunEnv,
        PATH: join(dir, "bin") + delimiter + bunEnv.PATH,
        // The script keeps its log cache under os.tmpdir().
        TMPDIR: join(dir, "tmp"),
        BUILDKITE_TOKEN: "secret",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("retries a 429, reports a log that stays missing, and a re-run fetches only that log", async () => {
    let bIsGone = true;
    using api = logServer((id, hit) => {
      if (id === "a") return hit === 1 ? rateLimited(0) : new Response(oneFileLog("test/a.test.ts", 1000));
      if (id === "b") return bIsGone ? refuse(404) : new Response(oneFileLog("test/b.test.ts", 9000));
      return new Response(oneFileLog("test/c.test.ts", 3000));
    });
    using dir = fixture(api);
    const a = { file: "test/a.test.ts", maxMs: 1000, maxPlat: "debian 13 x64" };
    const b = { file: "test/b.test.ts", maxMs: 9000, maxPlat: "windows 2019 x64" };
    const c = { file: "test/c.test.ts", maxMs: 3000, maxPlat: "debian 13 x64" };

    const partial = await run(String(dir));
    expect(partial.stderr).toContain("  waiting 1s for Buildkite (rate limit or server error)\n");
    expect(partial.stderr).toContain("  2/3 logs, 1 failed\n");
    expect(partial.stderr).toEndWith(
      "warning: 1 of 3 logs are missing, so the result is computed from partial data\n" +
        "  missing: windows 2019 x64 (1)\n" +
        "  run the same command again to fetch only the missing logs\n",
    );
    expect(JSON.parse(partial.stdout)).toEqual({
      build: "1234",
      count: 2,
      top: [c, a],
      jobs: 3,
      jobsFailed: 1,
      failedJobs: [{ id: "b", platform: "windows 2019 x64", error: `404 ${api.job("b").raw_log_url}` }],
    });
    expect(partial.exitCode).toBe(2);
    expect(api.hits).toEqual({ a: 2, b: 1, c: 1 });

    bIsGone = false;
    const complete = await run(String(dir));
    expect(complete.stderr).toContain("  3/3 logs\n");
    expect(complete.stderr).not.toContain("warning");
    expect(JSON.parse(complete.stdout)).toEqual({
      build: "1234",
      count: 3,
      top: [b, c, a],
      jobs: 3,
      jobsFailed: 0,
      failedJobs: [],
    });
    expect(complete.exitCode).toBe(0);
    // "a" and "c" came from the cache.
    expect(api.hits).toEqual({ a: 2, b: 2, c: 1 });
  });

  test.concurrent("--allow-partial keeps the report of a missing log and exits 0", async () => {
    using api = logServer(id => (id === "b" ? refuse(404) : new Response(oneFileLog(`test/${id}.test.ts`, 1000))));
    using dir = fixture(api);

    const { stdout, stderr, exitCode } = await run(String(dir), "--allow-partial");
    expect(stderr).toContain("warning: 1 of 3 logs are missing");
    expect(JSON.parse(stdout)).toMatchObject({ count: 2, jobs: 3, jobsFailed: 1, failedJobs: [{ id: "b" }] });
    expect(exitCode).toBe(0);
  });
});
