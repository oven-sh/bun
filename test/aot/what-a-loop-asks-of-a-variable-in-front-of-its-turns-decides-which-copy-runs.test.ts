// A loop that is built twice reads some variables in front of its turns and asks each one thing: is it a whole number above zero, where the turns divide by it; a record of the one layout; one of a few
// functions; the one function of another file; a number, where the turns add to it. Who fails the question takes the loop as it is written.
// `fuzz/fuzzilli/write-variable-that-a-loop-uses-sweep.ts` writes programs whose variable holds something else when the loop begins. Here is one for each question. A counter says that the read was laid.
// `--aot-testing=WhatLoopsAskOfVariablesInFrontIsTakenToHold` sends both answers into the typed copy. Under `--aot-harden=proof-checks` what a test has let pass is asked again at run time: with both the
// program stops by name. `FailGuesses` stands beside the word on both sides: it lays a road of its own to the loop as written, which the word would leave without one.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "path";
import { slot, spawned, unsupported, withoutCrashReport } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const writer = join(import.meta.dir, "fuzz", "fuzzilli", "write-variable-that-a-loop-uses-sweep.ts");
const CHECKED = "--aot-harden=proof-checks";
const GUESSES = "FailGuesses:7:97";
const WORD = "WhatLoopsAskOfVariablesInFrontIsTakenToHold";
const letPass = "what a test has let pass is not of the type that the compiler has proven of it.";
const questions = {
  "a number that the turns divide by": {
    cell: "divides-the-turn--a-var--never-stored-in-front--for--a-second-of-its-kind-later.cjs",
    counter: "DivisorsInVariablesReadInFrontOfLoops",
    stops: letPass,
  },
  "a private static field that holds a record": {
    cell: "asked-by-an-if--a-private-static-field--never-stored-in-front--for-in-a-function--a-second-of-its-kind-later.mjs",
    counter: "VariablesAskedWhetherTheyAreThereReadInFrontOfLoops",
    stops: letPass,
  },
  "one of a few functions": {
    cell: "called--a-let--another-kind-in-front-and-its-own-in-the-turn--for-in-a-function-behind-its-caller--a-second-of-its-kind-later.cjs",
    counter: "FewClosuresInVariablesReadInFrontOfLoops",
    stops: letPass,
  },
  "the function of a file that has not run": {
    cell: "handed-on--a-name-of-the-exports-of-a-file-required-in-the-turn--stored-in-front--for--nothing-later.cjs",
    counter: "FunctionsOfOtherFilesReadInFrontOfLoops",
    stops: "what a variable holds is not of the type that the compiler has proven of it.",
  },
  "a number that the turns add to": {
    cell: "added-to--a-var--never-stored-in-front--for--nothing-later.cjs",
    counter: "VariablesThatQuietTurnsStoreReadInFrontOfLoops",
    stops: letPass,
  },
};

// A program is one text: `// @filename: ./tool.cjs` begins another file.
function laidOut(name: string, text: string) {
  const entry = "p" + name.slice(name.lastIndexOf("."));
  const files: Record<string, string[]> = { [entry]: [] };
  let into = files[entry];
  for (const line of text.split("\n")) {
    const next = /^\/\/ @filename: \.\/(\S+)/.exec(line);
    if (next) into = files[next[1]] ??= [];
    else into.push(line);
  }
  return { entry, files: Object.fromEntries(Object.entries(files).map(([file, all]) => [file, all.join("\n")])) };
}

describe.skipIf(!!unsupported)("what a loop asks of a variable in front of its turns", () => {
  for (const [question, { cell, counter, stops }] of Object.entries(questions)) {
    test(`decides which copy runs: ${question}`, () =>
      slot(async () => {
        using written = tempDir("aot-question-in-front-of-a-loop-cell", {});
        const wrote = await spawned(
          [bunExe(), writer, "named", `^${cell.replaceAll(".", "[.]")}$`, String(written), "1"],
          String(written),
          env,
        );
        expect(wrote.stdout.trim()).toBe("1");
        const [name] = readdirSync(String(written));
        const { entry, files } = laidOut(name, readFileSync(join(String(written), name), "utf8"));
        using dir = tempDir("aot-question-in-front-of-a-loop", files);
        const folder = String(dir);
        const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
        const build = (name: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation,
              CHECKED,
              ...flags,
              "./" + entry,
              "--outfile",
              name,
            ],
            folder,
            env,
          );
        const plain = await spawned([bunExe(), "./" + entry], folder, env);
        expect(plain.stdout).toContain("SAID");
        const counted = await build("right", `--aot-testing=${GUESSES}`, "--explain=statistics");
        expect(counted.exitCode).toBe(0);
        expect(counted.stderr).toMatch(new RegExp(`^\\s*${counter}\\s+[1-9]`, "m"));
        const right = await spawned([executable("right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({
          stdout: plain.stdout,
          exitCode: plain.exitCode,
        });
        expect((await build("held", `--aot-testing=${WORD},${GUESSES}`)).exitCode).toBe(0);
        const held = await spawned([executable("held")], folder, { ...env, ...withoutCrashReport });
        expect(held.stderr).toContain(stops);
        expect(held.exitCode).not.toBe(0);
      }));
  }
});
