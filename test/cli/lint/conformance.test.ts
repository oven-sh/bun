import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

// The tests of ESLint, of typescript-eslint and of the plugins, more cases that the real ESLint has judged, and the tests of
// oxlint's own plugins, which oxlint has judged, run on `bun lint`. See conformance/README.md. `src/lint/conformance` runs
// them: it says what is compared.
//
// `conformance/expected*.txt` is what the runner prints: the cases that fail, one per line, and the totals.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample.
const isSample = isDebug || isASAN;

// Every n-th case that needs no types, and every n-th that does. One that does takes a thousand times as long, since a
// program is loaded for it: all 144,000 without types take 8 seconds of CPU time, the 8,200 of "upstream" with types 600.
// `expected*.txt` are written with [1, 1] and [1, 10].
const suites = [
  { suite: "upstream", expected: "expected.txt", every: isSample ? [50, 2000] : [1, 20] },
  { suite: "more", expected: "expected-more.txt", every: isSample ? [100, 5000] : [1, 200] },
  { suite: "oxlint", expected: "expected-oxlint.txt", every: isSample ? [50, 1] : [1, 1] },
];

let dir: ReturnType<typeof tempDir> | undefined;
let root = "";

beforeAll(async () => {
  if (!hasRunner) return;
  dir = tempDir("lint-conformance", {});
  root = realpathSync(String(dir));
  const bundle = await Bun.file(join(import.meta.dir, "conformance", "bundle.zst")).bytes();
  await Bun.write(join(root, "bundle.txt"), Bun.zstdDecompressSync(bundle));
});

afterAll(() => dir?.[Symbol.dispose]());

test.skipIf(!hasRunner).each(suites)(
  "$suite",
  async ({ suite, expected: file, every }) => {
    // Some cases are files of a project, which the runner writes there. The paths in them are those of POSIX.
    const projects = isWindows ? [] : [`--projects=${join(root, "projects")}`, "--extract", "--types"];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "lint",
        "--run-eslint-tests",
        join(root, "bundle.txt"),
        `--suite=${suite}`,
        ...projects,
        `--every=${every[0]}`,
        `--every-typed=${every[1]}`,
        `--threads=${Math.min(availableParallelism(), 8)}`,
      ],
      env: bunEnv,
      // Not where a `package.json` has a script `lint`.
      cwd: root,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = await Bun.file(join(import.meta.dir, "conformance", file)).text();

    // Nothing fails that is not known to.
    const known = new Set(expected.split("\n"));
    expect(stdout.split("\n").filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
    expect(stdout).toMatch(/\n[1-9]\d* cases passed, /);
    // No more is skipped than is known to be. A case that needs a rule of upstream's test file is only counted when it is run.
    const skipped = (text: string) => Number(/, (\d+) skipped\n/.exec(text)?.[1]);
    if (!isWindows) expect(skipped(stdout)).toBeLessThanOrEqual(skipped(expected));
    expect(exitCode).toBe(0);
  },
  10 * 60_000,
);
