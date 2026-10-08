import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { collect, concatenate } from "./bundle.ts";

// The tests of Prettier and of oxfmt, and inputs of our own, run on `bun format`. See the README.md of prettier, oxfmt and own.
// `src/format/conformance` runs them: it says what is checked, and what is left out and why.
//
// `<suite>/expected.txt` is what the runner prints: the checks that fail, one per line, and the totals.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample.
const every = isDebug || isASAN ? 20 : 1;

/** `own/cases`, in the form of oxfmt's tests. An input has `.input` after its name, so that nothing else takes it for code. */
function ownCases() {
  const found = new Map<string, Uint8Array>();
  collect(join(import.meta.dir, "own"), "cases", found, name => name.endsWith(".todo"));
  return concatenate(new Map([...found].map(([name, bytes]) => [name.replace(/\.input$/, ""), bytes])));
}

test.skipIf(!hasRunner).concurrent.each([
  ["prettier", "prettier", every],
  ["oxfmt", "oxfmt", every],
  ["own", "oxfmt", 1],
])(
  "%s",
  async (suite, runner, every) => {
    using dir = tempDir(`format-${suite}`, {});
    const bundle = join(String(dir), "bundle.txt");
    await Bun.write(bundle, suite === "own" ? ownCases() : Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, suite, "bundle.zst")).bytes()));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "format", `--run-${runner}-tests`, bundle, `--every=${every}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // Of our own inputs none fails.
    const expected = suite === "own" ? "" : await Bun.file(join(import.meta.dir, suite, "expected.txt")).text();

    if (every === 1 && suite !== "own") {
      expect(stdout).toBe(expected);
    } else {
      // Nothing fails that is not known to.
      const known = new Set(expected.split("\n"));
      expect(stdout.split("\n").filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
      // And something has run.
      expect(stdout).toMatch(/^(?:format|as Prettier prints them): [1-9]/m);
    }
    expect(exitCode).toBe(0);
  },
  5 * 60_000,
);
