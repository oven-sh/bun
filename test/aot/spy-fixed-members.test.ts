// spyOn() replaces a member by force, whatever its attributes say. Compiled code takes the `prototype` of a built-in class, and a constant such as WebSocket.OPEN,
// for what the realm was created with, also where the class itself is not locked. Such a spy is refused aloud, as one on Math.PI is: it once ended the whole run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const ways = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const;

const cases = {
  "the prototype object of a class": ["EventTarget", "prototype", "typeof EventTarget.prototype", "object object"],
  "a constant of a class": ["WebSocket", "OPEN", "WebSocket.OPEN", "1 1"],
  "a class under a computed name": [
    `(globalThis as any)[["Event", "Target"].join("")]`,
    "prototype",
    "typeof EventTarget.prototype",
    "object object",
  ],
  "a class below a namespace under a computed name": [
    `(Intl as any)[["Coll", "ator"].join("")]`,
    "prototype",
    "typeof Intl.Collator.prototype",
    "object object",
  ],
};

const testFile = (head: string, holder: string, key: string, read: string) => `
import { test, vi } from "bun:test";
${head}
test("a", () => {
  let threw = "no";
  try {
    vi.spyOn(${holder} as any, ${JSON.stringify(key)}, "get").mockReturnValue("spied");
  } catch (error: any) {
    threw = error.constructor.name + ": " + String(error.message).slice(0, 13);
  }
  function later() { return ${read}; }
  console.log("SAID", ${read}, later(), threw);
});`;

async function say(name: string, text: string, words: string) {
  using directory = tempDir(name, { "a.test.ts": text });
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), env);
  expect(stderr).toContain(" 1 pass");
  return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "));
}

for (const [way, words] of ways) {
  for (const [title, [holder, key, read, answers]] of Object.entries(cases)) {
    test.concurrent(`${title}, ${way}`, async () => {
      const said = await say("aot-spy-fixed-members", testFile("", holder, key, read), words);
      expect(said).toEqual([`SAID ${answers} TypeError: Cannot spy on`]);
    });
  }

  test.concurrent(`a prototype object of which compiled code knows nothing is replaced, ${way}`, async () => {
    const said = await say(
      "aot-spy-fixed-members",
      testFile("", "FormData", "prototype", "typeof FormData.prototype"),
      words,
    );
    expect(said).toEqual(["SAID string string no"]);
  });

  test.concurrent(`a fixed member of an object of the program is replaced, ${way}`, async () => {
    const head = `function EventTarget2() {}\nObject.defineProperty(EventTarget2, "name", { value: "EventTarget" });\nObject.defineProperty(EventTarget2, "fixed", { value: 1 });`;
    const said = await say(
      "aot-spy-fixed-members",
      testFile(head, "EventTarget2", "fixed", "(EventTarget2 as any).fixed"),
      words,
    );
    expect(said).toEqual(["SAID spied spied no"]);
  });
}
