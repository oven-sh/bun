// process.env on the main thread is a live view of libc `environ`: JS writes
// reach native getenv()/setenv() and native writes reach process.env, so a
// `bun:ffi` getenv() or a native library reading its config from the
// environment sees the same values JS does. Node's RealEnvStore semantics.
//
// POSIX only: Windows already routes JS->OS through SetEnvironmentVariableW
// and has no libc `environ` contract to test against via bun:ffi.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isPosix, libcPathForDlopen } from "harness";

describe.skipIf(!isPosix)("process.env <-> libc environ on the main thread", () => {
  const libc = JSON.stringify(isPosix ? libcPathForDlopen() : "");
  const ffiPrelude = `
    const { dlopen } = require("bun:ffi");
    const libc = dlopen(${libc}, {
      getenv:   { args: ["cstring"], returns: "cstring" },
      setenv:   { args: ["cstring", "cstring", "int"], returns: "int" },
      unsetenv: { args: ["cstring"], returns: "int" },
    });
    const c = s => new TextEncoder().encode(s + "\\0");
    const cget = k => { const r = libc.symbols.getenv(c(k)); return r == null ? null : String(r) || null; };
  `;

  async function run(extraEnv: Record<string, string>, body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", ffiPrelude + body],
      env: { ...bunEnv, ...extraEnv },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.concurrent("JS writes reach native getenv()", async () => {
    const out = await run(
      { ENVSYNC_LAUNCH: "launchval", ENVSYNC_TODEL: "todel" },
      `
      process.env.ENVSYNC_NEW = "js-new";
      process.env.ENVSYNC_LAUNCH = "js-overwrote";
      delete process.env.ENVSYNC_TODEL;
      console.log(JSON.stringify({
        set:        cget("ENVSYNC_NEW"),
        overwrite:  cget("ENVSYNC_LAUNCH"),
        deleted:    cget("ENVSYNC_TODEL"),
      }));
    `,
    );
    expect(out).toEqual({ set: "js-new", overwrite: "js-overwrote", deleted: null });
  });

  test.concurrent("native setenv()/unsetenv() reach process.env", async () => {
    const out = await run(
      { ENVSYNC_PRESENT: "launchval" },
      `
      libc.symbols.setenv(c("ENVSYNC_FROMC"), c("c-set"), 1);
      libc.symbols.setenv(c("ENVSYNC_PRESENT"), c("c-overwrote"), 1);
      libc.symbols.unsetenv(c("ENVSYNC_PRESENT2"));
      process.env.ENVSYNC_JSDEL = "js-set";
      libc.symbols.unsetenv(c("ENVSYNC_JSDEL"));
      console.log(JSON.stringify({
        fromC:      process.env.ENVSYNC_FROMC ?? null,
        overwrite:  process.env.ENVSYNC_PRESENT ?? null,
        deletedJS:  process.env.ENVSYNC_JSDEL ?? null,
        keysHaveFromC: Object.keys(process.env).includes("ENVSYNC_FROMC"),
      }));
    `,
    );
    expect(out).toEqual({ fromC: "c-set", overwrite: "c-overwrote", deletedJS: null, keysHaveFromC: true });
  });

  test.concurrent("Object.keys reflects live environ", async () => {
    const out = await run(
      { ENVSYNC_ENUM: "x" },
      `
      const before = Object.keys(process.env).includes("ENVSYNC_ENUM");
      libc.symbols.unsetenv(c("ENVSYNC_ENUM"));
      const afterNativeUnset = Object.keys(process.env).includes("ENVSYNC_ENUM");
      libc.symbols.setenv(c("ENVSYNC_ENUM2"), c("y"), 1);
      const afterNativeSet = Object.keys(process.env).includes("ENVSYNC_ENUM2");
      console.log(JSON.stringify({ before, afterNativeUnset, afterNativeSet }));
    `,
    );
    expect(out).toEqual({ before: true, afterNativeUnset: false, afterNativeSet: true });
  });

  // Runtime process.env writes also update Bun's internal env map so
  // Bun.spawn({}) without an `env:` option inherits them.
  test.concurrent("Bun.spawn without env: inherits runtime process.env writes", async () => {
    const out = await run(
      {},
      `
      process.env.ENVSYNC_SPAWN = "via-js";
      const r = Bun.spawnSync({ cmd: [process.execPath, "-e", "process.stdout.write(process.env.ENVSYNC_SPAWN ?? 'unset')"] });
      console.log(JSON.stringify({ child: r.stdout.toString() }));
    `,
    );
    expect(out).toEqual({ child: "via-js" });
  });

  // Object.freeze/seal pass attribute-only descriptors for every key; those
  // must not reach unsetenv and wipe the OS environment.
  test.concurrent("Object.freeze(process.env) does not touch environ", async () => {
    const out = await run(
      { ENVSYNC_FREEZE: "kept" },
      `
      Object.freeze(process.env);
      Object.defineProperty(process.env, "ENVSYNC_FREEZE", { writable: false });
      console.log(JSON.stringify({
        native: cget("ENVSYNC_FREEZE"),
        js:     process.env.ENVSYNC_FREEZE ?? null,
        path:   cget("PATH") !== null,
      }));
    `,
    );
    expect(out).toEqual({ native: "kept", js: "kept", path: true });
  });

  test.concurrent("'in' operator matches native presence", async () => {
    const out = await run(
      { ENVSYNC_IN: "x" },
      `
      const a = "ENVSYNC_IN" in process.env;
      libc.symbols.unsetenv(c("ENVSYNC_IN"));
      const b = "ENVSYNC_IN" in process.env;
      const c_ = "ENVSYNC_NEVER" in process.env;
      console.log(JSON.stringify({ a, b, c: c_ }));
    `,
    );
    expect(out).toEqual({ a: true, b: false, c: false });
  });

  // Every process.env.X read allocates a fresh WTFStringImpl from getenv();
  // the C++ side must adopt (transferToWTFString), not ref-and-leak. With a
  // 4KB value the leaked case is ~80MB here; the fixed case is the per-read
  // transient-allocation overhead only (value-size-independent).
  test.concurrent("reading process.env in a tight loop does not leak", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.env.ENVSYNC_LEAK = Buffer.alloc(4096, "x").toString();
         for (let i = 0; i < 5000; i++) process.env.ENVSYNC_LEAK;
         Bun.gc(true);
         const before = process.memoryUsage().rss;
         for (let i = 0; i < 20000; i++) process.env.ENVSYNC_LEAK;
         Bun.gc(true);
         const after = process.memoryUsage().rss;
         console.log(JSON.stringify({ deltaMB: (after - before) / 1024 / 1024 }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { deltaMB } = JSON.parse(stdout);
    const threshold = isASAN || isDebug ? 40 : 20;
    expect(deltaMB).toBeLessThan(threshold);
  });
});

// A worker's transpiler must not inline process.env.X from the parent's env
// map: a worker spawned with `env: {X: "v"}` has to read its own value.
test("worker with env: option does not inline process.env.* from parent env", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const w = new Worker(
         'require("worker_threads").parentPort.postMessage({ a: process.env.ENVSYNC_WK, b: globalThis.process.env.ENVSYNC_WK })',
         { eval: true, env: { ENVSYNC_WK: "from-worker" } },
       );
       w.on("message", m => console.log(JSON.stringify(m)));`,
    ],
    env: { ...bunEnv, ENVSYNC_WK: "from-parent" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ a: "from-worker", b: "from-worker" });
  expect(exitCode).toBe(0);
});
