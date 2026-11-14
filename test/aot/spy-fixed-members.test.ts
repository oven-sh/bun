// spyOn() replaces a member by force, whatever its attributes say. Compiled code takes the `prototype` of a built-in class, and a constant such as WebSocket.OPEN,
// for what the realm was created with, also where the class itself is not locked. Such a spy is refused aloud, as one on Math.PI is: it once ended the whole run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const testFile = (name: string, holder: string, key: string, read: string) => `
import { test, vi } from "bun:test";
test("${name}", () => {
  let threw = "no";
  try {
    vi.spyOn(${holder} as any, ${JSON.stringify(key)}, "get").mockReturnValue("spied");
  } catch (error: any) {
    threw = error.constructor.name + ": " + String(error.message).slice(0, 13);
  }
  function later() { return ${read}; }
  console.log("SAID ${name}", ${read}, later(), threw);
});`;

// Both are test files of one run. The constant comes first: the spy on the prototype object is the one that ended the run.
let run1: Promise<string[]> | undefined;
const said = () =>
  (run1 ??= (async () => {
    using directory = tempDir("aot-spy-fixed-members", {
      "a.test.ts": testFile("a constant", "WebSocket", "OPEN", "WebSocket.OPEN"),
      "b.test.ts": testFile("the prototype object", "EventTarget", "prototype", "typeof EventTarget.prototype"),
    });
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
    const cmd = [bunExe(), "test", "--aot", "./a.test.ts", "./b.test.ts"];
    const { stdout, stderr } = await run(cmd, String(directory), env);
    return (stdout + "\n" + stderr).split("\n");
  })());

test("a constant of a class", async () => {
  expect((await said()).filter(line => line.startsWith("SAID a constant"))).toEqual([
    "SAID a constant 1 1 TypeError: Cannot spy on",
  ]);
});

test("the prototype object of a class", async () => {
  expect((await said()).filter(line => line.startsWith("SAID the prototype object"))).toEqual([
    "SAID the prototype object object object TypeError: Cannot spy on",
  ]);
  expect(await said()).toContain(" 2 pass");
});
