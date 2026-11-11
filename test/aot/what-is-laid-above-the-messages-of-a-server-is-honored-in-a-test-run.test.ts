import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

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

// Each program prints its answer once. All but one exit there. The one with the accessor under `method` closes its server: that ends a program,
// but a test that waits for ever holds the run until its limit. So the test waits for the answer alone. Its limit is for a program that never answers.
const runsTheProgram = `import { test } from "bun:test";
test("the program", async () => {
  await new Promise(answered => {
    const print = console.log;
    console.log = (...answer) => {
      print(...answer);
      answered();
    };
    require("./program.cjs");
  });
}, 60000);
`;
// It runs only behind a program that does not exit, and that program has answered by then.
const wouldAddName = `test("adds a name", () => {
  Object.prototype.madeUp = 1;
  delete Object.prototype.madeUp;
});
`;

// What `bun test` writes to stderr about a run in which no test fails: the name of the file, each test that passed, and the counts.
const ofARunThatPasses =
  /^(?:(?:usual|opened)\.test\.js:|\(pass\) .+| \d+ pass| 0 fail|Ran \d+ tests? across 1 file\. .+)$/;

async function outcomeOf(directory: string, file: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, file], directory, bunEnv);
  return {
    printed: stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test")),
    // The rest: a test that failed, an error, a warning of the build, the report of a crash.
    stderr: stderr.split("\n").filter(line => line !== "" && !ofARunThatPasses.test(line)),
    exitCode,
  };
}

describe.concurrent("what is laid above the messages of a server", () => {
  test.each(programs)("%s", async (program, answer) => {
    using dir = tempDir("laid-above-the-messages-of-a-server", {
      "program.cjs": await Bun.file(join(import.meta.dir, "parallel", "node-http", program)).text(),
      "usual.test.js": runsTheProgram,
      "opened.test.js": runsTheProgram + wouldAddName,
    });
    const plain = await outcomeOf(String(dir), "./usual.test.js");
    expect(plain).toEqual({ printed: [answer], stderr: [], exitCode: 0 });
    expect(await outcomeOf(String(dir), "./usual.test.js", "--aot")).toEqual(plain);
    expect(await outcomeOf(String(dir), "./opened.test.js", "--aot")).toEqual(plain);
  });
});
