import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";

// TZ, NODE_TLS_REJECT_UNAUTHORIZED, BUN_CONFIG_VERBOSE_FETCH and the proxy keys keep native state: the
// time zone of the process, the certificate check of fetch(), its logging, its proxy. A native getter
// and setter sit behind each key. They must act for process.env only: never write on another `this`,
// and never take a write that has another receiver.
const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
const nativeKeys = [
  "TZ",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "BUN_CONFIG_VERBOSE_FETCH",
  ...proxyKeys,
  // Windows environment names are case-insensitive, so there the lowercase names are the same keys.
  ...(isWindows ? [] : proxyKeys.map(key => key.toLowerCase())),
];

// The environment of each child process, and the values the tests then write.
// A write that reaches process.env changes the time zone, turns the certificate check off, and so on.
const startValues: Record<string, string> = {};
const writtenValues: Record<string, string> = {};
for (const key of nativeKeys) {
  startValues[key] = `http://127.0.0.1:1/${key}`;
  writtenValues[key] = `http://127.0.0.1:2/${key}`;
}
Object.assign(startValues, { TZ: "Etc/UTC", NODE_TLS_REJECT_UNAUTHORIZED: "1", BUN_CONFIG_VERBOSE_FETCH: "0" });
Object.assign(writtenValues, { TZ: "Asia/Tokyo", NODE_TLS_REJECT_UNAUTHORIZED: "0", BUN_CONFIG_VERBOSE_FETCH: "1" });

const prelude = `
  const keys = ${JSON.stringify(nativeKeys)};
  const writtenValues = ${JSON.stringify(writtenValues)};
  // A WebAssembly GC struct reference: an object that accepts no property at all.
  // (module (type $s (struct (field (mut i32)))) (func (export "mk") (result (ref null $s)) struct.new_default $s))
  const wasmStruct = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 10, 2, 0x5f, 1, 0x7f, 1, 0x60, 0, 1, 0x63, 0, 3, 2, 1, 1,
    7, 6, 1, 2, 0x6d, 0x6b, 0, 0, 10, 7, 1, 5, 0, 0xfb, 1, 0, 0x0b,
  ]))).exports.mk();
  const timeZoneOffset = () => new Date(2020, 0, 1).getTimezoneOffset();
  const state = () => JSON.stringify([keys.map(key => process.env[key]), timeZoneOffset()]);
`;

// process.env has two native classes. A thread that starts a worker with `env: SHARE_ENV` swaps its
// process.env for the second one, which reads and writes a store that the threads share.
const variants = [
  { name: "process.env", setup: "", teardown: "" },
  {
    name: "process.env after a SHARE_ENV worker started",
    setup: `
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      const worker = new Worker("require('node:worker_threads').parentPort.once('message', () => {})", { eval: true, env: SHARE_ENV });
    `,
    teardown: `await worker.terminate();`,
  },
];

// Runs `script` in a child whose environment has exactly `set` of the native keys.
async function run(script: string, set: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = { ...bunEnv };
  for (const key of Object.keys(env)) {
    if (nativeKeys.includes(key.toUpperCase())) delete env[key];
  }
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + script],
    env: { ...env, ...set, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode };
}

describe.concurrent("process.env keys with native state", () => {
  test("are data properties: JS gets no native getter or setter to call on another object", async () => {
    const set = { TZ: "Etc/UTC", BUN_CONFIG_VERBOSE_FETCH: "0", HTTP_PROXY: "http://127.0.0.1:1/" };
    const result = await run(
      `
      const out = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(process.env, key);
        const functions = [descriptor.get, descriptor.set, process.env.__lookupGetter__(key), process.env.__lookupSetter__(key)];
        out[key] = [{ ...descriptor, value: descriptor.value ?? null }, functions.filter(f => f !== undefined).length];
      }
      console.log(JSON.stringify(out));
      `,
      set,
    );

    const out: Record<string, unknown> = {};
    for (const key of nativeKeys) {
      const isSet = key in set;
      out[key] = [{ value: isSet ? set[key] : null, writable: true, enumerable: isSet, configurable: true }, 0];
    }
    expect(result).toEqual({ out, stderr: "", exitCode: 0 });
  });

  test("a descriptor can be taken, deleted and defined again", async () => {
    const result = await run(
      `
      const out = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(process.env, key);
        delete process.env[key];
        const deleted = process.env[key] === undefined;
        Object.defineProperty(process.env, key, { ...descriptor, value: writtenValues[key] });
        out[key] = [deleted, process.env[key]];
      }
      console.log(JSON.stringify({ out, timeZoneOffset: timeZoneOffset() }));
      `,
      startValues,
    );

    const out: Record<string, unknown> = {};
    for (const key of nativeKeys) out[key] = [true, writtenValues[key]];
    // Asia/Tokyo: the define is a real write.
    expect(result).toEqual({ out: { out, timeZoneOffset: -540 }, stderr: "", exitCode: 0 });
  });

  test("a read with another receiver returns the value and leaves the receiver alone", async () => {
    const result = await run(
      `
      const out = {};
      for (const key of keys) {
        out[key] = [
          Reflect.get(process.env, key, wasmStruct),
          Reflect.get(process.env, key, Object.freeze({})),
          Object.create(process.env)[key],
        ];
      }
      console.log(JSON.stringify(out));
      `,
      startValues,
    );

    const out: Record<string, unknown> = {};
    for (const key of nativeKeys) out[key] = [startValues[key], startValues[key], startValues[key]];
    expect(result).toEqual({ out, stderr: "", exitCode: 0 });
  });

  // A Proxy with no traps hands every operation to process.env, with the Proxy as the receiver. JSC calls
  // the native setter with the Proxy as `this`. The write must reach process.env as a whole: the value that
  // process.env reads back and the native state must not differ.
  test("a write through a Proxy with no traps reaches process.env and its native state together", async () => {
    const result = await run(
      `
      const server = Bun.serve({ port: 0, tls: JSON.parse(process.env.TEST_TLS), fetch: () => new Response("ok") });
      const certificateCheck = () => fetch("https://localhost:" + server.port + "/").then(r => r.text()).then(() => "accepted", e => e.code);
      const proxy = new Proxy(process.env, {});
      const before = [timeZoneOffset(), await certificateCheck()];
      const out = {};
      for (const key of ["TZ", "NODE_TLS_REJECT_UNAUTHORIZED", "BUN_CONFIG_VERBOSE_FETCH", "HTTP_PROXY"]) {
        proxy[key] = writtenValues[key];
        out[key] = [process.env[key], proxy[key]];
      }
      const after = [timeZoneOffset(), await certificateCheck()];
      server.stop(true);
      console.log(JSON.stringify({ before, out, after }));
      `,
      // The other three keys are not set. TZ is, so that the first offset does not depend on the machine.
      { TZ: "Etc/UTC" },
      { TEST_TLS: JSON.stringify(tls) },
    );

    const out: Record<string, unknown> = {};
    for (const key of ["TZ", "NODE_TLS_REJECT_UNAUTHORIZED", "BUN_CONFIG_VERBOSE_FETCH", "HTTP_PROXY"]) {
      out[key] = [writtenValues[key], writtenValues[key]];
    }
    expect(result).toEqual({
      out: { before: [0, "DEPTH_ZERO_SELF_SIGNED_CERT"], out, after: [-540, "accepted"] },
      stderr: "",
      exitCode: 0,
    });
  });

  describe.each(variants)("$name", ({ setup, teardown }) => {
    // On Windows the first variant is a Proxy. Its set trap has never looked at the receiver, for any key.
    const skip = isWindows && setup === "";

    test.skipIf(skip)("a write with another receiver defines the property on that receiver", async () => {
      const result = await run(
        `
        ${setup}
        const before = state();
        const out = {};
        for (const key of keys) {
          const child = Object.create(process.env);
          child[key] = writtenValues[key];
          const receiver = {};
          const ok = Reflect.set(process.env, key, writtenValues[key], receiver);
          out[key] = [Object.getOwnPropertyDescriptor(child, key) ?? null, ok, receiver];
        }
        // With another receiver process.env is an ordinary prototype, as in Node: no ToString, and a symbol key is fine.
        const child = Object.create(process.env);
        child.ORDINARY = 1;
        child[Symbol.for("symbol")] = 2;
        console.log(JSON.stringify({ out, ordinary: [child.ORDINARY, child[Symbol.for("symbol")]], unchanged: state() === before }));
        ${teardown}
        `,
        startValues,
      );

      const out: Record<string, unknown> = {};
      for (const key of nativeKeys) {
        const value = writtenValues[key];
        out[key] = [{ value, writable: true, enumerable: true, configurable: true }, true, { [key]: value }];
      }
      expect(result).toEqual({ out: { out, ordinary: [1, 2], unchanged: true }, stderr: "", exitCode: 0 });
    });

    test.skipIf(skip)("a write with a receiver that rejects the property fails and changes nothing", async () => {
      const result = await run(
        `
        ${setup}
        const before = state();
        const out = {};
        for (const key of keys) {
          const value = writtenValues[key];
          const frozen = Object.freeze({});
          const traps = [];
          const proxy = new Proxy({}, new Proxy({}, { get: (_, trap) => void traps.push(trap) }));
          let strictMode = "no error";
          try {
            (function () {
              "use strict";
              Object.freeze(Object.create(process.env))[key] = value;
            })();
          } catch (e) {
            strictMode = e.name;
          }
          out[key] = {
            wasmStruct: Reflect.set(process.env, key, value, wasmStruct),
            frozen: [Reflect.set(process.env, key, value, frozen), Reflect.ownKeys(frozen)],
            primitive: Reflect.set(process.env, key, value, 1),
            proxy: [Reflect.set(process.env, key, value, proxy), traps],
            strictMode,
          };
        }
        console.log(JSON.stringify({ out, unchanged: state() === before }));
        ${teardown}
        `,
        startValues,
      );

      const out: Record<string, unknown> = {};
      for (const key of nativeKeys) {
        out[key] = {
          wasmStruct: false,
          frozen: [false, []],
          primitive: false,
          proxy: [true, ["getOwnPropertyDescriptor", "defineProperty"]],
          strictMode: "TypeError",
        };
      }
      expect(result).toEqual({ out: { out, unchanged: true }, stderr: "", exitCode: 0 });
    });
  });
});
