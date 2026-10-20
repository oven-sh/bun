import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPhaseGroupHeader } from "../../scripts/ci-log-phase.mjs";
import { findBuild, jobCoverage, parseLog } from "../../scripts/ci-slowest-tests";
import { parseLog as parseDurations } from "../../scripts/update-test-durations.mjs";

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

// Jobs as `bk build view` and `bk build list` print them. `bk` leaves
// `started_at` out for a job that never started.
const DEBIAN = ":debian: 13 x64 - test-bun";
const DARWIN = ":darwin: any x64 - test-bun";
const WINDOWS = ":windows: 2019 x64 - test-bun";
const bkJob = (id: string, name: string, state: string, fields: object = {}) => ({
  id,
  name,
  state,
  raw_log_url: `https://api.buildkite.com/v2/organizations/bun/pipelines/bun/builds/1/jobs/${id}/log.txt`,
  retried: false,
  ...fields,
});
const started = (id: string, name: string, state = "passed") =>
  bkJob(id, name, state, { started_at: "2026-10-17T02:20:00.000Z", finished_at: "2026-10-17T02:45:00.000Z" });
const neverStarted = (id: string, name: string, state = "waiting_failed") => bkJob(id, name, state);
// No agent took the job: it has a `finished_at` and still no `started_at`.
const expired = (id: string, name: string) => bkJob(id, name, "expired", { finished_at: "2026-10-17T05:05:25.587Z" });

describe("scripts/ci-slowest-tests.ts jobCoverage", () => {
  test("a test-bun job has timings only if an agent started it", () => {
    const ranToTheEnd = started("a", DEBIAN);
    // parseLog reads the partial log of a job that was killed while it ran.
    const killedMidRun = started("b", DEBIAN, "canceled");
    const buildJob = started("h", ":linux: x64 - build-bun");
    const retried = { ...started("i", DEBIAN), retried: true };
    const blockStep = { id: "j", type: "manual", state: "broken" };
    const noLogUrl = { id: "k", name: DEBIAN, started_at: "2026-10-17T02:20:00.000Z" };
    const { name, ...unlabeledStep } = started("l", DEBIAN);

    expect(
      jobCoverage([
        ranToTheEnd,
        killedMidRun,
        // Never started. In build 127137 the build-bun jobs were canceled, so
        // every test-bun job ended as `waiting_failed`.
        neverStarted("c", WINDOWS, "waiting_failed"),
        neverStarted("d", WINDOWS, "canceled"),
        // In build 127153 no agent took one of the two darwin x64 shards.
        expired("e", DARWIN),
        neverStarted("f", DARWIN, "scheduled"),
        bkJob("g", DARWIN, "waiting", { started_at: null }),
        // Not a test-bun job of the build, or no log to ask for.
        buildJob,
        retried,
        blockStep,
        noLogUrl,
        unlabeledStep,
      ]),
    ).toEqual({
      timed: [ranToTheEnd, killedMidRun],
      total: 7,
      platforms: [
        { name: DEBIAN, started: 2, total: 2 },
        { name: WINDOWS, started: 0, total: 2 },
        { name: DARWIN, started: 0, total: 3 },
      ],
      complete: false,
    });
  });

  test("a build is complete when it has test-bun jobs and every one of them started", () => {
    expect(jobCoverage([started("a", DEBIAN), started("b", WINDOWS, "failed")]).complete).toBe(true);
    expect(jobCoverage([started("a", DEBIAN), expired("b", DARWIN)]).complete).toBe(false);
    // `[skip tests]` in the commit subject: the build has no test-bun job.
    expect(jobCoverage([started("a", ":linux: x64 - build-bun")])).toEqual({
      timed: [],
      total: 0,
      platforms: [],
      complete: false,
    });
  });
});

type MergedPR = { number: number; headRefName: string };
type Build = { number: number; state: string; finished_at?: string; jobs: ReturnType<typeof bkJob>[] };
const finishedBuild = (number: number, state: string, jobs: Build["jobs"]): Build => ({
  number,
  state,
  finished_at: "2026-10-17T07:53:30.239Z",
  jobs,
});
// Three test-bun jobs on two platforms stand in for the 160 on 11 of a real build.
const everyJobStarted = (build: number) => [
  started(`${build}-a`, DEBIAN),
  started(`${build}-b`, DEBIAN, "failed"),
  started(`${build}-c`, WINDOWS),
];
const noJobStarted = (build: number) => [
  neverStarted(`${build}-a`, DEBIAN),
  neverStarted(`${build}-b`, DEBIAN),
  neverStarted(`${build}-c`, WINDOWS),
];
const oneShardNeverStarted = (build: number) => [
  started(`${build}-a`, DEBIAN),
  started(`${build}-b`, DARWIN),
  expired(`${build}-c`, DARWIN),
];

describe("scripts/ci-slowest-tests.ts findBuild", () => {
  // Stands in for `bk build list --branch <branch>` and records the branches asked for.
  function lister(byBranch: Record<string, Build[] | Error>) {
    const calls: string[] = [];
    const list = async (branch: string) => {
      calls.push(branch);
      const builds = byBranch[branch];
      if (builds instanceof Error) throw builds;
      return builds;
    };
    return { calls, list };
  }

  // What findBuild decided, in PR and build numbers.
  const decided = ({ picked, skipped, failedLists }: Awaited<ReturnType<typeof findBuild<MergedPR>>>) => ({
    picked: picked && {
      pr: picked.pr.number,
      build: picked.build.number,
      download: picked.coverage.timed.map(job => job.id),
    },
    skipped: skipped.map(
      ({ pr, build, coverage }) =>
        `PR ${pr.number} build ${build.number}: ${coverage.timed.length} of ${coverage.total} started`,
    ),
    failedLists: failedLists.map(({ pr, error }) => `PR ${pr.number}: ${error}`),
  });

  test("passes over a build in which no test-bun job started and takes the next merged PR's build", async () => {
    // 2026-10-17: PR #45639 was merged while its last build, 127153, still
    // ran. Its only finished build, 127137, failed after 22 s: every build-bun
    // job was canceled and none of the 160 test-bun jobs started.
    const prs = [
      { number: 45639, headRefName: "hot-loop-no-inline" },
      { number: 45600, headRefName: "merged-earlier" },
      { number: 45599, headRefName: "never-listed" },
    ];
    const { calls, list } = lister({
      "hot-loop-no-inline": [
        { number: 127153, state: "running", jobs: everyJobStarted(127153) },
        finishedBuild(127137, "failed", noJobStarted(127137)),
      ],
      "merged-earlier": [finishedBuild(126925, "passed", everyJobStarted(126925))],
    });

    expect(decided(await findBuild(prs, list))).toEqual({
      picked: { pr: 45600, build: 126925, download: ["126925-a", "126925-b", "126925-c"] },
      skipped: ["PR 45639 build 127137: 0 of 3 started"],
      failedLists: [],
    });
    // One `bk build list` for each PR up to the pick, and none after it.
    expect(calls).toEqual(["hot-loop-no-inline", "merged-earlier"]);
  });

  test("goes on to an older build of the same branch, past builds that did not finish or were canceled", async () => {
    const prs = [
      { number: 1, headRefName: "a" },
      { number: 2, headRefName: "b" },
    ];
    const { calls, list } = lister({
      a: [
        { number: 106, state: "failing", jobs: everyJobStarted(106) },
        // The state decides, with or without a `finished_at`.
        finishedBuild(105, "running", everyJobStarted(105)),
        finishedBuild(104, "canceled", everyJobStarted(104)),
        finishedBuild(103, "failed", noJobStarted(103)),
        // Flaky tests failed the build. Its timings are as good as any.
        finishedBuild(102, "failed", everyJobStarted(102)),
        finishedBuild(101, "passed", everyJobStarted(101)),
      ],
      b: [finishedBuild(201, "passed", everyJobStarted(201))],
    });

    expect(decided(await findBuild(prs, list))).toEqual({
      picked: { pr: 1, build: 102, download: ["102-a", "102-b", "102-c"] },
      skipped: ["PR 1 build 103: 0 of 3 started"],
      failedLists: [],
    });
    expect(calls).toEqual(["a"]);
  });

  test("passes over a build with a job that never started, and picks nothing when no build is complete", async () => {
    const prs = [
      { number: 1, headRefName: "a" },
      { number: 2, headRefName: "b" },
    ];
    const { calls, list } = lister({
      a: [finishedBuild(101, "failed", oneShardNeverStarted(101))],
      b: [
        // The Windows build failed, so that platform has no timings at all.
        finishedBuild(202, "failed", [
          started("202-a", DEBIAN),
          neverStarted("202-b", WINDOWS),
          neverStarted("202-c", WINDOWS),
        ]),
        // `[skip tests]`: no test-bun job.
        finishedBuild(201, "passed", [started("201-a", ":linux: x64 - build-bun")]),
      ],
    });

    expect(decided(await findBuild(prs, list))).toEqual({
      picked: undefined,
      skipped: ["PR 1 build 101: 2 of 3 started", "PR 2 build 202: 1 of 3 started", "PR 2 build 201: 0 of 0 started"],
      failedLists: [],
    });
    expect(calls).toEqual(["a", "b"]);
  });

  test("a `bk build list` that fails skips that PR, and its error is kept", async () => {
    const prs = [
      { number: 1, headRefName: "a" },
      { number: 2, headRefName: "b" },
    ];
    const { calls, list } = lister({
      a: new Error("429 Too Many Requests"),
      b: [finishedBuild(201, "passed", everyJobStarted(201))],
    });

    expect(decided(await findBuild(prs, list))).toEqual({
      picked: { pr: 2, build: 201, download: ["201-a", "201-b", "201-c"] },
      skipped: [],
      failedLists: ["PR 1: Error: 429 Too Many Requests"],
    });
    expect(calls).toEqual(["a", "b"]);
  });
});

// The script asks `gh` for the merged PRs and `bk` for the builds. Here both
// are shell scripts on PATH that record their arguments and print canned
// JSON, and a local server stands in for the Buildkite log URLs. Shell scripts
// do not resolve as executables on Windows, hence the skip.
describe.skipIf(isWindows)("scripts/ci-slowest-tests.ts with a canned `gh` and `bk`", () => {
  const script = join(import.meta.dir, "..", "..", "scripts", "ci-slowest-tests.ts");
  const fakeGh = ["#!/bin/sh", 'echo "gh $*" >> "$FAKE/calls"', 'cat "$FAKE/merged.json"', ""].join("\n");
  const fakeBk = [
    "#!/bin/sh",
    'echo "bk $*" >> "$FAKE/calls"',
    'case "$1 $2" in',
    '  "build list") canned="$FAKE/list-$4.json" ;;',
    '  "build view") canned="$FAKE/view-$3.json" ;;',
    "esac",
    'if [ ! -f "$canned" ]; then',
    '  echo "Error: 429 Too Many Requests" >&2',
    "  exit 1",
    "fi",
    'cat "$canned"',
    "",
  ].join("\n");

  interface Canned {
    /** `gh pr list --state merged` */
    merged?: MergedPR[];
    /** `bk build list --branch <key>`. For a branch that is not here, `bk` fails. */
    lists?: Record<string, Build[]>;
    /** `bk build view <number>` */
    views?: Build[];
    /** What the log URL of each job id answers. A job that is not here has an empty log. */
    logs?: Record<string, string | (() => Response)>;
  }

  async function runSlowest(args: string[], { merged = [], lists = {}, views = [], logs = {} }: Canned) {
    const requested: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        requested.push(id);
        const log = logs[id] ?? "";
        return typeof log === "string" ? new Response(log) : log();
      },
    });
    const served = (build: Build) => ({
      ...build,
      jobs: build.jobs.map(job => ({ ...job, raw_log_url: `${server.url}${job.id}` })),
    });
    using dir = tempDir("ci-slowest", {
      "bin/gh": fakeGh,
      "bin/bk": fakeBk,
      "calls": "",
      "merged.json": JSON.stringify(merged),
      ...Object.fromEntries(
        Object.entries(lists).map(([branch, builds]) => [`list-${branch}.json`, JSON.stringify(builds.map(served))]),
      ),
      ...Object.fromEntries(views.map(build => [`view-${build.number}.json`, JSON.stringify(served(build))])),
    });
    const bin = join(String(dir), "bin");
    chmodSync(join(bin, "gh"), 0o755);
    chmodSync(join(bin, "bk"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), script, ...args],
      env: {
        ...bunEnv,
        PATH: `${bin}:${bunEnv.PATH}`,
        FAKE: String(dir),
        // The script caches logs in $TMPDIR/bun-ci-logs-<build>.
        TMPDIR: join(String(dir), "tmp"),
        BUILDKITE_TOKEN: "token",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout,
      stderr: stderr
        .replaceAll(String(dir), "<dir>")
        .replaceAll(server.url.href, "<logs>/")
        .split("\n")
        // The `N/M logs` progress lines.
        .filter(line => !/^  \d+\/\d+ logs/.test(line)),
      exitCode,
      calls: readFileSync(join(String(dir), "calls"), "utf8")
        .split("\n")
        .filter(Boolean),
      requested: requested.sort(),
    };
  }

  const log = (...lines: [ms: number, header: string][]) =>
    [...lines.map(([ms, header]) => bk(ms, `--- ${header}`)), ""].join("\r\r\n");

  // An ASAN build starts too slowly to run all of these at the same time within the default timeout.
  const scenario = test.concurrentIf(!isASAN);

  scenario("a build number whose test-bun jobs never started: exit 1 and no log request", async () => {
    const result = await runSlowest(["127137", "--json"], {
      views: [finishedBuild(127137, "failed", noJobStarted(127137))],
    });
    expect(result).toEqual({
      stdout: "",
      stderr: [
        "build #127137: 0 of 3 test-bun jobs started, on 0 of 2 platforms",
        "error: build #127137 has no test timings: none of its 3 test-bun jobs started",
        "note: pass another build number, or none to pick a recent merged-PR build",
        "",
      ],
      exitCode: 1,
      calls: ["bk build view 127137"],
      requested: [],
    });
  });

  scenario("a build number whose jobs started and ran no test: exit 1 and no table", async () => {
    const result = await runSlowest(["7"], {
      views: [finishedBuild(7, "failed", [started("7-a", DEBIAN, "failed")])],
      // The shard ended in its setup step.
      logs: { "7-a": log([0, "[1/50] test/package.json"], [900, "End"]) },
    });
    expect(result).toEqual({
      stdout: "",
      stderr: [
        "build #7: 1 of 1 test-bun jobs started, on 1 of 1 platforms",
        "1 unique entries, 0 test files after filtering",
        "logs cached at <dir>/tmp/bun-ci-logs-7",
        "error: build #7 has no test timings: no test file in the logs of its 1 started test-bun jobs",
        "note: a `failed <job id>` line above is a log that could not be downloaded",
        "",
      ],
      exitCode: 1,
      calls: ["bk build view 7"],
      requested: ["7-a"],
    });
  });

  scenario("no build number: takes the first build in which every test-bun job started", async () => {
    const untested = finishedBuild(127137, "failed", noJobStarted(127137));
    const complete = finishedBuild(126925, "passed", everyJobStarted(126925));
    const result = await runSlowest(["--json"], {
      merged: [
        { number: 45639, headRefName: "hot-loop-no-inline" },
        { number: 45620, headRefName: "list-fails" },
        { number: 45600, headRefName: "merged-earlier" },
        { number: 45599, headRefName: "never-listed" },
      ],
      lists: {
        "hot-loop-no-inline": [
          { number: 127153, state: "running", jobs: everyJobStarted(127153) },
          untested,
          finishedBuild(127100, "failed", oneShardNeverStarted(127100)),
        ],
        "merged-earlier": [complete],
      },
      // `bk build view` can answer for both builds. The script must not need it.
      views: [untested, complete],
      logs: {
        "126925-a": log([0, "[1/3] test/a.test.ts"], [3000, "[2/3] test/b.test.ts"], [4000, "End"]),
        "126925-b": log([0, "[3/3] test/c.test.ts"], [2000, "End"]),
        "126925-c": log([0, "[1/1] test/a.test.ts"], [5000, "End"]),
      },
    });
    const { build, count, top } = JSON.parse(result.stdout);
    expect({ ...result, stdout: { build, count, top } }).toEqual({
      stdout: {
        build: "126925",
        count: 3,
        top: [
          { file: "test/a.test.ts", maxMs: 5000, maxPlat: "windows 2019 x64" },
          { file: "test/c.test.ts", maxMs: 2000, maxPlat: "debian 13 x64" },
          { file: "test/b.test.ts", maxMs: 1000, maxPlat: "debian 13 x64" },
        ],
      },
      stderr: [
        "no build given, finding a recent merged-PR build...",
        "  skipped build #127137 (PR #45639, hot-loop-no-inline, state=failed): 0 of 3 test-bun jobs started",
        "  skipped build #127100 (PR #45639, hot-loop-no-inline, state=failed): 2 of 3 test-bun jobs started",
        "  failed to list the builds of list-fails (PR #45620): Error: 429 Too Many Requests",
        "  using build #126925 (PR #45600, merged-earlier, state=passed)",
        "build #126925: 3 of 3 test-bun jobs started, on 2 of 2 platforms",
        "3 unique entries, 3 test files after filtering",
        "logs cached at <dir>/tmp/bun-ci-logs-126925",
        "",
      ],
      exitCode: 0,
      // The jobs come with the build list, so there is no `bk build view`.
      calls: [
        "gh pr list --state merged --limit 10 --json number,headRefName",
        "bk build list --branch hot-loop-no-inline",
        "bk build list --branch list-fails",
        "bk build list --branch merged-earlier",
      ],
      requested: ["126925-a", "126925-b", "126925-c"],
    });
  });

  scenario(
    "no build number and no complete build: exit 1, and the note names the build with the most timings",
    async () => {
      const result = await runSlowest(["--json"], {
        merged: [
          { number: 3, headRefName: "untested" },
          { number: 2, headRefName: "list-fails" },
          { number: 1, headRefName: "partial" },
        ],
        lists: {
          untested: [finishedBuild(301, "failed", noJobStarted(301))],
          partial: [
            finishedBuild(103, "failed", [
              started("103-a", DEBIAN),
              neverStarted("103-b", WINDOWS),
              neverStarted("103-c", WINDOWS),
            ]),
            finishedBuild(102, "failed", oneShardNeverStarted(102)),
            finishedBuild(101, "failed", oneShardNeverStarted(101)),
          ],
        },
      });
      expect(result).toEqual({
        stdout: "",
        stderr: [
          "no build given, finding a recent merged-PR build...",
          "  skipped build #301 (PR #3, untested, state=failed): 0 of 3 test-bun jobs started",
          "  skipped build #103 (PR #1, partial, state=failed): 1 of 3 test-bun jobs started",
          "  skipped build #102 (PR #1, partial, state=failed): 2 of 3 test-bun jobs started",
          "  skipped build #101 (PR #1, partial, state=failed): 2 of 3 test-bun jobs started",
          "  failed to list the builds of list-fails (PR #2): Error: 429 Too Many Requests",
          "error: no finished build in which every test-bun job started among the last 3 merged PRs",
          "note: build #102 has timings from 2 of 3 test-bun jobs. Pass its number to report on it.",
          "",
        ],
        exitCode: 1,
        calls: [
          "gh pr list --state merged --limit 10 --json number,headRefName",
          "bk build list --branch untested",
          "bk build list --branch list-fails",
          "bk build list --branch partial",
        ],
        requested: [],
      });
    },
  );

  scenario("no build number and every `bk build list` fails: exit 1 with the reason of each", async () => {
    const result = await runSlowest([], {
      merged: [
        { number: 2, headRefName: "a" },
        { number: 1, headRefName: "b" },
      ],
    });
    expect(result).toEqual({
      stdout: "",
      stderr: [
        "no build given, finding a recent merged-PR build...",
        "  failed to list the builds of a (PR #2): Error: 429 Too Many Requests",
        "  failed to list the builds of b (PR #1): Error: 429 Too Many Requests",
        "error: `bk build list` failed for each of the last 2 merged PRs, so no build was examined",
        "",
      ],
      exitCode: 1,
      calls: [
        "gh pr list --state merged --limit 10 --json number,headRefName",
        "bk build list --branch a",
        "bk build list --branch b",
      ],
      requested: [],
    });
  });

  scenario(
    "no build number and no log of the picked build can be downloaded: exit 1, and no other build is tried",
    async () => {
      const result = await runSlowest(["--json"], {
        merged: [
          { number: 2, headRefName: "picked" },
          { number: 1, headRefName: "never-listed" },
        ],
        lists: {
          picked: [finishedBuild(201, "passed", [started("201-a", DEBIAN)])],
          "never-listed": [finishedBuild(101, "passed", everyJobStarted(101))],
        },
        logs: { "201-a": () => new Response("", { status: 404 }) },
      });
      expect(result).toEqual({
        stdout: "",
        stderr: [
          "no build given, finding a recent merged-PR build...",
          "  using build #201 (PR #2, picked, state=passed)",
          "build #201: 1 of 1 test-bun jobs started, on 1 of 1 platforms",
          "  failed 201-a: 404 <logs>/201-a",
          "0 unique entries, 0 test files after filtering",
          "logs cached at <dir>/tmp/bun-ci-logs-201",
          "error: build #201 has no test timings: no test file in the logs of its 1 started test-bun jobs",
          "note: a `failed <job id>` line above is a log that could not be downloaded",
          "",
        ],
        exitCode: 1,
        calls: ["gh pr list --state merged --limit 10 --json number,headRefName", "bk build list --branch picked"],
        requested: ["201-a"],
      });
    },
  );

  // Build 127153 in small: one of the two darwin shards expired, and here the
  // Windows build also failed.
  const partial: Canned = {
    views: [
      finishedBuild(127153, "failed", [
        started("debian-1", DEBIAN),
        started("darwin-1", DARWIN),
        expired("darwin-2", DARWIN),
        neverStarted("windows-1", WINDOWS),
        neverStarted("windows-2", WINDOWS),
      ]),
    ],
    logs: {
      "debian-1": log([0, "[1/2] test/a.test.ts"], [3000, "[2/2] test/b.test.ts"], [4000, "End"]),
      "darwin-1": log([0, "[1/1] test/a.test.ts"], [2000, "End"]),
    },
  };
  const partialStderr = [
    "build #127153: 2 of 5 test-bun jobs started, on 2 of 3 platforms",
    "2 unique entries, 2 test files after filtering",
    "logs cached at <dir>/tmp/bun-ci-logs-127153",
    "warning: build #127153: 3 of 5 test-bun jobs never started, so the report lacks their timings: " +
      "darwin any x64 (1 of 2 started), windows 2019 x64 (0 of 2 started)",
    "",
  ];

  scenario("a build number with jobs that never started: reports the rest and names the platforms", async () => {
    expect(await runSlowest(["127153"], partial)).toEqual({
      stdout: [
        "rank\tseconds\tfile\tslowest_platform",
        "1\t3.00\ttest/a.test.ts\tdebian 13 x64",
        "2\t1.00\ttest/b.test.ts\tdebian 13 x64",
        "",
      ].join("\n"),
      stderr: partialStderr,
      exitCode: 0,
      calls: ["bk build view 127153"],
      requested: ["darwin-1", "debian-1"],
    });
  });

  scenario("the same with --json: the warning stays on stderr", async () => {
    const result = await runSlowest(["127153", "--json"], partial);
    const { build, count, top } = JSON.parse(result.stdout);
    expect({ ...result, stdout: { build, count, top } }).toEqual({
      stdout: {
        build: "127153",
        count: 2,
        top: [
          { file: "test/a.test.ts", maxMs: 3000, maxPlat: "debian 13 x64" },
          { file: "test/b.test.ts", maxMs: 1000, maxPlat: "debian 13 x64" },
        ],
      },
      stderr: partialStderr,
      exitCode: 0,
      calls: ["bk build view 127153"],
      requested: ["darwin-1", "debian-1"],
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
