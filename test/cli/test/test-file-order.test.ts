import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// The order of the test files does not depend on the order in which a directory lists its
// entries. That order is a name hash on ext4 and APFS, and the order of creation on tmpfs.

/** Writes one test file for each name, in the given order. Each file prints its name. */
function project(prefix: string, names: string[], extraFiles: Record<string, string> = {}) {
  return tempDir(prefix, {
    ...Object.fromEntries(
      names.map(name => [
        `${name}.test.ts`,
        `import { test } from "bun:test"; test("t", () => { console.log("RAN ${name}"); });`,
      ]),
    ),
    ...extraFiles,
  });
}

async function bunTest(cwd: string, args: string[]): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr has the report of the run. It is in the assertion only to show why a run failed.
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  return stdout;
}

/** The names of the test files in the order one process ran them. */
async function ranFiles(cwd: string, args: string[] = []): Promise<string[]> {
  const stdout = await bunTest(cwd, args);
  return stdout
    .split(/\r?\n/)
    .filter(line => line.startsWith("RAN "))
    .map(line => line.slice(4));
}

/** The names of the test files in the order of the list that `--parallel` workers take files from. */
async function parallelRunList(cwd: string, id: string, args: string[]): Promise<string[]> {
  const outfile = join(cwd, `${id}.xml`);
  await bunTest(cwd, ["--parallel=2", "--reporter=junit", `--reporter-outfile=${outfile}`, ...args]);
  const xml = await Bun.file(outfile).text();
  return [...xml.matchAll(/<testsuite name="([^"]+)\.test\.ts"/g)].map(m => m[1].replaceAll("\\", "/"));
}

// With no flag, the files of a directory run in path order: the byte order of their absolute paths.
const inPathOrder = ["apple", "lib/x", "test/B", "test/a", "test/a/b", "test/ab", "z"];
// Neither path order nor its reverse, for a file system that lists by creation.
const written = ["test/ab", "z", "test/a/b", "lib/x", "test/B", "apple", "test/a"];

describe.concurrent("file order", () => {
  test("the files of a directory run in path order", async () => {
    using dir = project("file-order", written);
    const cwd = String(dir);

    const [noFlag, parallel1, shard] = await Promise.all([
      ranFiles(cwd),
      ranFiles(cwd, ["--parallel=1"]),
      ranFiles(cwd, ["--shard=1/1"]),
    ]);
    expect({ noFlag, parallel1, shard }).toEqual({
      noFlag: inPathOrder,
      parallel1: inPathOrder,
      shard: inPathOrder,
    });
  });

  // https://github.com/oven-sh/bun/issues/18987
  test("numbered files in one directory run in that order", async () => {
    const numbered = ["01_seller", "02_product", "03_user", "04_order"].map(name => `__test__/${name}`);
    using dir = project("file-order-numbered", [numbered[2], numbered[0], numbered[3], numbered[1]]);

    expect(await ranFiles(String(dir))).toEqual(numbered);
  });

  test("path arguments run in argument order, and --shard starts from path order", async () => {
    const timings = Object.fromEntries(inPathOrder.map(name => [`${name}.test.ts`, name === "lib/x" ? 1000 : 1]));
    using dir = project("file-order-arguments", written, {
      "timings.json": JSON.stringify({ version: 1, files: timings }),
    });
    const cwd = String(dir);

    const [directories, files, parallel1, shard, shardByTime] = await Promise.all([
      ranFiles(cwd, ["./test", "./lib"]),
      ranFiles(cwd, ["./z.test.ts", "./apple.test.ts"]),
      ranFiles(cwd, ["--parallel=1", "./z.test.ts", "./apple.test.ts"]),
      ranFiles(cwd, ["--shard=1/1", "./test", "./lib"]),
      ranFiles(cwd, ["--shard=1/2", "--timings=timings.json", "./test", "./lib"]),
    ]);
    expect({ directories, files, parallel1, shard, shardByTime }).toEqual({
      // The files of each argument are in path order.
      directories: ["test/B", "test/a", "test/a/b", "test/ab", "lib/x"],
      files: ["z", "apple"],
      parallel1: ["z", "apple"],
      shard: ["lib/x", "test/B", "test/a", "test/a/b", "test/ab"],
      // The slow file is first in path order, so it is the whole first shard.
      shardByTime: ["lib/x"],
    });
  });
});

const seeded = Array.from({ length: 12 }, (_, i) => `test/f${String(i + 1).padStart(2, "0")}`);
const seededWritten = [7, 3, 11, 1, 9, 5, 12, 2, 10, 6, 4, 8].map(n => seeded[n - 1]);
// A seeded run shuffles the files from their path order, so one seed gives one order.
const seed1 = [11, 8, 4, 1, 3, 6, 5, 12, 7, 2, 9, 10].map(n => seeded[n - 1]);
const seed3 = [seeded[2], seeded[1], seeded[0]];
const threeFiles = seeded.slice(0, 3).map(name => `./${name}.test.ts`);

// Not concurrent: each run starts two workers.
test("--parallel workers take files from the list in path order, or shuffled from it with --seed", async () => {
  using dir = project("file-order-parallel", ["z", seeded[1], "apple", seeded[2], seeded[0]]);
  const cwd = String(dir);

  const [noSeed, forward, reversed] = await Promise.all([
    parallelRunList(cwd, "no-seed", ["./z.test.ts", "./apple.test.ts"]),
    parallelRunList(cwd, "forward", ["--seed=3", ...threeFiles]),
    parallelRunList(cwd, "reversed", ["--seed=3", ...threeFiles.toReversed()]),
  ]);
  expect({ noSeed, forward, reversed }).toEqual({ noSeed: ["apple", "z"], forward: seed3, reversed: seed3 });
});

describe.concurrent("file order with --seed", () => {
  test("gives one file order in two checkouts that created the files in another order", async () => {
    using one = project("file-order-seed-one", seeded);
    using two = project("file-order-seed-two", seeded.toReversed());

    const [first, second] = await Promise.all([
      ranFiles(String(one), ["--seed=1"]),
      ranFiles(String(two), ["--seed=1"]),
    ]);
    expect({ first, second }).toEqual({ first: seed1, second: seed1 });
  });

  test.each([
    { how: "with no path argument", args: ["--seed=1"] },
    { how: "with a directory argument", args: ["--seed=1", "./test"] },
    { how: "with --parallel=1", args: ["--seed=1", "--parallel=1"] },
    { how: "with the seed in bunfig.toml", args: [], bunfig: `[test]\nrandomize = true\nseed = 1\n` },
    { how: "with [test] root in bunfig.toml", args: ["--seed=1"], bunfig: `[test]\nroot = "test"\n` },
  ])("gives one file order $how", async ({ args, bunfig }) => {
    using dir = project("file-order-seed", seededWritten, bunfig ? { "bunfig.toml": bunfig } : {});

    expect(await ranFiles(String(dir), args)).toEqual(seed1);
  });

  test("gives one file order for the same file arguments in another order", async () => {
    using dir = project("file-order-seed-arguments", [seeded[1], seeded[2], seeded[0]]);
    const cwd = String(dir);

    const [forward, reversed] = await Promise.all([
      ranFiles(cwd, ["--seed=3", ...threeFiles]),
      ranFiles(cwd, ["--seed=3", ...threeFiles.toReversed()]),
    ]);
    expect({ forward, reversed }).toEqual({ forward: seed3, reversed: seed3 });
  });
});
