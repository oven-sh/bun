// Node's process.env is an exotic object (src/node_env_var.cc RealEnvStore):
// writes coerce to string, symbol keys/values throw, `=` / empty keys are
// silently dropped, NUL truncates, defineProperty rejects accessors and
// non-permissive descriptors, and every set/delete reaches libc setenv/
// unsetenv so native getenv() and os.homedir() stay in sync.
//
// On Windows, Bun's process.env is a Proxy (case-insensitive keys,
// SetEnvironmentVariableW write-through) whose set/delete already go through
// the coercing path; the tests here cover the POSIX exotic-object contract.
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows, libcPathForDlopen, tempDir } from "harness";
import path from "path";

const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");

describe("process.env node semantics", () => {
  // Writes now reach real setenv(), so a failed assertion would leak the var
  // into environ; clean up unconditionally.
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

    process.env[""] = "x";
    expect("" in process.env).toBe(false);
    expect(process.env[""]).toBeUndefined();
  });

  test.skipIf(isWindows)("NUL in value truncates at NUL", () => {
    process.env.ENVFIX_NUL = "ab\x00cd";
    expect(process.env.ENVFIX_NUL).toBe("ab");
  });

  test.skipIf(isWindows)("NUL in key truncates at NUL", () => {
    process.env["ENVFIX_K\x00TAIL"] = "v";
    expect(process.env.ENVFIX_K).toBe("v");
    expect(process.env["ENVFIX_K\x00TAIL"]).toBe("v");
  });

  test("Object.freeze / seal / preventExtensions throw TypeError", async () => {
    // A fail-before run (old plain-object process.env) would actually freeze
    // the runner's env and poison later tests, so probe in a subprocess.
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

  test.skipIf(isWindows)("$-prefixed keys are read back as-is (no bunfig-interpolation strip)", () => {
    expect(process.env["$PATH"]).toBeUndefined();
    expect("$PATH" in process.env).toBe(false);
    process.env["$ENVFIX_DOLLAR"] = "x";
    expect(process.env["$ENVFIX_DOLLAR"]).toBe("x");
    expect(process.env["ENVFIX_DOLLAR"]).toBeUndefined();
    delete process.env["$ENVFIX_DOLLAR"];
  });

  test("coerced value reaches a spawned child's inherited env", async () => {
    process.env.ENVFIX_SPAWN = 3000 as unknown as string;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdout.write(typeof process.env.ENVFIX_SPAWN + ":" + process.env.ENVFIX_SPAWN)`],
      env: { ...process.env },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("string:3000");
    expect(exitCode).toBe(0);
  });
});

// These exercise the setenv sync and the env_var::HOME cache invalidation,
// which only exist on POSIX (Windows uses uv_os_homedir / the env Proxy).
describe.skipIf(!isPosix)("process.env setenv sync + typed-cache invalidation", () => {
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

  test("process.env write reaches native getenv()", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        getenvProbe +
          `
          process.env.ENVFIX_SETENV = "from-js";
          process.stdout.write(JSON.stringify(read("ENVFIX_SETENV")));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`"from-js"`);
    expect(exitCode).toBe(0);
  });

  test("delete process.env.X reaches native unsetenv()", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        getenvProbe +
          `
          const before = read("ENVFIX_SEEDED");
          delete process.env.ENVFIX_SEEDED;
          const after = read("ENVFIX_SEEDED");
          process.stdout.write(JSON.stringify({ before, after }));
        `,
      ],
      env: { ...bunEnv, ENVFIX_SEEDED: "present" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ before: "present", after: null });
    expect(exitCode).toBe(0);
  });

  test("NUL-containing value after founding a SHARE_ENV tree truncates (no panic)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker, SHARE_ENV } = require("node:worker_threads");
          const w = new Worker("require('node:worker_threads').parentPort.postMessage(1)", { eval: true, env: SHARE_ENV });
          await new Promise(r => w.on("exit", r));
          process.env.ENVFIX_SNUL = "ab\\x00cd";
          process.stdout.write(JSON.stringify(process.env.ENVFIX_SNUL));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // JSSharedEnvMap::put stores the un-truncated string in the shared store,
    // so the readback is "ab\0cd"; syncOSEnv's Bun__ProcessEnv__put truncates
    // for the env_loader map / setenv so no CString panic.
    expect(JSON.parse(stdout)).toBe("ab\x00cd");
    expect(exitCode).toBe(0);
  });

  test("process.env write still reaches setenv() after founding a SHARE_ENV tree", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        getenvProbe +
          `
          const { Worker, SHARE_ENV } = require("node:worker_threads");
          const w = new Worker("require('node:worker_threads').parentPort.postMessage(1)", { eval: true, env: SHARE_ENV });
          await new Promise(r => w.on("exit", r));
          process.env.ENVFIX_POSTSWAP = "after-swap";
          process.stdout.write(JSON.stringify({ getenv: read("ENVFIX_POSTSWAP"), homedir: (() => {
            const os = require("node:os");
            os.homedir();
            process.env.HOME = "/tmp/envfix-post";
            return os.homedir();
          })() }));
        `,
      ],
      env: { ...bunEnv, HOME: "/tmp/envfix-before" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ getenv: "after-swap", homedir: "/tmp/envfix-post" });
    expect(exitCode).toBe(0);
  });

  test("os.homedir() observes process.env.HOME = ... (typed cache invalidated)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const os = require("node:os");
          const before = os.homedir();
          process.env.HOME = "/tmp/envfix-home";
          const after = os.homedir();
          process.stdout.write(JSON.stringify({ before, after }));
        `,
      ],
      env: { ...bunEnv, HOME: "/tmp/envfix-before" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ before: "/tmp/envfix-before", after: "/tmp/envfix-home" });
    expect(exitCode).toBe(0);
  });
});

// Duplicate KEY= entries in environ and entries with no '=' require a custom
// execve() launcher to inject them, since Bun.spawn's env object can't express
// either.
describe.skipIf(!isPosix || !cc)("environ load: first-wins duplicates, drop no-'=' entries", () => {
  async function compile(dir: string, src: string, out: string) {
    await using compile = Bun.spawn({
      cmd: [cc!, "-O0", "-o", path.join(dir, out), path.join(dir, src)],
      env: bunEnv,
      stderr: "pipe",
    });
    const [, cerr, ccode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
    if (ccode !== 0) throw new Error(`compile failed: ${cerr}`);
    return path.join(dir, out);
  }

  test("duplicate keys resolve to the FIRST occurrence", async () => {
    using dir = tempDir("envfix-dup", {
      "launch.c": `
        #include <stdio.h>
        #include <unistd.h>
        int main(int argc, char **argv) {
          if (argc < 2) return 2;
          char *env[] = {
            "ENVFIX_DUP=/first",
            "ENVFIX_DUP=/second",
            "PATH=/usr/bin:/bin:/usr/local/bin",
            "BUN_DEBUG_QUIET_LOGS=1",
            "NO_COLOR=1",
            0,
          };
          execve(argv[1], &argv[1], env);
          perror("execve");
          return 127;
        }
      `,
    });
    const bin = await compile(String(dir), "launch.c", "launch");
    await using proc = Bun.spawn({
      cmd: [bin, bunExe(), "-e", `process.stdout.write(process.env.ENVFIX_DUP ?? "<unset>")`],
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("/first");
    expect(exitCode).toBe(0);
  });

  test("entry with no '=' is dropped, not fabricated as empty", async () => {
    using dir = tempDir("envfix-noeq", {
      "launch.c": `
        #include <stdio.h>
        #include <unistd.h>
        int main(int argc, char **argv) {
          if (argc < 2) return 2;
          char *env[] = {
            "ENVFIX_BARE",
            "PATH=/usr/bin:/bin:/usr/local/bin",
            "BUN_DEBUG_QUIET_LOGS=1",
            "NO_COLOR=1",
            0,
          };
          execve(argv[1], &argv[1], env);
          perror("execve");
          return 127;
        }
      `,
    });
    const bin = await compile(String(dir), "launch.c", "launch");
    await using proc = Bun.spawn({
      cmd: [
        bin,
        bunExe(),
        "-e",
        `process.stdout.write(JSON.stringify({ has: "ENVFIX_BARE" in process.env, val: process.env.ENVFIX_BARE ?? null }))`,
      ],
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ has: false, val: null });
    expect(exitCode).toBe(0);
  });
});
