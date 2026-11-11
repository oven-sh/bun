import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { basename, join } from "node:path";
import { limitOfARun, limitWithASAN } from "./harness/commands";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// A debug build of Bun needs about 165 s to compile one test run here, with one thread as with all of them, and with more than one thread its engine can crash
// in the build (#48169). So a debug build compiles with one thread, which makes the same program, and a case has time for its two compiled runs.
const env = isDebug ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "threads=1" } : bunEnv;
const limitOfACase = isDebug ? 1_200_000 : undefined;
// An inner run that hangs is killed there, and its exit code fails the case.
const limitOfAnInnerRun = isDebug ? 600_000 : isASAN ? limitWithASAN : limitOfARun;

// The short road of a server is taken only while nobody has laid an accessor above a server, a request or a response. An executable asks, and so does a test run.
// So does a test run one of whose tests adds a name to Object.prototype: there the road is also left for good once a name was added.
// Each row is a program and the one line that it prints under `bun test`.
const programs: [program: string, answer: string][] = [
  ["a-setter-above-responses-adds-listeners-inside-a-birth.cjs", "socket,handler,close,socket,handler,close"],
  ["a-setter-under-a-private-name-above-requests-sees-the-store.cjs", "undefined,true"],
  ["an-accessor-under-events-above-responses-gives-a-map-to-instances-alone.cjs", "socket,handler,socket,handler"],
  [
    "an-accessor-under-events-above-responses-gives-each-a-map-with-listeners.cjs",
    "socket,handler,prefinish,finish,close,|,socket,handler,prefinish,finish,close",
  ],
  ["an-accessor-under-events-above-responses-gives-one-map-for-all.cjs", "socket,handler,socket,handler"],
  [
    "an-accessor-under-method-above-requests-is-asked-in-front-of-the-servers-keep-alive.cjs",
    "method,keep method,keep",
  ],
  ["an-accessor-under-the-mark-of-captured-rejections-answers-in-turns.cjs", "false false"],
  ["an-accessor-under-the-mark-of-captured-rejections-is-asked-as-often-as-in-plain.cjs", "4"],
  ["an-accessor-under-the-state-above-requests-is-asked-as-often-as-in-plain.cjs", "=,get"],
];
// All but one of the programs exit where they have printed their answer. This one closes its server: that ends a program, but not a test run.
const closesItsServer = "an-accessor-under-method-above-requests-is-asked-in-front-of-the-servers-keep-alive.cjs";

// So the test waits for the answer alone, and its limit is for a program that never answers. The copy of the program prints through this module, which tells the test.
// No file of the run stores to `console.log`: the build would then compile Bun's library for tests that replace built-in functions, in both compiled runs.
const tellsTheAnswer = `const { promise, resolve } = Promise.withResolvers();
exports.given = promise;
exports.log = (...answer) => {
  console.log(...answer);
  resolve();
};
`;
const printsThroughIt = `const console = require("./answer.cjs");\n`;
const runsTheProgram = `import { test } from "bun:test";
test("the program", async () => {
  require("./program.cjs");
  await require("./answer.cjs").given;
}, 60000);
`;
// It runs only behind the program that does not exit, which has answered by then.
const wouldAddName = `test("adds a name", () => {
  Object.prototype.madeUp = 1;
  delete Object.prototype.madeUp;
});
`;

// What `bun test` writes to stderr about tests that passed, but for the name of the file and the times.
const passed = (...tests: string[]) => [
  ...tests.map(name => `(pass) ${name}`),
  ` ${tests.length} pass`,
  " 0 fail",
  `Ran ${tests.length} ${tests.length === 1 ? "test" : "tests"} across 1 file.`,
];

async function outcomeOf(directory: string, file: string, ...flags: string[]) {
  const inner = await run([bunExe(), "test", ...flags, file], directory, env, limitOfAnInnerRun);
  return {
    printed: inner.stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test")),
    stderr: inner.stderr
      .split("\n")
      .filter(line => line !== "" && line !== `${basename(file)}:`)
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode: inner.exitCode,
  };
}

describe.concurrent("what is laid above the messages of a server", () => {
  test.each(programs)(
    "%s",
    async (program, answer) => {
      using dir = tempDir("laid-above-the-messages-of-a-server", {
        "program.cjs":
          printsThroughIt + (await Bun.file(join(import.meta.dir, "parallel", "node-http", program)).text()),
        "answer.cjs": tellsTheAnswer,
        "usual.test.js": runsTheProgram,
        "opened.test.js": runsTheProgram + wouldAddName,
      });
      // A program that exits ends the run inside the first test, and `bun test` says nothing more. The other one lets each test pass.
      const ends = (...tests: string[]) => ({
        printed: [answer],
        stderr: program === closesItsServer ? passed(...tests) : [],
        exitCode: 0,
      });
      const plain = await outcomeOf(String(dir), "./usual.test.js");
      expect(plain).toEqual(ends("the program"));
      expect(await outcomeOf(String(dir), "./usual.test.js", "--aot")).toEqual(plain);
      expect(await outcomeOf(String(dir), "./opened.test.js", "--aot")).toEqual(ends("the program", "adds a name"));
    },
    limitOfACase,
  );
});
