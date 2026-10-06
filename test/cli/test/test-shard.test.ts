import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `bun test --shard=M/N` splits discovered test files across N shards.
// Files are sorted by path first for determinism, then distributed
// round-robin: file i goes to shard (i % N) + 1.

function makeFixture(name: string, fileCount: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < fileCount; i++) {
    const id = String(i).padStart(2, "0");
    files[`f${id}.test.ts`] = `import { test } from "bun:test"; test("t", () => { console.log("RAN f${id}"); });`;
  }
  return tempDir(name, files);
}

async function runShard(cwd: string, shard: string, extra: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", `--shard=${shard}`, ...extra],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const ran = stdout
    .split("\n")
    .filter(l => l.startsWith("RAN "))
    .map(l => l.slice(4))
    .sort();
  return { ran, stderr, exitCode };
}

describe.concurrent("--shard", () => {
  test("partitions test files across shards with no overlap or gaps", async () => {
    using dir = makeFixture("shard-partition", 10);
    const cwd = String(dir);

    const results = await Promise.all(["1/3", "2/3", "3/3"].map(s => runShard(cwd, s)));
    for (const r of results) {
      expect(r.stderr).toContain("--shard=");
      expect(r.exitCode).toBe(0);
    }

    const all = results.flatMap(r => r.ran).sort();
    // Every file ran exactly once across all shards.
    expect(all).toEqual(["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07", "f08", "f09"]);

    // No overlap between shards.
    const seen = new Set<string>();
    for (const r of results) {
      for (const f of r.ran) {
        expect(seen.has(f)).toBe(false);
        seen.add(f);
      }
    }

    // Round-robin over the sorted list: shard M gets indices M-1, M-1+N, ...
    expect(results[0].ran).toEqual(["f00", "f03", "f06", "f09"]);
    expect(results[1].ran).toEqual(["f01", "f04", "f07"]);
    expect(results[2].ran).toEqual(["f02", "f05", "f08"]);
  });

  test("is deterministic across repeated runs", async () => {
    using dir = makeFixture("shard-determinism", 12);
    const cwd = String(dir);

    const [a, b] = await Promise.all([runShard(cwd, "2/4"), runShard(cwd, "2/4")]);
    expect(a.ran).toEqual(["f01", "f05", "f09"]);
    expect(a.ran).toEqual(b.ran);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
  });

  test("composes with --randomize: shard selection is independent of the seed", async () => {
    // Shard selection sorts, picks, then --randomize shuffles only the
    // selected subset. This test verifies the SET of files in a shard
    // is unaffected by randomization — every seed (and no seed) yields
    // the same shard membership. Shuffle-order determinism under a
    // fixed seed is covered by test-randomize.test.ts.
    using dir = makeFixture("shard-randomize", 12);
    const cwd = String(dir);

    const [plain, seeded1, seeded2, otherSeed] = await Promise.all([
      runShard(cwd, "2/4"),
      runShard(cwd, "2/4", ["--seed=123"]),
      runShard(cwd, "2/4", ["--seed=123"]),
      runShard(cwd, "2/4", ["--seed=999999"]),
    ]);

    expect(plain.ran).toEqual(["f01", "f05", "f09"]);
    expect(seeded1.ran).toEqual(plain.ran);
    expect(seeded2.ran).toEqual(plain.ran);
    expect(otherSeed.ran).toEqual(plain.ran);

    expect(seeded1.stderr).toContain("--shard=2/4:");
    for (const r of [plain, seeded1, seeded2, otherSeed]) expect(r.exitCode).toBe(0);
  });

  test("--shard=1/1 runs every test file", async () => {
    using dir = makeFixture("shard-one", 5);
    const cwd = String(dir);

    const { ran, stderr, exitCode } = await runShard(cwd, "1/1");
    expect(stderr).toContain("--shard=1/1:");
    expect(ran).toEqual(["f00", "f01", "f02", "f03", "f04"]);
    expect(exitCode).toBe(0);
  });

  test("prints the shard summary line", async () => {
    using dir = makeFixture("shard-summary", 7);
    const cwd = String(dir);

    const { stderr, exitCode } = await runShard(cwd, "2/3");
    expect(stderr).toMatch(/--shard=2\/3: running \d+\/7 test files/);
    expect(exitCode).toBe(0);
  });

  test("does not print shard summary when there are no test files", async () => {
    // With no test files at all, --shard should stay out of the way and
    // let the normal "No tests found!" error path handle it.
    using dir = tempDir("shard-no-files", {
      "not-a-test.ts": "export const x = 1;",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--shard=1/3"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("--shard=");
    expect(stderr).not.toContain("0/0");
    expect(stderr.toLowerCase()).toContain("no tests found");
    expect(exitCode).not.toBe(0);
  });

  test("empty shard exits 0 without 'No tests found'", async () => {
    // 2 files, 5 shards → shards 3, 4, 5 get nothing.
    using dir = makeFixture("shard-empty", 2);
    const cwd = String(dir);

    const { ran, stderr, exitCode } = await runShard(cwd, "5/5");
    expect(ran).toEqual([]);
    expect(stderr).toContain("--shard=5/5:");
    expect(stderr).toContain("running 0/2 test files");
    expect(stderr).not.toContain("No tests found");
    expect(stderr).not.toContain("did not match any test files");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["0/3", "index must be between 1 and 3"],
    ["4/3", "index must be between 1 and 3"],
    ["1/0", "count must be greater than 0"],
    ["abc", "expects"],
    ["1/", "count must be a positive integer"],
    ["/3", "index must be a positive integer"],
    ["a/3", "index must be a positive integer"],
    ["1/b", "count must be a positive integer"],
  ])("rejects invalid --shard=%s", async (arg, needle) => {
    using dir = makeFixture("shard-invalid", 1);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", `--shard=${arg}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(needle);
    expect(exitCode).not.toBe(0);
  });

  test("composes with --parallel: shard filters first, then workers run the subset", async () => {
    // 4 files; --shard=1/2 keeps f00 and f02. --parallel runs that subset.
    // This proves the file filter happens before the coordinator distributes;
    // worker distribution itself is covered by the JEST_WORKER_ID test in
    // parallel.test.ts.
    const files: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      const id = String(i).padStart(2, "0");
      files[`f${id}.test.ts`] =
        `import {test} from "bun:test"; test("t", () => console.log("RAN f${id} WID="+process.env.JEST_WORKER_ID));`;
    }
    using dir = tempDir("shard-parallel", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--shard=1/2", "--parallel=2"],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = stdout + stderr;
    expect(stdout).toContain("PARALLEL");
    expect(stderr).toContain("--shard=1/2:");
    expect(stderr).toContain("running 2/4 test files");
    const ran = [...out.matchAll(/RAN (f\d\d) WID=(\S+)/g)].map(m => ({ file: m[1], wid: m[2] }));
    // Only shard-1 files ran, in any worker:
    expect(ran.map(r => r.file).sort()).toEqual(["f00", "f02"]);
    // JEST_WORKER_ID is the local worker (1..K), never undefined and never the
    // shard index. With 2 sharded files and lazy spawn, K may collapse to 1.
    for (const r of ran) {
      expect(["1", "2"]).toContain(r.wid);
    }
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("--timings", () => {
  test("--shard with --timings: one file bigger than a whole shard doesn't leave earlier shards empty", async () => {
    using dir = makeFixture("shard-timings-giant", 4);
    await Bun.write(
      `${dir}/t.json`,
      JSON.stringify({
        version: 1,
        files: { "f00.test.ts": 1000, "f01.test.ts": 1, "f02.test.ts": 1, "f03.test.ts": 1 },
      }),
    );
    const results = await Promise.all(
      ["1/4", "2/4", "3/4", "4/4"].map(s => runShard(String(dir), s, ["--timings=t.json"])),
    );
    expect(results.map(r => r.ran)).toEqual([["f00"], ["f01"], ["f02"], ["f03"]]);
    for (const r of results) expect(r.exitCode).toBe(0);
  });

  test("--shard with --timings: a big file that sorts last doesn't leave trailing shards empty", async () => {
    using dir = makeFixture("shard-timings-giant-last", 4);
    await Bun.write(
      `${dir}/t.json`,
      JSON.stringify({
        version: 1,
        files: { "f00.test.ts": 1, "f01.test.ts": 1, "f02.test.ts": 1, "f03.test.ts": 1000 },
      }),
    );
    const results = await Promise.all(
      ["1/4", "2/4", "3/4", "4/4"].map(s => runShard(String(dir), s, ["--timings=t.json"])),
    );
    expect(results.map(r => r.ran)).toEqual([["f00"], ["f01"], ["f02"], ["f03"]]);
    for (const r of results) expect(r.exitCode).toBe(0);
  });

  test("--update-timings creates the timings file's parent directory", async () => {
    using dir = makeFixture("timings-mkdir", 1);
    const r = await runShard(String(dir), "1/1", ["--timings=nested/dir/t.json", "--update-timings"]);
    expect(r.ran).toEqual(["f00"]);
    expect(Object.keys((await Bun.file(`${dir}/nested/dir/t.json`).json()).files)).toEqual(["f00.test.ts"]);
    expect(r.exitCode).toBe(0);
  });

  test("--update-timings under --shard writes only the files that shard ran, to the first --timings path", async () => {
    using dir = makeFixture("timings-shard-write", 4);
    const base = { version: 1, files: { "f00.test.ts": 1000, "f01.test.ts": 1, "f02.test.ts": 1, "f03.test.ts": 1 } };
    await Bun.write(`${dir}/base.json`, JSON.stringify(base));
    const [s1, s2] = await Promise.all([
      runShard(String(dir), "1/2", ["--timings=1.json", "--timings=base.json", "--update-timings"]),
      runShard(String(dir), "2/2", ["--timings=2.json", "--timings=base.json", "--update-timings"]),
    ]);
    expect(s1.ran).toEqual(["f00"]);
    expect(s2.ran).toEqual(["f01", "f02", "f03"]);
    expect(Object.keys((await Bun.file(`${dir}/1.json`).json()).files)).toEqual(["f00.test.ts"]);
    expect(Object.keys((await Bun.file(`${dir}/2.json`).json()).files).sort()).toEqual([
      "f01.test.ts",
      "f02.test.ts",
      "f03.test.ts",
    ]);
    // base.json is only read.
    expect(await Bun.file(`${dir}/base.json`).json()).toEqual(base);
    expect(s1.exitCode).toBe(0);
    expect(s2.exitCode).toBe(0);
  });

  test("multiple --timings files are read as one table, in any order", async () => {
    using dir = makeFixture("timings-multi", 4);
    // Last run's per-shard outputs: disjoint, together the whole suite.
    await Bun.write(`${dir}/1.json`, JSON.stringify({ version: 1, files: { "f00.test.ts": 1000 } }));
    await Bun.write(
      `${dir}/2.json`,
      JSON.stringify({ version: 1, files: { "f01.test.ts": 1, "f02.test.ts": 1, "f03.test.ts": 1 } }),
    );
    for (const order of [
      ["1.json", "2.json"],
      ["2.json", "1.json"],
    ]) {
      const flags = ["--timings=out.json", ...order.map(f => `--timings=${f}`)];
      const [s1, s2] = await Promise.all([runShard(String(dir), "1/2", flags), runShard(String(dir), "2/2", flags)]);
      expect(s1.ran).toEqual(["f00"]);
      expect(s2.ran).toEqual(["f01", "f02", "f03"]);
      expect(s1.exitCode).toBe(0);
      expect(s2.exitCode).toBe(0);
    }
  });

  test("--update-timings under --shard: a shard that gets no files writes an empty table", async () => {
    using dir = makeFixture("timings-empty-shard", 2);
    const r = await runShard(String(dir), "3/3", ["--timings=3.json", "--update-timings"]);
    expect(r.ran).toEqual([]);
    expect(await Bun.file(`${dir}/3.json`).json()).toEqual({ version: 1, files: {} });
    expect(r.exitCode).toBe(0);
  });

  test("--update-timings without --timings is an error", async () => {
    using dir = tempDir("timings-no-path", { "a.test.ts": `import {test} from "bun:test"; test("t", () => {});` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-timings"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("--update-timings requires --timings");
    expect(exitCode).toBe(1);
  });

  test("a --timings file that doesn't exist yet is fine (first run creates it)", async () => {
    using dir = tempDir("timings-missing", { "a.test.ts": `import {test} from "bun:test"; test("t", () => {});` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--timings=nope.json", "--update-timings"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(Object.keys((await Bun.file(`${dir}/nope.json`).json()).files)).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("a malformed --timings file is rejected", async () => {
    using dir = tempDir("timings-bad", {
      "a.test.ts": `import {test} from "bun:test"; test("t", () => {});`,
      "t.json": JSON.stringify({ "a.test.ts": 5 }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--timings=t.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`"version": 1`);
    expect(exitCode).toBe(1);
  });

  test("--shard with --timings cuts path-sorted files into runs of equal total time", async () => {
    // 8 files; f00..f03 are "slow" (100 each), f04..f07 are "fast" (1 each).
    // Round-robin would give each of 2 shards two slow + two fast. By time,
    // shard 1 = f00,f01 (200) and shard 2 = f02..f07 (204): contiguous, balanced.
    using dir = makeFixture("shard-timings", 8);
    const files: Record<string, number> = {};
    for (let i = 0; i < 8; i++) files[`f${String(i).padStart(2, "0")}.test.ts`] = i < 4 ? 100 : 1;
    await Bun.write(`${dir}/t.json`, JSON.stringify({ version: 1, files }));

    const [s1, s2] = await Promise.all(["1/2", "2/2"].map(s => runShard(String(dir), s, ["--timings=t.json"])));
    expect(s1.ran).toEqual(["f00", "f01"]);
    expect(s2.ran).toEqual(["f02", "f03", "f04", "f05", "f06", "f07"]);
    expect(s1.exitCode).toBe(0);
    expect(s2.exitCode).toBe(0);
  });

  test("--shard with --timings: files missing from the table still run exactly once", async () => {
    using dir = makeFixture("shard-timings-partial", 6);
    await Bun.write(
      `${dir}/t.json`,
      JSON.stringify({ version: 1, files: { "f00.test.ts": 50, "f05.test.ts": 50, "stale.test.ts": 999 } }),
    );
    const results = await Promise.all(["1/3", "2/3", "3/3"].map(s => runShard(String(dir), s, ["--timings=t.json"])));
    expect(results.flatMap(r => r.ran).sort()).toEqual(["f00", "f01", "f02", "f03", "f04", "f05"]);
    for (const r of results) expect(r.exitCode).toBe(0);
  });

  test("--parallel with --timings cuts chunks by duration and dispatches each chunk slowest-first", async () => {
    // Costs 10,40,20,30 (total 100) over path-sorted f0..f3 cut into 2 chunks by
    // time: [f0,f1] and [f2,f3]. A huge scale-up delay keeps this on one worker,
    // which runs its own chunk slowest-first (f1,f0) then steals the other
    // chunk's slowest remaining file each time (f3, then f2).
    const files: Record<string, string> = {};
    const timings: Record<string, number> = {};
    for (let i = 0; i < 4; i++) {
      files[`f${i}.test.ts`] = `import {test} from "bun:test"; test("t", () => console.log("RAN f${i}"));`;
      timings[`f${i}.test.ts`] = [10, 40, 20, 30][i];
    }
    using dir = tempDir("parallel-timings-order", {
      ...files,
      "t.json": JSON.stringify({ version: 1, files: timings }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=1000000", "--timings=t.json"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const ran = [...(stdout + stderr).matchAll(/RAN (f\d)/g)].map(m => m[1]);
    expect(ran).toEqual(["f1", "f0", "f3", "f2"]);
    expect(exitCode).toBe(0);
  });
});

// Compares two files' measured wall-clock durations, so keep it away from the concurrent block's CPU contention.
describe("--timings (serial)", () => {
  test("--update-timings writes { version, files } sorted slowest-first and merges with existing entries", async () => {
    using dir = tempDir("timings-write", {
      "fast.test.ts": `import {test} from "bun:test"; test("t", () => {});`,
      "slow.test.ts": `import {test} from "bun:test"; test("t", async () => { await Bun.sleep(300); });`,
      "t.json": JSON.stringify({ version: 1, files: { "gone/elsewhere.test.ts": 7 } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--timings=t.json", "--update-timings"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    const written = await Bun.file(`${dir}/t.json`).json();
    expect(written.version).toBe(1);
    // Entries for files this run didn't touch (another shard's, say) survive.
    expect(Object.keys(written.files).sort()).toEqual(["fast.test.ts", "gone/elsewhere.test.ts", "slow.test.ts"]);
    expect(written.files["slow.test.ts"]).toBeGreaterThanOrEqual(300);
    expect(written.files["slow.test.ts"]).toBeGreaterThan(written.files["fast.test.ts"]);
    // Slowest first.
    expect(Object.keys(written.files)[0]).toBe("slow.test.ts");
    expect(exitCode).toBe(0);
  });
});
