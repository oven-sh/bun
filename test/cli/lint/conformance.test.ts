import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

// The tests of ESLint, of typescript-eslint and of the plugins, run on `bun lint`. See conformance/README.md.
// `src/lint/conformance` runs them: it says what is compared.
//
// `conformance/expected.txt` is what the runner prints: the cases that fail, one per line, and the totals.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample. A case that needs types takes a
// hundred times as long as one that does not: a program is loaded for it.
const isSample = isDebug || isASAN;
const [every, everyTyped] = isSample ? [50, 400] : [1, 1];

test.skipIf(!hasRunner)(
  "the tests of ESLint, typescript-eslint and the plugins",
  async () => {
    using dir = tempDir("lint-conformance", {});
    const root = realpathSync(String(dir));
    const bundle = join(root, "bundle.txt");
    await Bun.write(bundle, Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, "conformance", "bundle.zst")).bytes()));
    // Some cases are files of a project, which the runner writes there. The paths in them are those of POSIX.
    const projects = isWindows ? [] : [`--projects=${join(root, "projects")}`, "--extract", "--types"];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "lint",
        "--run-eslint-tests",
        bundle,
        ...projects,
        `--every=${every}`,
        `--every-typed=${everyTyped}`,
        `--threads=${Math.min(availableParallelism(), 8)}`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = await Bun.file(join(import.meta.dir, "conformance", "expected.txt")).text();

    if (isSample || isWindows) {
      // Nothing fails that is not known to.
      const known = new Set(expected.split("\n"));
      expect(stdout.split("\n").filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
      expect(stdout).toMatch(/\n[1-9]\d* cases passed, /);
    } else {
      expect(stdout).toBe(expected);
    }
    expect(exitCode).toBe(0);
  },
  10 * 60_000,
);
