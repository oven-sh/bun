// Ten generators in test/aot/fuzz write small, dense functions. Machines run them by the million. This is their small edition: a few
// programs of each, built as executables and compared with plain Bun. In the first three lists all but the last seed once gave another
// answer or ended in a trap, and so did every seed of the last five lists, or it stopped the compiler. The programs of the fourth and fifth
// lists never did: each of them answers something else when a condition that an optimization rests on is switched off in the build, so it
// reaches that optimization.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { generate as aStoreThroughASecondName } from "./fuzz/a-store-through-a-second-name-between-two-reads";
import { generate as countersPastInt32 } from "./fuzz/counters-past-int32-over-typed-arrays";
import { generate as fractionsAndNegativeZero } from "./fuzz/fractions-and-negative-zero-carried-through-counted-loops";
import { generate as functionsPutAway } from "./fuzz/functions-put-away-read-back-and-called";
import { generate as localsThatChangeTheirKind } from "./fuzz/locals-that-change-their-kind-compared-in-loops";
import { generate as objectsOfSeveralConstructors } from "./fuzz/objects-of-several-constructors-met-at-a-choice";
import { Random } from "./fuzz/random";
import { generate as straightLoops } from "./fuzz/straight-loops-over-typed-arrays";
import { generate as whatNeverHappens } from "./fuzz/what-never-happens";
import { generate as wholeNumbers } from "./fuzz/whole-numbers-carried-through-counted-loops";
import { generate as wordsHeld } from "./fuzz/words-held-over-the-turns-of-a-loop";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const editions = [
  ["whole numbers carried through counted loops", wholeNumbers, [227, 432, 671, 681, 711, 1170, 2]],
  ["counters past int32 over typed arrays", countersPastInt32, [680, 720, 1148, 1]],
  ["objects of several constructors met at a choice", objectsOfSeveralConstructors, [2, 12, 48, 70, 196, 216, 1]],
  ["fractions and negative zero carried through counted loops", fractionsAndNegativeZero, [1, 3, 8, 10, 13]],
  ["straight loops over typed arrays", straightLoops, [1, 2, 5, 63, 100, 108]],
  ["what never happens", whatNeverHappens, [8, 41, 76, 86, 104, 198]],
  ["words held over the turns of a loop", wordsHeld, [2, 3, 6, 8, 9, 37]],
  ["functions put away, read back and called", functionsPutAway, [2, 7, 17, 23, 45, 52, 57]],
  ["a store through a second name between two reads", aStoreThroughASecondName, [1, 7, 12, 23, 60, 120, 147]],
  ["locals that change their kind, compared in loops", localsThatChangeTheirKind, [54, 62, 150, 234, 238, 384]],
] as const;

for (const [family, generate, seeds] of editions)
  for (const seed of seeds)
    test.concurrent(`${family}: program ${seed} answers as plain Bun`, async () => {
      const typed = seed % 2 === 1;
      const file = typed ? "main.ts" : "main.js";
      using dir = tempDir("small-generated-functions", { [file]: generate(new Random(seed), typed) });
      const root = realpathSync(String(dir));
      const executable = join(root, "program");
      built(await spawned([bunExe(), "build", "--compile", "--aot", file, "--outfile", executable], root, bunEnv));
      const plain = await spawned([bunExe(), file], root, bunEnv);
      const compiled = await spawned([executable], root, bunEnv);
      expect(plain.stdout).toContain("k0 ");
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    });
