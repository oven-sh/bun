import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim, featureNamed, model } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { describe, test } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

const programs = [
  "files-that-load-as-host-objects-by-name",
  "data-files-by-computed-path",
  "code-by-computed-path-without-js-extension",
  "code-by-computed-path-without-js-extension-with-eval",
];

// The executables only run what was compiled into them: one that loads code from disk keeps the transpiler.
describe.skipIf(!canTrim)("a trimmed executable loads what a whole one loads from a path computed at run time", () => {
  test.concurrent.each(programs)(
    "%s",
    async name => {
      const program = join(import.meta.dir, "programs", "closed-world", name);
      using dir = tempDir("aot-trim-data-files", {});
      const executable = join(String(dir), isWindows ? "program.exe" : "program");
      const built = await run([
        bunExe(),
        "build",
        "--compile",
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
      expect(names).toContain(featureNamed("RuntimeTranspiler"));
      expect(names).not.toContain(featureNamed("DataFileLoaders"));

      const stdout = existsSync(program + ".expected.txt")
        ? readFileSync(program + ".expected.txt", "utf8")
        : (await run([bunExe(), program + ".cjs"])).stdout;
      expect(await run([executable])).toEqual({ stdout, stderr: "", exitCode: 0 });
    },
    120_000,
  );
});
