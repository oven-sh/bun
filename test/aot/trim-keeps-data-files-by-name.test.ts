import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atLeastOnLinux, canTrim, featureNamed, model } from "../bundler/compile-trim-features";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

const featuresLeftOutToday = {
  "files-that-load-as-host-objects-by-name": 84,
  "data-files-by-computed-path": 83,
  "code-computed-path-without-js-extension": 86,
};
const programs = Object.keys(featuresLeftOutToday);

async function build(name: string) {
  const program = join(import.meta.dir, "parallel", "closed-world", name);
  const dir = tempDir("aot-trim-data-files", {});
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    ...withoutDebugInformation,
    "--aot",
    "--trim",
    "--aot-refuse-code-from-disk",
    program + ".cjs",
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const removed = readRemovedFeatures(executable) ?? [];
  const names = model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
  return { program, executable, names, [Symbol.dispose]: () => dir[Symbol.dispose]() };
}

const builds = new Map<string, ReturnType<typeof build>>();
const trimmed = (name: string) => builds.getOrInsertComputed(name, build);
afterAll(async () => {
  for (const built of await Promise.allSettled(builds.values()))
    if (built.status === "fulfilled") built.value[Symbol.dispose]();
});

describe.skipIf(!canTrim)("a trimmed executable loads what a whole one loads from a path computed at run time", () => {
  test.concurrent.each(programs)(
    "%s",
    async name => {
      const { program, executable, names } = await trimmed(name);
      expect(names).not.toContain(featureNamed("DataFileLoaders"));

      const stdout =
        /\n\/\* Output:\n([^]*)\*\/\s*$/.exec(readFileSync(program + ".cjs", "utf8"))?.[1] ??
        (await run([bunExe(), program + ".cjs"])).stdout;
      expect(await run([executable])).toEqual({ stdout, stderr: "", exitCode: 0 });
    },
    120_000,
  );

  // The executables only run what was compiled into them: one that loads code from disk keeps the transpiler.
  for (const [name, leftOutToday] of Object.entries(featuresLeftOutToday)) {
    test(`${name} has no transpiler for code loaded at run time: what is reached`, async () => {
      expect((await trimmed(name)).names.length).toBeGreaterThanOrEqual(atLeastOnLinux(leftOutToday));
    }, 120_000);
    test.failing(
      `${name} has no transpiler for code loaded at run time: RuntimeTranspiler stays, 1 feature for 0`,
      async () => {
        expect((await trimmed(name)).names).toContain(featureNamed("RuntimeTranspiler"));
      },
      120_000,
    );
  }
});
