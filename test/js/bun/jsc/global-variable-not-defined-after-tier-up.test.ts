import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A name that is a property of globalThis is a ReferenceError once that property is deleted: for a read, and for a
// write in strict mode code. JavaScriptCore's optimizing tiers used a plain property access on the global object
// when they could not prove where the property is. A read then gave undefined and a write created the global
// again, so the answer changed after a few hundred calls.
//
// The concurrent JIT is off so that a function is optimized after the same number of calls in every run.
const env = { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" };

async function run(file: string, source: string) {
  using dir = tempDir("global-variable-not-defined", { [file]: source });
  await using proc = Bun.spawn({ cmd: [bunExe(), file], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("a read of a global that was deleted throws a ReferenceError at every call", async () => {
  const { stdout, stderr, exitCode } = await run(
    "reads-fixture.cjs",
    `
      function firstWrongAnswer(read, name) {
        for (let call = 0; call < 1500; call++) {
          try {
            return "call " + call + " returned " + String(read());
          } catch (e) {
            if (!(e instanceof ReferenceError) || e.message !== name + " is not defined") return "call " + call + " threw " + e;
          }
        }
        return "always a ReferenceError";
      }

      // A value that is there when the function first runs, and gone before the function is optimized.
      globalThis.deletedValue = {};
      function readDeletedValue() {
        return deletedValue;
      }
      readDeletedValue();
      delete globalThis.deletedValue;
      console.log("value:", firstWrongAnswer(readDeletedValue, "deletedValue"));

      // A getter that is deleted once the function is optimized.
      Object.defineProperty(globalThis, "deletedGetter", { get: () => 1, configurable: true });
      function readDeletedGetter() {
        return deletedGetter;
      }
      for (let i = 0; i < 2000; i++) readDeletedGetter();
      delete globalThis.deletedGetter;
      console.log("getter:", firstWrongAnswer(readDeletedGetter, "deletedGetter"));

      // A call of a deleted function is a ReferenceError, not "undefined is not a function".
      globalThis.deletedFunction = () => 1;
      function callDeletedFunction() {
        return deletedFunction();
      }
      callDeletedFunction();
      delete globalThis.deletedFunction;
      console.log("call:", firstWrongAnswer(callDeletedFunction, "deletedFunction"));

      // A global that Bun defines.
      function readAlert() {
        return alert;
      }
      for (let i = 0; i < 2000; i++) readAlert();
      delete globalThis.alert;
      console.log("builtin:", firstWrongAnswer(readAlert, "alert"));

      // A global of Bun whose getter is a native function.
      function readSelf() {
        return self;
      }
      for (let i = 0; i < 2000; i++) readSelf();
      delete globalThis.self;
      console.log("native getter:", firstWrongAnswer(readSelf, "self"));

      // typeof of a deleted name is "undefined". It never throws.
      Object.defineProperty(globalThis, "deletedForTypeof", { get: () => 1, configurable: true });
      function typeofDeleted() {
        return typeof deletedForTypeof;
      }
      for (let i = 0; i < 2000; i++) typeofDeleted();
      delete globalThis.deletedForTypeof;
      const seen = new Set();
      for (let i = 0; i < 1500; i++) seen.add(typeofDeleted());
      console.log("typeof:", [...seen].join());

      // A write in sloppy mode code creates the global again.
      globalThis.sloppyWritten = 0;
      function writeSloppy(value) {
        sloppyWritten = value;
      }
      for (let i = 0; i < 2000; i++) writeSloppy(i);
      delete globalThis.sloppyWritten;
      writeSloppy(7);
      console.log("sloppy write:", globalThis.sloppyWritten);
    `,
  );
  expect(stdout).toBe(
    [
      "value: always a ReferenceError",
      "getter: always a ReferenceError",
      "call: always a ReferenceError",
      "builtin: always a ReferenceError",
      "native getter: always a ReferenceError",
      "typeof: undefined",
      "sloppy write: 7",
      "",
    ].join("\n"),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("a strict mode write to a global that was deleted throws a ReferenceError at every call", async () => {
  // Module code is strict mode code.
  const { stdout, stderr, exitCode } = await run(
    "writes-fixture.mjs",
    `
      function firstWrongAnswer(write, name) {
        for (let call = 0; call < 1500; call++) {
          try {
            write(call);
            return "call " + call + " did not throw";
          } catch (e) {
            if (!(e instanceof ReferenceError) || e.message !== name + " is not defined") return "call " + call + " threw " + e;
            if (Object.hasOwn(globalThis, name)) return "call " + call + " created the global";
          }
        }
        return "always a ReferenceError";
      }

      // A value that is there when the function first runs, and gone before the function is optimized.
      globalThis.deletedValue = 0;
      function writeDeletedValue(value) {
        deletedValue = value;
      }
      writeDeletedValue(1);
      delete globalThis.deletedValue;
      console.log("value:", firstWrongAnswer(writeDeletedValue, "deletedValue"));

      // A setter that is deleted once the function is optimized.
      let stored = 0;
      Object.defineProperty(globalThis, "deletedSetter", {
        get: () => stored,
        set: value => void (stored = value),
        configurable: true,
      });
      function writeDeletedSetter(value) {
        deletedSetter = value;
      }
      for (let i = 0; i < 2000; i++) writeDeletedSetter(i);
      delete globalThis.deletedSetter;
      console.log("setter:", firstWrongAnswer(writeDeletedSetter, "deletedSetter"));
      console.log("last value the setter saw:", stored);
    `,
  );
  expect(stdout).toBe(
    ["value: always a ReferenceError", "setter: always a ReferenceError", "last value the setter saw: 1999", ""].join(
      "\n",
    ),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
