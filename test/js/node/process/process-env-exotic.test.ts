// Node's process.env is an exotic object over the OS environment
// (src/node_env_var.cc RealEnvStore): writes coerce to string, symbol keys and
// values throw, a name that is empty or contains '=' is silently dropped, a
// key or value is cut at its first NUL, defineProperty rejects accessors and
// non-permissive descriptors, freeze/seal/preventExtensions throw, and every
// set/delete reaches setenv/unsetenv so native getenv() stays in sync.
//
// On Windows process.env is a Proxy (case-insensitive keys,
// SetEnvironmentVariableW write-through) that applies the same rules in its
// set/defineProperty/deleteProperty traps.
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, libcPathForDlopen, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

describe("process.env node semantics", () => {
  // Writes reach the real OS environment, so a failed assertion would leak the
  // var into environ; clean up unconditionally.
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("ENVFIX_")) delete process.env[k];
    }
  });

  test("assigned values are coerced to strings", () => {
    process.env.ENVFIX_NUM = 3000 as unknown as string;
    expect(process.env.ENVFIX_NUM).toBe("3000");
    expect(typeof process.env.ENVFIX_NUM).toBe("string");

    process.env.ENVFIX_UNDEF = undefined as unknown as string;
    expect(process.env.ENVFIX_UNDEF).toBe("undefined");
    expect(typeof process.env.ENVFIX_UNDEF).toBe("string");

    process.env.ENVFIX_BOOL = true as unknown as string;
    expect(process.env.ENVFIX_BOOL).toBe("true");

    process.env.ENVFIX_OBJ = { toString: () => "from-toString" } as unknown as string;
    expect(process.env.ENVFIX_OBJ).toBe("from-toString");
  });

  test("symbol value throws TypeError on assignment", () => {
    expect(() => {
      process.env.ENVFIX_SYM = Symbol("x") as unknown as string;
    }).toThrow(TypeError);
    expect("ENVFIX_SYM" in process.env).toBe(false);
  });

  test("symbol key throws TypeError on assignment", () => {
    const key = Symbol("env-key");
    expect(() => {
      (process.env as Record<PropertyKey, string>)[key] = "v";
    }).toThrow(TypeError);
  });

  test("'=' in key and empty key are silently ignored", () => {
    process.env["A=B"] = "x";
    expect("A=B" in process.env).toBe(false);
    expect(process.env["A=B"]).toBeUndefined();
    expect(process.env.A).toBeUndefined();

    process.env[""] = "x";
    expect("" in process.env).toBe(false);
    expect(process.env[""]).toBeUndefined();

    Object.defineProperty(process.env, "C=D", { value: "v", writable: true, enumerable: true, configurable: true });
    expect("C=D" in process.env).toBe(false);
  });

  test("NUL in value truncates at NUL", () => {
    process.env.ENVFIX_NUL = "ab\x00cd";
    expect(process.env.ENVFIX_NUL).toBe("ab");

    Object.defineProperty(process.env, "ENVFIX_DPNUL", {
      value: "a\x00b",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(process.env.ENVFIX_DPNUL).toBe("a");
  });

  test("NUL in key truncates at NUL", () => {
    process.env["ENVFIX_K\x00TAIL"] = "v";
    expect(process.env.ENVFIX_K).toBe("v");
    expect(Object.keys(process.env).filter(k => k.startsWith("ENVFIX_K"))).toEqual(["ENVFIX_K"]);

    // A name that is nothing but a NUL tail is an empty name.
    process.env["\x00ENVFIX_LEAD"] = "y";
    expect("" in process.env).toBe(false);
    expect(process.env["\x00ENVFIX_LEAD"]).toBeUndefined();

    delete process.env["ENVFIX_K\x00TAIL"];
    expect("ENVFIX_K" in process.env).toBe(false);
  });

  test("Object.freeze / seal / preventExtensions throw TypeError", async () => {
    // A fail-before run (an object that accepts preventExtensions) would
    // actually freeze the runner's env and poison later tests, so probe in a
    // subprocess.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const probe = fn => { try { fn(); return null; } catch (e) { return e.constructor.name; } };
          process.stdout.write(JSON.stringify({
            freeze: probe(() => Object.freeze(process.env)),
            seal: probe(() => Object.seal(process.env)),
            prevExt: probe(() => Object.preventExtensions(process.env)),
            isExt: Object.isExtensible(process.env),
            stillWritable: (process.env.ENVFIX_AFTER = "x", process.env.ENVFIX_AFTER),
          }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      freeze: "TypeError",
      seal: "TypeError",
      prevExt: "TypeError",
      isExt: true,
      stillWritable: "x",
    });
    expect(exitCode).toBe(0);
  });

  test("defineProperty rejects accessor descriptors", () => {
    expect(() => {
      Object.defineProperty(process.env, "ENVFIX_ACCESSOR", { get: () => "x" });
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY" }));
    expect("ENVFIX_ACCESSOR" in process.env).toBe(false);
  });

  test("defineProperty rejects non-permissive data descriptors", () => {
    expect(() => {
      Object.defineProperty(process.env, "ENVFIX_RO", { value: "x", writable: false });
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY" }));
    expect(() => {
      Object.defineProperty(process.env, "ENVFIX_RO", { value: "x" });
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY" }));
  });

  test("defineProperty with a fully-permissive data descriptor coerces and sets", () => {
    Object.defineProperty(process.env, "ENVFIX_DEF", {
      value: 42,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    expect(process.env.ENVFIX_DEF).toBe("42");
  });

  test("defineProperty with a Symbol value throws TypeError", () => {
    expect(() => {
      Object.defineProperty(process.env, "ENVFIX_SYMDEF", {
        value: Symbol("x"),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }).toThrow(TypeError);
    expect("ENVFIX_SYMDEF" in process.env).toBe(false);
  });

  test("delete removes the key and preserves remaining key order", () => {
    process.env.ENVFIX_A = "a";
    process.env.ENVFIX_B = "b";
    process.env.ENVFIX_C = "c";
    expect(delete process.env.ENVFIX_B).toBe(true);
    expect("ENVFIX_B" in process.env).toBe(false);
    expect(process.env.ENVFIX_B).toBeUndefined();
    expect(Object.keys(process.env).filter(k => k.startsWith("ENVFIX_"))).toEqual(["ENVFIX_A", "ENVFIX_C"]);
  });

  test("coerced and NUL-cut values reach a spawned child's inherited env", async () => {
    process.env.ENVFIX_SPAWN = 3000 as unknown as string;
    process.env.ENVFIX_SPAWN_NUL = "ab\x00cd";
    process.env["ENVFIX_SPAWN_K\x00TAIL"] = "k";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(JSON.stringify([typeof process.env.ENVFIX_SPAWN, process.env.ENVFIX_SPAWN, process.env.ENVFIX_SPAWN_NUL, process.env.ENVFIX_SPAWN_K]))`,
      ],
      env: { ...process.env },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["string", "3000", "ab", "k"]);
    expect(exitCode).toBe(0);
  });
});

// The OS-environment write-through only exists on POSIX (Windows already wrote
// through to SetEnvironmentVariableW).
describe.skipIf(!isPosix)("process.env writes reach the OS environment", () => {
  // child_process with no `env:` serializes process.env (the JS object), so a
  // spawned child cannot distinguish a JS-only write from a real setenv(). Use
  // libc getenv() via FFI in the same process to prove the write reached
  // `environ`.
  const getenvProbe = `
    const { dlopen, CString } = require("bun:ffi");
    const { symbols: { getenv } } = dlopen(${JSON.stringify(isPosix ? libcPathForDlopen() : "")}, {
      getenv: { args: ["cstring"], returns: "ptr" },
    });
    const read = name => {
      const ptr = getenv(Buffer.from(name + "\\0"));
      return ptr ? new CString(ptr).toString() : null;
    };
  `;

  async function run(script: string, extraEnv: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", getenvProbe + script],
      env: { ...bunEnv, ...extraEnv },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.concurrent("set, overwrite and delete reach native getenv()", async () => {
    const out = await run(
      `
        process.env.ENVFIX_NEW = "from-js";
        process.env.ENVFIX_LAUNCH = "overwritten";
        process.env.ENVFIX_NUM = 42;
        delete process.env.ENVFIX_TODEL;
        // Every execution of one assignment site must reach the OS, not only
        // the first one before JSC caches the store.
        const repeated = [];
        for (let i = 0; i < 4; i++) {
          process.env.ENVFIX_LOOP = i;
          repeated.push(read("ENVFIX_LOOP"));
        }
        process.stdout.write(JSON.stringify({
          set: read("ENVFIX_NEW"),
          overwrite: read("ENVFIX_LAUNCH"),
          coerced: read("ENVFIX_NUM"),
          deleted: read("ENVFIX_TODEL"),
          repeated,
        }));
      `,
      { ENVFIX_LAUNCH: "launch", ENVFIX_TODEL: "present" },
    );
    expect(out).toEqual({
      set: "from-js",
      overwrite: "overwritten",
      coerced: "42",
      deleted: null,
      repeated: ["0", "1", "2", "3"],
    });
  });

  test.concurrent("a dropped name or a NUL-cut value never reaches the OS environment as written", async () => {
    const out = await run(`
      process.env["ENVFIX_EQ=X"] = "v";
      process.env.ENVFIX_NUL = "ab\\x00cd";
      process.env["ENVFIX_KEYNUL\\x00TAIL"] = "k";
      process.stdout.write(JSON.stringify({
        eq: read("ENVFIX_EQ"),
        nul: read("ENVFIX_NUL"),
        keyNul: read("ENVFIX_KEYNUL"),
      }));
    `);
    expect(out).toEqual({ eq: null, nul: "ab", keyNul: "k" });
  });

  test.concurrent("Bun.spawn and Bun.which without an env option observe runtime writes", async () => {
    using dir = tempDir("envfix-path", { "envfix-tool": "#!/bin/sh\nprintf found\n" });
    chmodSync(join(String(dir), "envfix-tool"), 0o755);
    const out = await run(
      `
        process.env.ENVFIX_SPAWN = "via-js";
        delete process.env.ENVFIX_SPAWN_DEL;
        const child = Bun.spawnSync({
          cmd: ["/bin/sh", "-c", 'printf "%s,%s" "\${ENVFIX_SPAWN-unset}" "\${ENVFIX_SPAWN_DEL-unset}"'],
        }).stdout.toString();
        const before = Bun.which("envfix-tool");
        process.env.PATH = process.env.ENVFIX_TOOL_DIR + ":" + process.env.PATH;
        const after = Bun.which("envfix-tool") !== null;
        const ran = Bun.spawnSync({ cmd: ["envfix-tool"] }).stdout.toString();
        process.stdout.write(JSON.stringify({ child, before, after, ran }));
      `,
      { ENVFIX_SPAWN_DEL: "startup", ENVFIX_TOOL_DIR: String(dir) },
    );
    expect(out).toEqual({ child: "via-js,unset", before: null, after: true, ran: "found" });
  });

  test.concurrent("a worker_threads Worker starts from the parent's current process.env", async () => {
    const out = await run(
      `
      process.env.ENVFIX_WORKER = "from-parent-js";
      delete process.env.ENVFIX_WORKER_DEL;
      const { Worker } = require("node:worker_threads");
      const w = new Worker(
        'require("node:worker_threads").parentPort.postMessage([process.env.ENVFIX_WORKER ?? null, process.env.ENVFIX_WORKER_DEL ?? null])',
        { eval: true },
      );
      const msg = await new Promise(r => w.once("message", r));
      process.stdout.write(JSON.stringify(msg));
    `,
      { ENVFIX_WORKER_DEL: "startup" },
    );
    expect(out).toEqual(["from-parent-js", null]);
  });

  test.concurrent("a write after founding a SHARE_ENV tree still reaches native getenv()", async () => {
    const out = await run(
      `
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      const w = new Worker("require('node:worker_threads').parentPort.postMessage(1)", { eval: true, env: SHARE_ENV });
      await new Promise(r => w.on("exit", r));
      process.env.ENVFIX_POSTSWAP = "after-swap";
      process.env.ENVFIX_SNUL = "ab\\x00cd";
      delete process.env.ENVFIX_SWAPDEL;
      process.stdout.write(JSON.stringify({
        set: read("ENVFIX_POSTSWAP"),
        nul: read("ENVFIX_SNUL"),
        js: process.env.ENVFIX_SNUL,
        deleted: read("ENVFIX_SWAPDEL"),
      }));
    `,
      { ENVFIX_SWAPDEL: "present" },
    );
    // The shared store keeps the JS string as written; only the OS copy is cut.
    expect(out).toEqual({ set: "after-swap", nul: "ab", js: "ab\x00cd", deleted: null });
  });
});
