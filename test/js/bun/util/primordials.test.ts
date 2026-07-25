import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Link-time constant primordials (JSCPrimordials.h) are captured when a holder
// object is created and exposed to builtin JavaScript as @-prefixed names.
// Run the `bun:internal-for-testing` probe in a child process so the prototype
// pollution below starts from a fresh global and doesn't leak into this file.

const script = /* js */ `
const { primordials } = require("bun:internal-for-testing");

const tamper = process.argv[2] === "tamper";
if (tamper) {
  Array.prototype.push = () => { throw new Error("tampered Array.prototype.push"); };
  Array.prototype.slice = () => { throw new Error("tampered Array.prototype.slice"); };
  Array.prototype[Symbol.iterator] = () => { throw new Error("tampered Array.prototype[Symbol.iterator]"); };
  String.prototype.slice = () => { throw new Error("tampered String.prototype.slice"); };
  String.prototype.split = () => { throw new Error("tampered String.prototype.split"); };
  Object.keys = () => { throw new Error("tampered Object.keys"); };
  Object.defineProperty = () => { throw new Error("tampered Object.defineProperty"); };
  Function.prototype.bind = () => { throw new Error("tampered Function.prototype.bind"); };
  RegExp.prototype.test = () => { throw new Error("tampered RegExp.prototype.test"); };
  Map.prototype.get = () => { throw new Error("tampered Map.prototype.get"); };
  Date.now = () => { throw new Error("tampered Date.now"); };
  Number.isInteger = () => { throw new Error("tampered Number.isInteger"); };
  Math.max = () => { throw new Error("tampered Math.max"); };
  Reflect.ownKeys = () => { throw new Error("tampered Reflect.ownKeys"); };
  JSON.stringify = () => { throw new Error("tampered JSON.stringify"); };
  const TA = Object.getPrototypeOf(Uint8Array.prototype);
  TA.subarray = () => { throw new Error("tampered %TypedArray%.prototype.subarray"); };
  Promise.resolve = () => { throw new Error("tampered Promise.resolve"); };
}

const out = primordials.run([], "hello", new Map([["k", "v"]]), new Uint8Array([1, 2, 3, 4]), /ell/);

const refs = primordials.refs();
for (const [name, fn] of [
  ["ArrayPrototypePush", refs.ArrayPrototypePush],
  ["StringPrototypeSlice", refs.StringPrototypeSlice],
  ["ObjectDefineProperty", refs.ObjectDefineProperty],
  ["MapPrototypeGet", refs.MapPrototypeGet],
  ["MathMax", refs.MathMax],
  ["ReflectOwnKeys", refs.ReflectOwnKeys],
  ["TypedArrayPrototypeGetLength", refs.TypedArrayPrototypeGetLength],
]) {
  out["typeof_" + name] = typeof fn;
}

process.stdout.write(out.JSONStringify ? JSON.stringify(out) : "JSONStringify failed");
`;

const expected = {
  ArrayPrototypePush: 2,
  ArrayPrototypeSlice: [1, 2],
  ArrayPrototypeSymbolIterator: 1,
  StringPrototypeSlice: "el",
  StringPrototypeSplit: ["h", "e", "l", "l", "o"],
  ObjectKeys: ["a", "b"],
  ObjectDefineProperty: 42,
  FunctionPrototypeBind: 8,
  RegExpPrototypeTest: true,
  RegExpPrototypeGetSource: "ell",
  MapPrototypeGet: "v",
  MapPrototypeGetSize: 1,
  DateNow: "number",
  NumberIsInteger: true,
  MathMax: 5,
  ReflectOwnKeys: ["a"],
  JSONStringify: '{"a":1}',
  TypedArrayPrototypeGetLength: 4,
  TypedArrayPrototypeSubarray: 2,
  DataViewPrototypeGetByteLength: 4,
  PromiseResolve: true,
  typeof_ArrayPrototypePush: "function",
  typeof_StringPrototypeSlice: "function",
  typeof_ObjectDefineProperty: "function",
  typeof_MapPrototypeGet: "function",
  typeof_MathMax: "function",
  typeof_ReflectOwnKeys: "function",
  typeof_TypedArrayPrototypeGetLength: "function",
};

async function run(tamper: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script, tamper ? "tamper" : "clean"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("link-time constant primordials", () => {
  test("are captured and callable via .@call", async () => {
    const { stdout, stderr, exitCode } = await run(false);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test("are tamper-proof", async () => {
    const { stdout, stderr, exitCode } = await run(true);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test("lazy holders captured before user code first touches them", async () => {
    // Map is a LazyClassStructure; tamper with Map.prototype.get BEFORE the
    // first builtin reference to @MapPrototypeGet. The capture hook in the
    // LazyClassStructure initializer must still see the original.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          Map.prototype.get = () => "tampered";
          const { primordials } = require("bun:internal-for-testing");
          const r = primordials.run([], "x", new Map([["k","v"]]), new Uint8Array(1), /x/);
          process.stdout.write(r.MapPrototypeGet);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("v");
    expect(exitCode).toBe(0);
  });

  test("Worker globals capture independently", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker } = require("node:worker_threads");
          const w = new Worker(
            'Array.prototype.push = () => { throw new Error("worker tampered"); };' +
            'const { primordials } = require("bun:internal-for-testing");' +
            'const r = primordials.run([], "x", new Map([["k","v"]]), new Uint8Array(1), /x/);' +
            'require("node:worker_threads").parentPort.postMessage(r.ArrayPrototypePush);',
            { eval: true }
          );
          w.on("message", m => { console.log(m); w.terminate(); });
          w.on("error", e => { console.error(e); process.exit(1); });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("2");
    expect(exitCode).toBe(0);
  });

  test("PropertyCallback holders are tamper-proof when overwritten before first read", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          Object.defineProperty(globalThis, "Math", { value: { max: () => "tampered" } });
          const { primordials } = require("bun:internal-for-testing");
          const r = primordials.run([], "x", new Map([["k","v"]]), new Uint8Array(1), /x/);
          process.stdout.write(String(r.MathMax));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("5");
    expect(exitCode).toBe(0);
  });
});
