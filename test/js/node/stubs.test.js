import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import repl from "node:repl";
import { inspect } from "node:util";

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

describe("node:repl stub", () => {
  // The module export used to masquerade as a REPLServer instance with
  // `context: globalThis`, so libraries that feature-detect a REPL by probing
  // `repl.context` and writing to it would silently pollute the real global.
  test("does not expose REPLServer instance fields on the module", () => {
    const instanceFields = ["context", "terminal", "useGlobal", "lines", "history", "input", "output", "eval"];
    expect(Object.fromEntries(instanceFields.map(k => [k, { in: k in repl, value: repl[k] }]))).toEqual(
      Object.fromEntries(instanceFields.map(k => [k, { in: false, value: undefined }])),
    );
  });

  test("writing through repl.context cannot pollute globalThis", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const repl = require("node:repl");
        let threw = false;
        try {
          repl.context.__pollutedByReplStub = 42;
        } catch {
          threw = true;
        }
        console.log(JSON.stringify({
          threw,
          contextIsGlobalThis: repl.context === globalThis,
          polluted: globalThis.__pollutedByReplStub,
        }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: {
        threw: true,
        contextIsGlobalThis: false,
        polluted: undefined,
      },
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("exposes Node's module-level exports", () => {
    expect(typeof repl.start).toBe("function");
    expect(typeof repl.REPLServer).toBe("function");
    expect(typeof repl.Recoverable).toBe("function");
    expect(typeof repl.writer).toBe("function");
    expect(typeof repl.REPL_MODE_SLOPPY).toBe("symbol");
    expect(typeof repl.REPL_MODE_STRICT).toBe("symbol");
    expect(repl.REPL_MODE_SLOPPY).not.toBe(repl.REPL_MODE_STRICT);
    expect(Array.isArray(repl._builtinLibs)).toBe(true);
    expect(Array.isArray(repl.builtinModules)).toBe(true);
  });

  test("writer() forwards to util.inspect with writer.options", () => {
    const value = { a: 1, b: [2, 3], c: { d: 4 } };
    expect(repl.writer.options).toEqual(inspect.replDefaults);
    expect(repl.writer(value)).toBe(inspect(value, repl.writer.options));
  });

  test("start() throws ERR_NOT_IMPLEMENTED", () => {
    expect(() => repl.start()).toThrow(expect.objectContaining({ code: "ERR_NOT_IMPLEMENTED" }));
  });

  test("REPLServer() throws ERR_NOT_IMPLEMENTED", () => {
    expect(() => new repl.REPLServer()).toThrow(expect.objectContaining({ code: "ERR_NOT_IMPLEMENTED" }));
  });

  test("Recoverable wraps an error", () => {
    const cause = new SyntaxError("boom");
    const r = new repl.Recoverable(cause);
    expect(r).toBeInstanceOf(SyntaxError);
    expect(r.err).toBe(cause);
  });
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
