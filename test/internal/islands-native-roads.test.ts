import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repository = join(import.meta.dir, "..", "..");
const builtins = join(repository, "src", "js", "builtins");
const doors = readFileSync(join(repository, "scripts", "build", "islands.doors"), "utf8").split("\n");

const asked = readdirSync(builtins)
  .filter(name => name.endsWith(".ts"))
  .flatMap(name => [...readFileSync(join(builtins, name), "utf8").matchAll(/\$new(?:Rust|Cpp|Zig)Function\(\s*"([^"]+)",\s*"([^"]+)"/g)])
  .map(([, file, name]) => `${file}:${name}`)
  .sort();

const followsWhoHandsItSomething: Record<string, string> = {
  "ipc.rs:emitHandleIPCMessage": "called with a message that the channel has received",
};

test("a native function that a built-in function outside of modules asks for keeps the part of the runtime it lies in", () => {
  expect(asked.length).toBeGreaterThan(0);
  const kept = new Set(doors.filter(line => /^when \S+ native /.test(line)).map(line => line.split(" ")[3]));
  expect(asked.filter(native => !kept.has(native) && !(native in followsWhoHandsItSomething))).toEqual([]);
});

test("the exceptions are still asked for", () => {
  expect(Object.keys(followsWhoHandsItSomething).filter(native => !asked.includes(native))).toEqual([]);
});
