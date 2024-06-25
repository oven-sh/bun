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
