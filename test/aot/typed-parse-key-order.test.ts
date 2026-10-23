import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "./analysis-scaling/measure-check";
import { withSteadyCollections } from "./harness/counted-run";
import { slot, spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const root = join(import.meta.dir, "typed-parse-key-order");

// The program, what a round adds to the number it prints, and the texts it parses in a round.
const programs = [
  { title: "a type of which the program makes objects", file: "orders.ts", sumOfRound: 22, parsesInRound: 4 },
  { title: "a type of which the program makes no object", file: "bodies.ts", sumOfRound: 106.5, parsesInRound: 1 },
];

describe.skipIf(isDebug || isASAN || isWindows)("compile/aot/typed-parse-key-order", () => {
  test.each(programs)(
    "a typed JSON.parse is no slower for keys in declaration order than in alphabetical order: $title",
    ({ file, sumOfRound, parsesInRound }) =>
      slot(async () => {
        const folder = String(tempDir("aot-typed-parse-key-order", {}));
        const executable = join(folder, "parses");
        try {
          const build = await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation(),
              join(root, file),
              "--outfile",
              executable,
            ],
            root,
            bunEnv,
          );
          expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
            stderr: expect.not.stringMatching(/^error\b/m),
            exitCode: 0,
          });

          const env = { ...bunEnv, ...withSteadyCollections };
          const [few, many] = [1000, 6000];
          const instructionsPerParse: Record<string, number> = {};
          for (const keyOrder of ["declared", "sorted"]) {
            const costs: number[] = [];
            for (const rounds of [few, many]) {
              const run = await measureCommand(root, [executable, keyOrder, String(rounds)], 300_000, env);
              expect(run.stdout.trim()).toBe(String(rounds * sumOfRound));
              if (run.instructions === undefined)
                return void console.error("SKIPPED: instructions cannot be counted here");
              costs.push(run.instructions);
            }
            instructionsPerParse[keyOrder] = Math.round((costs[1] - costs[0]) / ((many - few) * parsesInRound));
          }
          console.error(
            `TYPED PARSE\t${file}\tdeclared ${instructionsPerParse.declared}\tsorted ${instructionsPerParse.sorted}`,
          );
          expect(instructionsPerParse.declared).toBeLessThan(instructionsPerParse.sorted * 1.1);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      }),
    900_000,
  );
});
