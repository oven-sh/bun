import { describe, expect, test } from "bun:test";

const weirdInternalSpecifiers = [
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_wrap",
  "_stream_writable",
  "_tls_common",
  "_tls_wrap",
];

// Check that all the node modules comply with the expected interface in bun
var specifiers = [
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];
specifiers = [...weirdInternalSpecifiers, ...specifiers.flatMap(a => ["node:" + a, a])];

for (let specifier of specifiers) {
  test(`stubbed CJS import.meta.require ${specifier}`, async () => {
    import.meta.require(specifier);
  });

  test(`stubbed CJS require ${specifier}`, async () => {
    require(specifier);
  });

  test(`stubbed import ${specifier}`, async () => {
    const mod = await import(specifier);
    if ("default" in mod) {
      expect(mod).toHaveProperty("default");
    } else {
      throw new Error(`Module ${specifier} has no default export`);
    }
  });
}

// hideFromStack() in src/js/internal/shared.ts hides a throw helper from printed errors by renaming it.
// A function that a program can reach keeps its own name.
test("no public export of the modules above has the name that hides a stack frame", () => {
  const seen = new Set();
  const renamed = [];
  const walk = (value, path, depth, isModule) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return;
    // node:module holds the modules that the test run loaded. They are not builtin.
    if (value === require.cache) return;
    seen.add(value);
    if (typeof value === "function" && Object.getOwnPropertyDescriptor(value, "name")?.value === "::bunternal::") {
      renamed.push(path);
    }
    if (depth === 0) return;
    for (const key of Reflect.ownKeys(value)) {
      const { value: held, get, set } = Object.getOwnPropertyDescriptor(value, key);
      const name = `${path}.${String(key)}`;
      // A module loads some of its exports when a program first reads them.
      if (isModule && get) walk(get.call(value), name, depth - 1, false);
      for (const next of [held, get, set]) walk(next, name, depth - 1, false);
    }
  };
  for (const specifier of specifiers) {
    const module = require(specifier);
    // The getters of process are not read: some of them open a stream.
    walk(module, specifier, 6, module !== process);
  }

  expect(seen.has(require("node:v8").startupSnapshot.addSerializeCallback)).toBe(true);
  expect(seen.has(require("node:inspector").Session.prototype.post)).toBe(true);
  expect(seen.has(require("node:util").inspect)).toBe(true);
  // The throw helpers that node:http2 hands to the tests of Node.js.
  expect(renamed).toEqual([
    "node:http2.Symbol(::bunhttp2internals::).util.assertIsObject",
    "node:http2.Symbol(::bunhttp2internals::).util.assertIsArray",
    "node:http2.Symbol(::bunhttp2internals::).util.assertValidPseudoHeader",
  ]);
});

test("you can import bun:test", async () => {
  const bunTest1 = await import("bun:test" + String(""));
  const bunTest2 = require("bun:test" + String(""));
});

describe("v8.getHeapStatistics", () => {
  const stats = require("v8").getHeapStatistics();

  for (let key in stats) {
    test(key, () => {
      if (key === "does_zap_garbage" || key === "number_of_detached_contexts") {
        expect(stats[key]).toBe(0);
        return;
      }
      expect(stats[key]).toBeNumber();
      expect(stats[key]).toBePositive();
    });
  }
});

describe("v8.startupSnapshot", () => {
  // https://github.com/oven-sh/bun/issues/32501
  test("isBuildingSnapshot() returns false", () => {
    const { startupSnapshot } = require("node:v8");
    expect(startupSnapshot.isBuildingSnapshot()).toBe(false);
  });

  test("isBuildingSnapshot() returns false via process.getBuiltinModule", () => {
    const { startupSnapshot } = process.getBuiltinModule("v8");
    expect(startupSnapshot.isBuildingSnapshot()).toBe(false);
  });
});
