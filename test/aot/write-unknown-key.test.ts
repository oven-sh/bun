import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `change(globalThis[holder], key)` in a helper, with holder and key out of a parsed text: the build knows neither. A member such as console.debug is locked only where the build
// has followed no write to it. A store under such a key was followed to every built-in object that its receiver lists; a definition and a delete were not, so they were refused.
const files = (change: string): Record<string, string> => ({
  "main.test.js": `import { change, say, rows } from "parts/helpers.js";
import { test } from "bun:test";
for (const [holder, key] of rows) change(globalThis[holder], key, 0);
say("ANSWER " + [typeof console.debug, typeof console.table].join());
test("ran to its end", () => {});
`,
  "node_modules/parts/package.json": `{ "name": "parts", "version": "1.0.0" }`,
  "node_modules/parts/helpers.js": `export function change(target, key, value) {
  ${change}
}
export const say = console.info.bind(console);
export const rows = JSON.parse('[["console","debug"],["console","table"]]');
`,
});

test.each([
  [
    "Object.defineProperty",
    "Object.defineProperty(target, key, { value, writable: true, configurable: true });",
    "number,number",
  ],
  [
    "Reflect.defineProperty",
    "Reflect.defineProperty(target, key, { value, writable: true, configurable: true });",
    "number,number",
  ],
  ["a store", "target[key] = value;", "number,number"],
  ["delete", "delete target[key];", "undefined,undefined"],
  ["Reflect.deleteProperty", "Reflect.deleteProperty(target, key);", "undefined,undefined"],
  [
    "Object.defineProperties",
    "Object.defineProperties(target, { [key]: { value, writable: true, configurable: true } });",
    "number,number",
  ],
  ["__defineGetter__", "target.__defineGetter__(key, () => value);", "number,number"],
])("%s under a key nobody knows changes a member of console in a test run", async (_, change, answer) => {
  using dir = tempDir("aot-write-unknown-key", files(change));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "."], String(dir), bunEnv);
  expect(stdout + stderr).toContain("ANSWER " + answer);
  expect(stdout + stderr).not.toContain("Cannot");
  expect(exitCode).toBe(0);
});
