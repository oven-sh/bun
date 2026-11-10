import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { describe, test } from "./supported";

raiseDefaultTimeout(240_000);

// The short road of a server is taken only while nobody has laid an accessor above a server, a request or a response. An executable asks, and so does a test run.
// So does a test run one of whose tests adds a name to Object.prototype: there the road is also left for good once a name was added.
const programs = [
  "a-setter-above-responses-adds-listeners-inside-a-birth.cjs",
  "a-setter-under-a-private-name-above-requests-sees-the-store.cjs",
  "an-accessor-under-events-above-responses-gives-a-map-to-instances-alone.cjs",
  "an-accessor-under-events-above-responses-gives-each-a-map-with-listeners.cjs",
  "an-accessor-under-events-above-responses-gives-one-map-for-all.cjs",
  "an-accessor-under-method-above-requests-is-asked-in-front-of-the-servers-keep-alive.cjs",
  "an-accessor-under-the-mark-of-captured-rejections-answers-in-turns.cjs",
  "an-accessor-under-the-mark-of-captured-rejections-is-asked-as-often-as-in-plain.cjs",
  "an-accessor-under-the-state-above-requests-is-asked-as-often-as-in-plain.cjs",
];

// Each program prints its answer and exits.
const runsTheProgram = `import { test } from "bun:test";
test("the program", async () => {
  require("./program.cjs");
  await new Promise(() => {});
}, 60000);
`;
const wouldAddName = `test("never reached", () => {
  Object.prototype.madeUp = 1;
  delete Object.prototype.madeUp;
});
`;

async function take(directory: string, file: string, ...flags: string[]) {
  const { stdout } = await run([bunExe(), "test", ...flags, file], directory, bunEnv);
  return stdout.split("\n").filter(line => line !== "" && !line.startsWith("bun test"));
}

describe.concurrent("what is laid above the messages of a server", () => {
  test.each(programs)("%s", async program => {
    using dir = tempDir("laid-above-the-messages-of-a-server", {
      "program.cjs": await Bun.file(join(import.meta.dir, "parallel", "node-http", program)).text(),
      "usual.test.js": runsTheProgram,
      "opened.test.js": runsTheProgram + wouldAddName,
    });
    const plain = await take(String(dir), "./usual.test.js");
    expect(plain.length).toBeGreaterThan(0);
    expect(await take(String(dir), "./usual.test.js", "--aot")).toEqual(plain);
    expect(await take(String(dir), "./opened.test.js", "--aot")).toEqual(plain);
  });
});
