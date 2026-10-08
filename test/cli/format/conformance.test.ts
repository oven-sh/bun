import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

// The tests of Prettier and of oxfmt, run on `bun format`. See prettier/README.md and oxfmt/README.md.
// `src/format/conformance` runs them: it says what is checked, and what is left out and why.
//
// `<suite>/expected.txt` is what the runner prints: the checks that fail, one per line, and the totals.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample.
const every = isDebug || isASAN ? 20 : 1;

test.skipIf(!hasRunner).concurrent.each(["prettier", "oxfmt"])(
  "%s's tests",
  async suite => {
    using dir = tempDir(`format-${suite}`, {});
    const bundle = join(String(dir), "bundle.txt");
    await Bun.write(bundle, Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, suite, "bundle.zst")).bytes()));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "format", `--run-${suite}-tests`, bundle, `--every=${every}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = await Bun.file(join(import.meta.dir, suite, "expected.txt")).text();

    if (every === 1) {
      expect(stdout).toBe(expected);
    } else {
      // Nothing fails that is not known to.
      const known = new Set(expected.split("\n"));
      expect(stdout.split("\n").filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
    }
    expect(exitCode).toBe(0);
  },
  5 * 60_000,
);
