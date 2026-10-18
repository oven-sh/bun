import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "prepare-stack-trace-fixture.js");

// What Node.js v26.3.0 prints for each scenario of the fixture. "default" is the engine's own format.
// Each scenario is the first code that touches the property in a new realm.
const expected: Record<string, unknown> = {
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
  "an accessor is read two times for one stack": ["CALLED ON Error", 2],
  "a getter that gives a function, then null": ["TypeError", "globalThis.Error.prepareStackTrace is not a function", 2],
  "a getter gives a formatter that throws": [true, "LATER"],
  "an inherited getter is read two times": ["CALLED ON Error", [true, true]],
  "the formatter is called on Error": ["Error", "Error"],
  "a getter that gives undefined, then a function": ["LATE", 3],
  "other properties first": ["default", "ONE"],
};

// These call the default formatter, which the Error of a node:vm context does not have.
const expectedWithTheDefaultFormatter = {
  "error-callsites, then depd": ["callsites", "Error", "Inherits: not an Error instance", "default", "callsites"],
  "the default formatter with an object that is not an Error": [
    "Error",
    "Named: with a message",
    "TypeError",
    "TypeError",
  ],
  "a formatter that calls the default, and a capture whose caller is not on the stack": "WRAPPED Error 0",
};

async function run(...cmd: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

// The JSON a fixture printed, or what it printed instead.
async function runForJSON(...cmd: string[]) {
  const { stdout, stderr, exitCode } = await run(...cmd);
  let result: unknown = { stdout, stderr };
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, exitCode };
}

const runFixture = (...args: string[]) => runForJSON(fixture, ...args);

describe("Error.prepareStackTrace is read from the Error constructor when a stack is formatted", () => {
  // One process for each. The write forms not listed here run in a ShadowRealm below,
  // which has the same kind of global object as the main realm.
  const inTheMainRealm = {
    "delete after assign": expected["delete after assign"],
    "accessor": expected["accessor"],
    ...expectedWithTheDefaultFormatter,
    "a stack overflow, read where it is caught": ["default", "default", "default", 0, "FORMATTED", 1],
  };
  test.concurrent.each(Object.entries(inTheMainRealm))("%s", async (scenario, result) => {
    expect(await runFixture("main", scenario)).toEqual({ result, exitCode: 0 });
  });

  // A new realm takes about 50 ms in a debug build, so these processes run one after the other.
  const names = Object.keys(expected);
  const half = Math.ceil(names.length / 2);
  test.each([[names.slice(0, half)], [names.slice(half)]])(
    "each scenario in a fresh ShadowRealm (%#)",
    async scenarios => {
      expect(await runFixture("ShadowRealm", ...scenarios)).toEqual({
        result: Object.fromEntries(scenarios.map(scenario => [scenario, expected[scenario]])),
        exitCode: 0,
      });
    },
  );

  test("in a fresh node:vm context", async () => {
    // The Error of a node:vm context starts without the property.
    const scenarios = [
      ...["assign", "delete after assign", "delete first", "accessor", "define value", "not callable"],
      ...["inherited from Function.prototype", "a formatter that deletes itself"],
      ...["a getter that reads another stack", "a getter that throws"],
      ...["an accessor is read two times for one stack", "a getter that gives a function, then null"],
      ...["an inherited getter is read two times", "the formatter is called on Error"],
    ];
    expect(await runFixture("node:vm", ...scenarios)).toEqual({
      result: Object.fromEntries(scenarios.map(scenario => [scenario, expected[scenario]])),
      exitCode: 0,
    });
  });
});

// An error holds the functions in its trace weakly, and these are garbage by the first read of `.stack`.
const errorWithDeadFrames = `new Function('"use strict"; function inner() { try { return new Error("x"); } finally {} } try { return inner(); } finally {}')()`;

test.concurrent.each([
  [
    "the getter runs Bun.gc(true)",
    `const e = ${errorWithDeadFrames};
     let reads = 0;
     Object.defineProperty(Error, "prepareStackTrace", { get() { reads++; Bun.gc(true); } });
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)[1] + " | reads: " + reads);`,
    "Error: x | inner | reads: 2",
  ],
  [
    "the getter reads the lazy .stack of the error that is being formatted",
    `const e = new Error("x");
     (function capture() { Error.captureStackTrace(e); })();
     let entered = false;
     Object.defineProperty(Error, "prepareStackTrace", { get() { if (!entered) { entered = true; void e.stack; } } });
     console.log(e.stack.split("\\n")[0] + " | " + /at (\\w+)/.exec(e.stack)?.[1] + " | the getter ran: " + entered);`,
    "Error: x | capture | the getter ran: true",
  ],
  [
    "a write through a Proxy made in a node:vm context",
    `import vm from "node:vm";
     const proxy = vm.runInContext("new Proxy(E, {})", vm.createContext({ E: Error }));
     proxy.prepareStackTrace = () => "FROM PROXY";
     console.log(new Error("x").stack);`,
    "FROM PROXY",
  ],
  [
    // Node.js throws again at each read. Here the first read throws and the error keeps its default stack.
    "the getter throws, and the stack is read again",
    `Object.defineProperty(Error, "prepareStackTrace", { get() { throw new RangeError("getter threw"); } });
     const e = new Error("boom");
     const target = {};
     const thrown = read => { try { read(); return "no throw"; } catch (error) { return error.message; } };
     const first = [thrown(() => e.stack), thrown(() => Error.captureStackTrace(target))];
     const kept = [/^Error: boom\\n    at /.test(e.stack), /^Error\\n    at /.test(target.stack)];
     console.log(JSON.stringify([first, kept]));`,
    `[["getter threw","getter threw"],[true,true]]`,
  ],
])("a getter or a write from another realm cannot break the formatting: %s", async (_, source, expected) => {
  const { stdout, exitCode, signalCode } = await run("-e", source);
  expect({ stdout, exitCode, signalCode }).toEqual({ stdout: expected, exitCode: 0, signalCode: null });
});

// An error made in a node:vm context. Each line is what Node.js v26.3.0 prints.
test.concurrent("the Error of the main context formats for a node:vm context that has no formatter", async () => {
  const source = `
    const vm = require("node:vm");
    Error.prepareStackTrace = function (error, callSites) {
      return "MAIN, called on the main Error: " + (this === Error) + ", call sites: " + (typeof callSites[0].getFileName === "function");
    };
    console.log(vm.runInNewContext("new Error('x')").stack);
    console.log(vm.runInNewContext("Error.prepareStackTrace = function () { return 'CONTEXT, called on its Error: ' + (this === Error); }; new Error('x').stack"));
    console.log(vm.runInNewContext("Error.prepareStackTrace = 'not a function'; new Error('x').stack"));
    Error.prepareStackTrace = undefined;
    console.log(vm.runInNewContext("new Error('x')").stack.split("\\n")[0]);
    let reads = 0;
    Object.defineProperty(Error, "prepareStackTrace", { get: () => (++reads === 2 ? null : () => "FIRST") });
    try {
      console.log(vm.runInNewContext("new Error('x')").stack);
    } catch (error) {
      console.log(error.message + ", reads: " + reads + ", a TypeError of the main context: " + (error instanceof TypeError));
    }
  `;
  const { stdout, exitCode } = await run("-e", source);
  expect({ stdout: stdout.split("\n"), exitCode }).toEqual({
    stdout: [
      "MAIN, called on the main Error: true, call sites: true",
      "CONTEXT, called on its Error: true",
      "MAIN, called on the main Error: true, call sites: true",
      "Error: x",
      "MainContextError.prepareStackTrace is not a function, reads: 2, a TypeError of the main context: true",
    ],
    exitCode: 0,
  });
});

// The first value of the property is a function that formats as the engine does. Native code formats in its
// place, so a stack has the same text when that function is put back. The other formatter prints "at outer".
test.concurrent(
  "the default formatter, put back as a value or given by a getter, formats as the engine does",
  async () => {
    const source = `
    const original = Error.prepareStackTrace;
    async function inner() { await new Promise(resolve => setImmediate(resolve)); return new Error("x").stack; }
    async function outer() { return await inner(); }
    const seen = [await outer()];
    Error.prepareStackTrace = () => "USER";
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, writable: true, value: original });
    seen.push(await outer());
    Error.prepareStackTrace = original;
    seen.push(await outer());
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get: () => original });
    seen.push(await outer());
    console.log(JSON.stringify(seen.map(stack => /\\n    at async outer \\(/.test(stack))));
  `;
    const { stdout, exitCode } = await run("-e", source);
    expect({ stdout, exitCode }).toEqual({ stdout: "[true,true,true,true]", exitCode: 0 });
  },
);

// Node.js captures call sites natively for its own modules, so whatever the program did to
// Error.prepareStackTrace or Error.stackTraceLimit is neither used nor changed by them.
// Not concurrent: this process is the slowest one of the file in a debug build.
test("util.getCallSites and url.parse do not read or write the program's hook", async () => {
  using dir = tempDir("prepare-stack-trace-builtins", {
    "node_modules/library/index.js": `
      const util = require("node:util");
      const url = require("node:url");
      function sites() {
        return util.getCallSites(2).map(site => site.functionName);
      }
      // From a file in node_modules, url.parse looks at the stack before it warns.
      function parse() {
        return url.parse("http://example.com/path").pathname;
      }
      module.exports = { sites, parse };
    `,
    "main.js": `
      const library = require("library");
      // url.parse from a library must find its caller in node_modules and not warn (DEP0169).
      const warnings = [];
      process.on("warning", warning => warnings.push(warning.code ?? warning.name));
      const calls = { get: 0, set: 0, formatter: 0 };
      const descriptors = () => ["prepareStackTrace", "stackTraceLimit"].map(name => Object.getOwnPropertyDescriptor(Error, name));
      const same = (a, b) => (a && b ? Object.keys(a).join() === Object.keys(b).join() && Object.keys(a).every(key => a[key] === b[key]) : a === b);
      const results = {};
      function check(state) {
        const before = descriptors();
        const [sites, pathname] = [library.sites().join(), library.parse()];
        results[state] = [sites, pathname, descriptors().every((descriptor, i) => same(descriptor, before[i]))];
      }
      const formatter = () => {
        calls.formatter++;
        return "USER";
      };
      const get = () => (calls.get++, formatter);
      const set = () => void calls.set++;
      Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get, set });
      check("accessor");
      Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get, set: undefined });
      check("getter only");
      Object.defineProperty(Error, "prepareStackTrace", { configurable: true, writable: false, value: formatter });
      check("not writable");
      delete Error.prepareStackTrace;
      check("deleted");
      Error.prepareStackTrace = function whileFormatting() {
        results["inside a formatter"] = [library.sites().join(), library.parse()];
        return "FORMATTED";
      };
      void new Error("boom").stack;
      delete Error.prepareStackTrace;
      Object.defineProperty(Error, "stackTraceLimit", { configurable: true, get: () => (calls.get++, 0), set });
      check("stackTraceLimit accessor");
      // A warning is emitted on a later tick.
      setImmediate(() => console.log(JSON.stringify({ results, calls, warnings })));
    `,
  });
  const unchanged = ["sites,check", "/path", true];
  expect(await runForJSON(join(String(dir), "main.js"))).toEqual({
    result: {
      results: {
        "accessor": unchanged,
        "getter only": unchanged,
        "not writable": unchanged,
        "deleted": unchanged,
        "inside a formatter": ["sites,whileFormatting", "/path"],
        "stackTraceLimit accessor": unchanged,
      },
      calls: { get: 0, set: 0, formatter: 0 },
      warnings: [],
    },
    exitCode: 0,
  });
});

// The tests of https://github.com/oven-sh/bun/pull/44547.
const restoredFormatterFixture = String.raw`
const assert = require("node:assert/strict");
const mode = process.argv[1];
const original = Error.prepareStackTrace;
let cachedCalls = 0;
const cached = () => { cachedCalls++; return "cached formatter"; };
Error.prepareStackTrace = cached;
const descriptor = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
if (mode === "restore-descriptor") {
  Error.prepareStackTrace = () => "temporary formatter";
  Object.defineProperty(Error, "prepareStackTrace", descriptor);
} else if (mode === "delete-restore" || mode === "restore-default") {
  delete Error.prepareStackTrace;
  assert.equal(typeof new Error("default stack").stack, "string");
  assert.equal(cachedCalls, 0);
  Error.prepareStackTrace = mode === "restore-default" ? original : cached;
} else if (mode === "replace-value") {
  Object.defineProperty(Error, "prepareStackTrace", { ...descriptor, value: () => "replacement" });
} else if (mode === "replace-accessor") {
  let value = cached;
  Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get() { return value; }, set(next) { value = next; } });
} else if (mode === "inherited-write") {
  class ChildError extends Error {}
  ChildError.prepareStackTrace = () => "child formatter";
  assert.equal(Error.prepareStackTrace, cached);
}
let calls = 0;
Error.prepareStackTrace = function(error, frames) {
  assert.equal(this, Error);
  calls++;
  return frames;
};
const target = {};
Error.captureStackTrace(target);
const stacks = [target.stack, new Error("instance").stack];
assert.equal(calls, 2);
for (const frames of stacks) {
  assert.equal(Array.isArray(frames), true);
  assert.ok(frames.length > 0);
  assert.equal(typeof frames[0].getFileName, "function");
}
console.log("ok");
`;

test.concurrent.each([
  "restore-descriptor",
  "delete-restore",
  "restore-default",
  "replace-value",
  "replace-accessor",
  "inherited-write",
])("Error.prepareStackTrace property restoration: %s", async mode => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", restoredFormatterFixture, mode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
});

// The tests of https://github.com/oven-sh/bun/pull/41395. They also keep the two groups of processes apart.
test("default Error.prepareStackTrace formats a non-Error object", () => {
  // The original prepareStackTrace is forwarded whatever captureStackTrace was
  // given; Node's default formatter accepts any object, not only Errors.
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = (err, callSites) => original(err, callSites);
  try {
    const target = { message: "not an error" };
    expect(() => Error.captureStackTrace(target)).not.toThrow();
    expect(typeof target.stack).toBe("string");
    expect(target.stack).toStartWith("Error: not an error");
    expect(target.stack).toMatch(/\n    at /);

    const bare = Object.create(null);
    expect(() => Error.captureStackTrace(bare)).not.toThrow();
    expect(typeof bare.stack).toBe("string");

    expect(() => Error.captureStackTrace(1)).toThrow(TypeError);
    // The default formatter itself: any object is accepted, primitives are still rejected.
    expect(typeof original({ message: "plain" }, [])).toBe("string");
    expect(() => original(1, [])).toThrow(TypeError);
    expect(() => original(null, [])).toThrow(TypeError);
  } finally {
    Error.prepareStackTrace = original;
  }
});

test("captureStackTrace with a delegating prepareStackTrace and a caller not on the stack", () => {
  // Repro from https://github.com/oven-sh/bun/issues/41151: `this.constructor` is Error, which is
  // not on the stack, so every frame is elided and the stack is just the header, as in Node.
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = (err, callSites) => original(err, callSites);
  try {
    function CustomError() {
      Error.captureStackTrace(this, this.constructor);
    }
    CustomError.prototype = new Error();
    expect(new CustomError().stack).toBe("Error");
  } finally {
    Error.prepareStackTrace = original;
  }
});

const formatterAccessorFixture = String.raw`
const assert = require("node:assert/strict");
const mode = process.argv[1];
let reads = 0;
let calls = 0;
let nested;
const failure = new Error("formatter failure");
Object.defineProperty(Error, "prepareStackTrace", {
  configurable: true,
  get() {
    reads++;
    if (mode === "getter-throws") throw failure;
    if (mode === "changes-between-reads" && reads === 2) return null;
    nested = new Error("nested").stack;
    return function(error, frames) {
      calls++;
      if (mode === "formatter-throws") throw failure;
      return frames;
    };
  },
});
function capture() {
  const target = {};
  Error.captureStackTrace(target);
  return target.stack;
}
if (mode === "getter-throws" || mode === "formatter-throws") {
  assert.throws(capture, error => error === failure);
} else if (mode === "changes-between-reads") {
  assert.throws(capture, { name: "TypeError", message: "globalThis.Error.prepareStackTrace is not a function" });
} else {
  assert.equal(Array.isArray(capture()), true);
  assert.equal(calls, 1);
}
assert.equal(reads, mode === "getter-throws" ? 1 : 2);
if (mode !== "getter-throws") assert.equal(typeof nested, "string");
Object.defineProperty(Error, "prepareStackTrace", {
  configurable: true, writable: true, value: (_error, frames) => frames,
});
assert.equal(Array.isArray(new Error("healthy later capture").stack), true);
console.log("ok");
`;

test.concurrent.each(["nested", "getter-throws", "formatter-throws", "changes-between-reads"])(
  "Error.prepareStackTrace accessor lookup: %s",
  async mode => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", formatterAccessorFixture, mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  },
);
