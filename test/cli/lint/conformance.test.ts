import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// Runs `bun lint` on the test suites of ESLint, typescript-eslint and the plugins, on extra cases recorded with real
// ESLint, and on the tests of oxlint's own plugins, recorded with oxlint. See conformance/README.md. The runner is
// `src/lint/conformance`, which documents what's compared.
//
// `conformance/expected*.txt` is the runner's output: one line per failing case, then the totals.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample, always the same one.
const isSample = isDebug || isASAN;

// `every` is [n, m]: run every n-th untyped case and every m-th typed case. A typed case loads a program, so it takes a
// thousand times as long: all 144,000 untyped cases take 8 seconds of CPU time, and the 8,200 typed cases in "upstream"
// take 600. `expected*.txt` are written with [1, 1] and [1, 10].
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
  "the $suite suite has no new failures",
  async ({ suite, expected: file, every }) => {
    // Some cases are files in a project, which the runner extracts to this directory. Their paths are POSIX paths.
    const projects = isWindows ? [] : [`--projects=${join(root, "projects")}`, "--extract", "--types"];
    await using proc = spawn({
      timeout: 9 * 60_000,
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
      // A directory whose `package.json` has a `lint` script would run that script instead.
      cwd: root,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = await Bun.file(join(import.meta.dir, "conformance", file)).text();

    // Every failure is a known one.
    const known = new Set(expected.split("\n"));
    expect(stdout.split("\n").filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
    expect(stdout).toMatch(/\n[1-9]\d* cases passed, /);
    // No more cases are skipped than expected. A case that needs a rule defined in upstream's test file only counts as
    // skipped if the sample includes it.
    const skipped = (text: string) => Number(/, (\d+) skipped\n/.exec(text)?.[1]);
    if (!isWindows) expect(skipped(stdout)).toBeLessThanOrEqual(skipped(expected));
    // No more messages are missing oxlint's help text than expected.
    const missingHelp = (text: string) => Number(/\n(\d+) messages lack the help/.exec(text)?.[1] ?? 0);
    expect(missingHelp(stdout)).toBeLessThanOrEqual(missingHelp(expected));
    // No more cases report their messages in a different order from the original than expected.
    const reordered = (text: string) => Number(/\n(\d+) cases have their messages in another order/.exec(text)?.[1]);
    expect(reordered(stdout)).toBeLessThanOrEqual(reordered(expected));
    // --fix doesn't hold back an upstream fix in more cases than expected. Each one is held back because it changes the
    // program's behavior.
    const heldBackFixes = (text: string) =>
      Number(/\n(\d+) cases have a fix that --fix holds back/.exec(text)?.[1] ?? 0);
    expect(heldBackFixes(stdout)).toBeLessThanOrEqual(heldBackFixes(expected));
    expect(exitCode).toBe(0);
  },
  10 * 60_000,
);
