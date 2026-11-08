// A `require()` whose name is computed brings Bun's run-time `require` into the executable. That function also answers
// "bun:test", which must not keep the test runner in a program that never names it.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "../aot/harness/commands";
import { run } from "../aot/harness/run";
import { withoutDebugInformation } from "../aot/harness/without-debug-information";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { atLeastOnLinux, canTrim, featureNamed, model } from "./compile-trim-features";

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
  const built = await run(
    [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", "--trim", entry, "--outfile", executable],
    folder,
  );
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
  let dir: ReturnType<typeof tempDir> | undefined;
  afterAll(() => dir?.[Symbol.dispose]());
  let computed: ReturnType<typeof build> | undefined;
  const buildComputed = () =>
    (computed ??= build(String((dir = tempDir("compile-trim-computed-require", programs))), "computed.cjs"));
  const asksForTheTestRunner = async () => run([(await buildComputed()).executable, "bun:test"], String(dir));

  test.concurrent("the computed name keeps nothing of the test runner: what is reached", async () => {
    expect((await buildComputed()).removed.length).toBeGreaterThanOrEqual(atLeastOnLinux(92));
    expect(await asksForTheTestRunner()).toEqual({ stdout: "object\n", stderr: "", exitCode: 0 });
  });

  // A computed name brings the loader's own functions, and with them whatever they can load.
  test.concurrent.failing(
    "the computed name keeps nothing of the test runner: 3 features are kept, the goal is 0",
    async () => {
      expect((await buildComputed()).removed).toEqual(expect.arrayContaining(behindTheTestRunner));
    },
  );

  test.concurrent.failing("bun:test is not found under the computed name", async () => {
    expect(await asksForTheTestRunner()).toEqual({
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
