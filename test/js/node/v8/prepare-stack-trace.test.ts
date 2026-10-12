import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "prepare-stack-trace-fixture.js");

// What Node.js v26.3.0 prints for each scenario of the fixture. "default" is the engine's own format.
const expected = {
  "assign": "ONE",
  "delete after assign": ["ONE", ["undefined", "default"], "TWO"],
  "delete first": ["default", "ONE"],
  "accessor": ["GETTER", "SETTER", "callsites"],
  "__defineGetter__": "GETTER",
  "define value": "DEFINED",
  "define value, not writable": "DEFINED",
  "define enumerable only": [[true, true, "default"], "ONE"],
  "Reflect.defineProperty": "DEFINED",
  "Object.defineProperties": "DEFINED",
  "Object.assign": "ASSIGNED",
  "Reflect.set": "SET",
  "Object.seal, then assign": ["default", "ONE"],
  "Object.freeze, then assign": ["default", "default"],
  "not callable": ["default", "default", "default", "default", "default"],
  "assign, then restore the first value": ["ONE", true, "default"],
  "assign the first value back": "default",
  "inherited from Function.prototype": ["INHERITED", "REPLACED"],
  "inherited from a new prototype": "INHERITED",
  "a formatter that deletes itself": ["ONCE", "default"],
  "a formatter that installs another": ["FIRST", "SECOND"],
  "a getter that reads another stack": ["GETTER", "default"],
  "a getter that throws": "getter threw",
  "other properties first": ["default", "ONE"],
};

// The formatter remembers where the property is on the constructor's Structure. These leave that
// Structure in dictionary mode, collected, or with its address in use again.
const expectedWithRememberedLocation = {
  "seventy delete and assign cycles": ["CYCLE 69", "default", "ASSIGNED", "GETTER", "DEFINED", "default"],
  "collections between writes that move the property":
    "default, default, ASSIGNED 2, GETTER 3, ASSIGNED 4, ASSIGNED 4, default, default, ASSIGNED 8, GETTER 9, ASSIGNED 10, ASSIGNED 10, default, default, ASSIGNED 14, GETTER 15, ASSIGNED 16, ASSIGNED 16",
  "a seeded walk of writes, prototype changes and collections":
    "default x2, C0 x3, default x2, P1, G2 x6, C4 x2, D5 x2, C6 x4, C7, A8 x4, G10 x6, C11 x3, G12 x2, P3 x3, G14 x11, D18, G19 x3, G21 x4",
};

async function run(...cmd: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

async function runFixture(...args: string[]) {
  const { stdout, stderr, exitCode } = await run(fixture, ...args);
  let result: unknown = { stdout, stderr };
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, exitCode };
}

describe("Error.prepareStackTrace is read from the Error constructor when a stack is formatted", () => {
  test.concurrent.each(Object.entries({ ...expected, ...expectedWithRememberedLocation }))(
    "%s",
    async (scenario, result) => {
      expect(await runFixture("main", scenario)).toEqual({ result, exitCode: 0 });
    },
  );

  test.concurrent("each write form in a fresh ShadowRealm", async () => {
    expect(await runFixture("ShadowRealm", ...Object.keys(expected))).toEqual({ result: expected, exitCode: 0 });
  });

  test.concurrent("each write form in a fresh node:vm context", async () => {
    expect(await runFixture("node:vm", ...Object.keys(expected))).toEqual({
      result: {
        ...expected,
        // The Error of a node:vm context starts without the property, so these two find nothing to change.
        "define enumerable only": [[true, true, "default"], "default"],
        "Object.seal, then assign": ["default", "default"],
      },
      exitCode: 0,
    });
  });

  // A Worker takes seconds to start in a debug build.
  test.concurrent(
    "in a Worker",
    async () => {
      expect(await runFixture("Worker", "delete after assign", "accessor")).toEqual({
        result: { "delete after assign": expected["delete after assign"], "accessor": expected["accessor"] },
        exitCode: 0,
      });
    },
    30_000,
  );
});

// An error holds the functions in its trace weakly, and these are garbage by the first read of `.stack`.
const errorWithDeadFrames = `new Function('"use strict"; function inner() { try { return new Error("x"); } finally {} } try { return inner(); } finally {}')()`;

test.concurrent.each([
  [
    "the getter runs Bun.gc(true)",
    `const e = ${errorWithDeadFrames};
     Object.defineProperty(Error, "prepareStackTrace", { get() { Bun.gc(true); } });
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)[1]);`,
    "Error: x | inner",
  ],
  [
    "the getter reads the lazy .stack of the error that is being formatted",
    `const e = new Error("x");
     (function capture() { Error.captureStackTrace(e); })();
     let entered = false;
     Object.defineProperty(Error, "prepareStackTrace", { get() { if (!entered) { entered = true; void e.stack; } } });
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)?.[1]);`,
    "Error: x | capture",
  ],
  [
    "a write through a Proxy made in a node:vm context",
    `import vm from "node:vm";
     const proxy = vm.runInContext("new Proxy(E, {})", vm.createContext({ E: Error }));
     proxy.prepareStackTrace = () => "FROM PROXY";
     console.log(new Error("x").stack);`,
    "FROM PROXY",
  ],
])("a getter or a write from another realm cannot break the formatting: %s", async (_, source, expected) => {
  const { stdout, exitCode, signalCode } = await run("-e", source);
  expect({ stdout, exitCode, signalCode }).toEqual({ stdout: expected, exitCode: 0, signalCode: null });
});
