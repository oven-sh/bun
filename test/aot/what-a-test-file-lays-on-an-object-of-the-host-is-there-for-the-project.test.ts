import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `Object.defineProperty(process, "custom", { get() { .. } })` in a test file, and `process.custom` in a file of the project: over layers these are two programs.
// The program of the test file saw nobody read the name, so it left the getter out: "'get' was not compiled into this executable because your code never calls it".
// Each shape has a test file of its own: one that hands `process` to the project opens the door for all the others of its program.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/reads.mjs": `import "node:process"; export const read = () => 1;
`,
  "src/uses.mjs": `export const callHelper = () => process.helper();
export const readCustom = () => process.custom;
export const readByKey = key => process[key];
export const spread = holder => ({ ...holder }).custom;
export const readGlobal = () => globalThis.customOfGlobal;
export const readMath = () => Math.custom;
export const stringify = holder => JSON.stringify(holder).length > 0;
export const storeCustom = value => { process.custom = value; };
export const platform = () => process.platform;
export const isTTY = () => process.stdout.isTTY;
export const customOfStdout = () => process.stdout.customOfStdout;
export const customOfNavigator = () => navigator.custom;
export const customOfBun = () => Bun.custom;
export const callCustom = () => process.custom();
`,
  "b-read-by-name.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(process, "custom", { get() { return 1; }, enumerable: true, configurable: true });
  say("a getter on process, read by name by the project", () => uses.readCustom());
  delete process.custom;
});
`,
  "c-read-under-a-key.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(process, "custom", { get() { return 1; }, enumerable: true, configurable: true });
  say("a getter on process, read under a key by the project", () => uses.readByKey("custom"));
  delete process.custom;
});
`,
  "d-function-stored.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  process.helper = () => 7;
  say("a function stored on process, called by the project", () => uses.callHelper());
  delete process.helper;
});
`,
  "e-global.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(globalThis, "customOfGlobal", { get() { return 2; }, configurable: true });
  say("a getter on the global object, read by the project", () => uses.readGlobal());
  delete globalThis.customOfGlobal;
});
`,
  "f-math.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(Math, "custom", { get() { return 3; }, configurable: true });
  say("a getter on Math, read by the project", () => uses.readMath());
  delete Math.custom;
});
`,
  "g-import-of-node-process.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", async () => {
  Object.defineProperty(process, "custom", { get() { return 1; }, enumerable: true, configurable: true });
  try { console.log("node:process imported by the project", (await import("./src/reads.mjs")).read()); } catch (error) { console.log("node:process imported by the project throws", error.message.slice(0, 60)); }
  delete process.custom;
});
`,
  "h-setter.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  let seen = 0;
  Object.defineProperty(process, "custom", { set(value) { seen = value; }, configurable: true });
  say("a setter on process, stored to by the project", () => { uses.storeCustom(5); return seen; });
  delete process.custom;
});
`,
  "i-platform.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  const before = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { get: () => "win32", configurable: true });
  say("process.platform by a getter, read by the project", () => uses.platform());
  Object.defineProperty(process, "platform", before);
});
`,
  "j-stdout.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  const before = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { get: () => "yes", configurable: true });
  say("process.stdout.isTTY by a getter, read by the project", () => uses.isTTY());
  if (before) Object.defineProperty(process.stdout, "isTTY", before); else delete process.stdout.isTTY;
});
`,
  "k-stdout-new-name.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(process.stdout, "customOfStdout", { get: () => "yes", configurable: true });
  say("a new name on process.stdout by a getter, read by the project", () => uses.customOfStdout());
  delete process.stdout.customOfStdout;
});
`,
  "l-navigator.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(navigator, "custom", { get: () => "yes", configurable: true });
  say("a new name on navigator by a getter, read by the project", () => uses.customOfNavigator());
  delete navigator.custom;
});
`,
  "m-bun.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(Bun, "custom", { get: () => "yes", configurable: true });
  say("a new name on Bun by a getter, read by the project", () => uses.customOfBun());
  delete Bun.custom;
});
`,
  "n-value-that-is-a-function.test.js": `import { test } from "bun:test";
import * as uses from "./src/uses.mjs";
const say = (name, run) => { try { console.log(name, run()); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("t", () => {
  Object.defineProperty(process, "custom", { value: () => 9, configurable: true });
  say("a function under value on process, called by the project", () => uses.callCustom());
  delete process.custom;
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`what a test file lays on an object of the host is there for the project, ${way}`, async () => {
    using dir = tempDir("aot-laid-on-an-object-of-the-host", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("a getter on process, read by name by the project 1");
    expect(plain.stdout).toContain("a setter on process, stored to by the project 5");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
