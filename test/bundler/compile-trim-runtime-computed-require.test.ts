// A `require()` whose name is computed brings Bun's run-time `require` into the executable. That function also answers
// "bun:test", which must not keep the test runner in a program that never names it.
import { describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, featureNamed, model } from "./compile-trim-features";

const programs = {
  "computed.cjs": `
    try {
      console.log(typeof require(process.argv[2]));
    } catch (error) {
      console.log(error.code + ": " + error.message);
    }
  `,
  "named.cjs": `
    const named = require("bun:test");
    console.log(typeof named.test, named === require(process.argv[2]), Object.keys(require.cache).includes("bun:test"));
  `,
};

const behindTheTestRunner = ["Test", "RuntimeTranspiler", "DeepEquals"].map(featureNamed);

async function build(folder: string, entry: string) {
  const executable = join(folder, entry.replace(".cjs", isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "--trim", entry, "--outfile", executable], folder);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const removed = readRemovedFeatures(executable);
  if (removed === undefined) throw new Error(`${executable} has no list of removed features`);
  const names = model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
  return { executable, removed: names };
}

describe.skipIf(!canTrim || !!unsupported)("--compile --aot --trim: require() of a computed name and bun:test", () => {
  test.concurrent("the computed name keeps nothing of the test runner, and bun:test is not found", async () => {
    using dir = tempDir("compile-trim-computed-require", programs);
    const folder = String(dir);
    const { executable, removed } = await build(folder, "computed.cjs");
    expect(removed).toEqual(expect.arrayContaining(behindTheTestRunner));
    expect(await run([executable, "bun:test"], folder)).toEqual({
      stdout:
        "MODULE_NOT_FOUND: Cannot load 'bun:test': it isn't in this executable. Import it by name somewhere in your program to keep it.\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a program that names bun:test keeps it, for a computed name too", async () => {
    using dir = tempDir("compile-trim-named-require", programs);
    const folder = String(dir);
    const { executable, removed } = await build(folder, "named.cjs");
    expect(removed).not.toContain(featureNamed("Test"));
    expect(await run([executable, "bun:test"], folder)).toEqual({
      stdout: "function true false\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
