import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim, featureNamed, model } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

const programs = [
  "files-that-load-as-host-objects-by-name",
  "data-files-by-computed-path",
  "code-computed-path-without-js-extension",
];

async function trimmed(name: string) {
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

describe.skipIf(!canTrim)("a trimmed executable loads what a whole one loads from a path computed at run time", () => {
  test.concurrent.each(programs)(
    "%s",
    async name => {
      using built = await trimmed(name);
      const { program, executable, names } = built;
      expect(names).not.toContain(featureNamed("DataFileLoaders"));

      const stdout =
        /\n\/\* Output:\n([^]*)\*\/\s*$/.exec(readFileSync(program + ".cjs", "utf8"))?.[1] ??
        (await run([bunExe(), program + ".cjs"])).stdout;
      expect(await run([executable])).toEqual({ stdout, stderr: "", exitCode: 0 });
    },
    120_000,
  );

  // The executables only run what was compiled into them: one that loads code from disk keeps the transpiler.
  for (const name of programs)
    test.failing(
      `${name} has no transpiler for code loaded at run time: RuntimeTranspiler stays, 1 feature for 0`,
      async () => {
        using built = await trimmed(name);
        expect(built.names).toContain(featureNamed("RuntimeTranspiler"));
      },
      120_000,
    );
});
