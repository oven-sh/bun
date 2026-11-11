// A loop that is built twice reads some variables in front of its turns and asks each one thing: is it a whole number above zero, where the turns divide by it; a record of the one layout; one of a few
// functions; the one function of another file; a number, where the turns add to it. Who fails the question takes the loop as it is written.
// `fuzz/fuzzilli/write-variable-that-a-loop-uses-sweep.ts` writes programs whose variable holds something else when the loop begins. Here is one for each question. A counter says that the read was laid.
// `--aot-testing=IgnoreVariableChecks` sends both answers into the typed copy. Under the run-time words of `--aot-harden=proof-checks` what a test has let pass is asked again at run time: with both the
// program stops by name. `FailSpeculations` stands beside the word on both sides: it lays a road of its own to the loop as written, which the word would leave without one.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "path";
import { built, slot, spawned, withoutCrashReport } from "./harness/commands";
import { expectFaultyBuild } from "./harness/fault-injection";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test, testOneByOne } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
// What --aot-harden=proof-checks lays into the program. The name also runs the compiler's verifier, which refuses the build with the fault.
const CHECKED =
  "--aot-testing=CheckProofsAtRunTime,DisableFrameCells,CheckHoistedCallsAtRunTime,CheckResultFreshnessAtRunTime";
const GUESSES = "FailSpeculations:7:97";
const WORD = "IgnoreVariableChecks";
const refusal = "a Narrowed stands in a block that has not exactly one incoming edge";

// The comment above a program is its name in that writer, and the text is what the writer writes under the name. The writer finds a name by writing every program in front of it: some hundred thousand
// for two of these, which takes minutes with a sanitizer. So the texts stand here, and the first file of a program is its entry. `says` is what the program prints. `stops` is what the program with
// the word says of the value that it found.
const questions = {
  "a number that the turns divide by": {
    // divides-the-turn--a-var--never-stored-in-front--for--a-second-of-its-kind-later.cjs
    files: {
      "p.cjs": `var held;
let total = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  total = total * 3 + (turn % held);
}
console.log("SAID end " + total);
(held = Number("3"));
console.log("SAID holds " + typeof held);
function peek() {
  return held;
}
`,
    },
    says: "SAID end NaN\nSAID holds number\n",
    counter: "DivisorVariableReadsHoisted",
    stops: "expected int32, found an unexpected value in a value narrowed by a branch",
  },
  "a private static field that holds a record": {
    // asked-by-an-if--a-private-static-field--never-stored-in-front--for-in-a-function--a-second-of-its-kind-later.mjs
    files: {
      "p.mjs": `class Box {
  static #held;
  static lay(value) {
    Box.#held = value;
  }
  static peek() {
    return Box.#held;
  }
  static work() {
    let total = 0;
    for (let turn = 0; turn < Number("3"); turn++) {
      if (Box.#held) total = total * 3 + (Box.#held.step);
      else total = total * 3 + (-1);
    }
    return total;
  }
  static attempt() {
    try {
      return Box.work();
    } catch (error) {
      return error.constructor.name;
    }
  }
  static first = Box.attempt();
}
console.log("SAID first " + Box.first);
Box.lay({ step: 9 });
console.log("SAID second " + Box.attempt());
console.log("SAID holds " + typeof Box.peek());
`,
    },
    says: "SAID first -13\nSAID second 117\nSAID holds object\n",
    counter: "AbsenceTestedVariableReadsHoisted",
    stops: "expected object, found undefined in a value narrowed by a branch",
  },
  "one of a few functions": {
    // called--a-let--another-kind-in-front-and-its-own-in-the-turn--for-in-a-function-behind-its-caller--a-second-of-its-kind-later.cjs
    files: {
      "p.cjs": `let held;
(held = 7);
function work() {
  let total = 0;
  for (let turn = 0; turn < Number("3"); turn++) {
    (held = turn => turn + 10);
    total = total * 3 + (held(turn));
  }
  return total;
}
function attempt() {
  try {
    return work();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("SAID first " + attempt());
(held = turn => turn * 2);
console.log("SAID second " + attempt());
console.log("SAID holds " + typeof held);
function peek() {
  return held;
}
`,
    },
    says: "SAID first 135\nSAID second 135\nSAID holds function\n",
    counter: "CalleeVariableReadsHoisted",
    stops: "expected object, found int32 in a value narrowed by a branch",
  },
  "the function of a file that has not run": {
    // handed-on--a-name-of-the-exports-of-a-file-required-in-the-turn--stored-in-front--for--nothing-later.cjs
    files: {
      "p.cjs": `function apply(given, value) {
  return typeof given === "function" ? given(value) : -2;
}
let total = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  const tool = require("./tool.cjs");
  total = total * 3 + (apply(tool.held, turn));
}
console.log("SAID end " + total);
console.log("SAID holds " + typeof require("./tool.cjs").held);`,
      "tool.cjs": `exports.lay = value => {
  exports.held = value;
};
(exports.held = turn => turn + 10);
`,
    },
    says: "SAID end 135\nSAID holds function\n",
    counter: "ImportedFunctionReadsHoisted",
    stops: "found undefined in a local variable",
  },
  "a number that the turns add to": {
    // added-to--a-var--never-stored-in-front--for--nothing-later.cjs
    files: {
      "p.cjs": `var held;
let total = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  (held = held + turn);
  total = total * 3 + (held);
}
console.log("SAID end " + total);
console.log("SAID holds " + typeof held);
function peek() {
  return held;
}
`,
    },
    says: "SAID end NaN\nSAID holds number\n",
    counter: "LoopStoredVariableReadsHoisted",
    stops: "expected integer, found an unexpected value in a value narrowed by a branch",
  },
};

// Which of the five questions a build has laid in front of a loop. A line of `--explain=statistics` is the name of a counter and its number.
const asked = (statistics: string) =>
  Object.values(questions)
    .map(({ counter }) => counter)
    .filter(counter => new RegExp(`^\\s*${counter}\\s+[1-9]`, "m").test(statistics));

// One by one on a debug build: an executable is more than a GB there. One at a time stays in memory until its case removes it. Five at once wait for the disk, and a slow disk then holds a build past
// its limit.
const declare = isDebug ? testOneByOne : test;

describe("what a loop asks of a variable in front of its turns", () => {
  for (const [question, { files, says, counter, stops }] of Object.entries(questions)) {
    declare(`decides which copy runs: ${question}`, async () => {
      using dir = tempDir("aot-question-in-front-of-a-loop", files);
      const folder = String(dir);
      const entry = "./" + Object.keys(files)[0];
      const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
      // A command waits for a processor of its own. The run under plain Bun and the three builds wait for nothing else.
      const command = async (cmd: string[], more?: Record<string, string>) => {
        const { stdout, stderr, exitCode } = await slot(() => spawned(cmd, folder, { ...env, ...more }));
        return { stdout, stderr, exitCode };
      };
      const build = async (name: string, ...flags: string[]) => {
        const { stderr, exitCode } = await command([
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...withoutDebugInformation,
          CHECKED,
          ...flags,
          entry,
          "--outfile",
          name,
        ]);
        return { stderr, exitCode, wrote: existsSync(executable(name)) };
      };
      const [plain, counted, refused, faulty] = await Promise.all([
        command([bunExe(), entry]),
        build("right", `--aot-testing=${GUESSES}`, "--explain=statistics"),
        build("refused", "--aot-harden=proof-checks", `--aot-testing=${WORD},${GUESSES}`),
        build("held", `--aot-testing=${WORD},${GUESSES}`),
      ]);

      const printed = { stdout: says, stderr: "", exitCode: 0 };
      expect(plain).toEqual(printed);
      built(counted);
      expect(asked(counted.stderr)).toEqual([counter]);
      expect(await command([executable("right")])).toEqual(printed);

      // The verifier ends the build before an executable is written.
      expect(refused).toEqual({ stderr: expect.stringContaining(refusal), exitCode: 1, wrote: false });
      // A Bun with assertions verifies every build, so it refuses this one too. A release Bun writes the executable.
      const runs = expectFaultyBuild(faulty, refusal);
      expect(faulty.wrote).toBe(runs);
      if (!runs) return;
      const held = await command([executable("held")], withoutCrashReport);
      // The program stops before it prints its first line.
      const [at, found] = held.stderr.split("\n");
      expect({ stdout: held.stdout, at, found }).toEqual({
        stdout: "",
        at: expect.stringMatching(/^bun: internal AOT error: type check failed at \S+:\d+:\d+/),
        found: "  " + stops,
      });
      expect(held.exitCode).not.toBe(0);
    });
  }
});
