// Random programs of CommonJS and ES modules. `python3 three-ways/made/<script>.py <seed> <folder>` writes one into the folder,
// and the same seed always writes the same program. The top of each generator says what its programs are about. Each program is run by
// plain Bun and built with --aot, and the two must print the same.
//
// Passed over, and counted:
//   - a program of the first two generators whose entry point is an ES module: it imports several CommonJS files, which `bun run` runs in
//     the order in which its loader finished fetching them, and the executable in the order of the import statements;
//   - a program in which a module throws while it runs: what a later `require` of it does differs on purpose.
//
//   AOT_STATIC_MODULES_SEEDS=<first>:<count>    other seeds than the first ones
//   AOT_STATIC_MODULES_GENERATOR=<text>         only the generators whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned, told, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const python = Bun.which("python3");
if (!python) console.error("SKIPPED: test/aot/static-modules-generated.test.ts: python3 is not installed");

const generators: { name: string; script: string; takesEsEntryPoints: boolean; seeds: number }[] = [
  { name: "exports-and-cycles", script: "random-commonjs-and-esm", takesEsEntryPoints: false, seeds: 80 },
  { name: "hooks-and-dead-zones", script: "random-commonjs-and-esm-with-hooks", takesEsEntryPoints: false, seeds: 80 },
  { name: "namespaces-as-values", script: "random-esm-namespace-as-value", takesEsEntryPoints: true, seeds: 30 },
];

const [first, count] = (process.env.AOT_STATIC_MODULES_SEEDS ?? "").split(":").map(Number);
const only = process.env.AOT_STATIC_MODULES_GENERATOR;
const countOf = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

for (const { name, script, takesEsEntryPoints, seeds } of generators) {
  if (only && !name.includes(only)) continue;
  describe.concurrent(`compile/aot/static-modules-generated/${name}`, () => {
    if (!python) return void test.skip("python3 is not installed", () => {});
    for (let seed = first || 0; seed < (first || 0) + (count || seeds); seed++) {
      test(
        `seed ${seed}`,
        () =>
          slot(async () => {
            using directory = tempDir("aot-static-modules-generated", {});
            const folder = join(String(directory), "program");
            const generated = await spawned(
              [python!, "-B", join(import.meta.dir, "three-ways", "made", `${script}.py`), String(seed), folder],
              String(directory),
              { ...process.env, PYTHONUTF8: "1" },
            );
            expect({ stderr: generated.stderr, exitCode: generated.exitCode }).toEqual({ stderr: "", exitCode: 0 });
            const entry = existsSync(join(folder, "main.mjs")) ? "main.mjs" : "main.js";
            if (entry === "main.mjs" && !takesEsEntryPoints)
              return void console.log(`${name} ${seed}: passed over: the entry point is an ES module`);

            const plain = await spawned([bunExe(), "run", entry], folder, bunEnv);
            if (
              plain.exitCode !== 0 ||
              countOf(plain.stdout, /^m\d+ starts$/gm) !== countOf(plain.stdout, /^m\d+ ends$/gm)
            )
              return void console.log(`${name} ${seed}: passed over: a module throws`);

            const executable = join(String(directory), isWindows ? "compiled.exe" : "compiled");
            built(
              await spawned(
                [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), entry, "--outfile", executable],
                folder,
                bunEnv,
              ),
            );
            const compiled = await spawned([executable], folder, bunEnv);
            expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
          }),
        600_000,
      );
    }
  });
}
