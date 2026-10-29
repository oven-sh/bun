import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Each program asks something about the `Bun` object without reading Bun.Glob, then imports the class from "bun" and uses it.
const questions = [
  `Object.hasOwn(Bun, "Glob")`,
  `Object.getOwnPropertyNames(Bun).includes("Glob")`,
  `Object.seal(Bun) === Bun`,
  `["Gl", "ob"].join("") in Bun`,
];

if (!canTrim)
  console.error("SKIPPED: trim-keeps-a-class-imported-from-bun.test.ts: this build of Bun doesn't support --trim");

describe.skipIf(!canTrim)('--trim keeps a class that the program imports from "bun"', () => {
  test.concurrent.each(questions)(
    "after %s",
    async question => {
      using dir = tempDir("aot-trim-class-imported-from-bun", {
        "program.mjs": `console.log(${question});
const { Glob } = await import("bun");
console.log(new Glob("*.js").match("a.js"));
`,
      });
      const folder = String(dir);
      const buildAndRun = async (name: string, flags: string[]) => {
        const executable = join(folder, isWindows ? `${name}.exe` : name);
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", ...flags, "program.mjs", "--outfile", executable],
          folder,
        );
        expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        return await run([executable], folder);
      };
      const expected = { stdout: "true\ntrue\n", stderr: "", exitCode: 0 };
      expect(await run([bunExe(), "run", "program.mjs"], folder)).toEqual(expected);
      expect(await buildAndRun("whole", [])).toEqual(expected);
      expect(await buildAndRun("trimmed", ["--trim"])).toEqual(expected);
    },
    120_000,
  );
});
