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
