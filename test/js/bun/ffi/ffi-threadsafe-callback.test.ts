import { expect, test } from "bun:test";
import path from "node:path";
import { bunEnv, bunExe, isArm64, isMacOS, isWindows, tempDir } from "harness";

// TinyCC (and all of bun:ffi) is disabled on Windows ARM64.
// On Windows x64 there is no system `cc`, so skip there too — the bug being
// covered (JSC::Strong<> copied on a non-JS thread) is platform-independent.
const canRun = !isWindows && !(isWindows && isArm64);

// JSCallback({ threadsafe: true }) routes through FFI_Callback_threadsafe_call
// which may be invoked from any native thread. Previously it captured the
// FFICallbackFunctionWrapper by value, invoking JSC::Strong<>'s copy
// constructor (HandleSet::allocate) on that foreign thread and racing with
// the main-thread GC/HandleSet. This test compiles a tiny shared library
// that fires the callback from real pthreads while the JS thread churns
// HandleSet allocations, then verifies the process completes cleanly with
// the expected callback count.
test.skipIf(!canRun)("threadsafe JSCallback invoked from a native thread", async () => {
  const srcDir = import.meta.dir;
  const libName = isMacOS ? "libthreadsafecb.dylib" : "libthreadsafecb.so";

  using dir = tempDir("ffi-threadsafe-cb", {});
  const outDir = String(dir);
  const libPath = path.join(outDir, libName);

  {
    const cmd = ["cc", "-shared", "-fPIC", "-o", libPath];
    if (!isMacOS) cmd.push("-pthread");
    cmd.push(path.join(srcDir, "threadsafe-callback.c"));
    await using cc = Bun.spawn({ cmd, stderr: "pipe", stdout: "pipe" });
    const [stderr, exitCode] = await Promise.all([cc.stderr.text(), cc.exited]);
    if (exitCode !== 0) {
      throw new Error("failed to compile threadsafe-callback.c: " + stderr);
    }
  }

  const fixture = /* js */ `
    const { dlopen, JSCallback } = require("bun:ffi");

    const lib = dlopen(${JSON.stringify(libPath)}, {
      start_threads: { args: ["ptr", "int32_t", "int32_t"], returns: "void" },
      join_threads: { args: [], returns: "void" },
    });

    const perThread = 5000;
    const nthreads = 4;
    const total = perThread * nthreads;
    let received = 0;

    const cb = new JSCallback(
      (i) => {
        received++;
      },
      { args: ["int32_t"], returns: "void", threadsafe: true },
    );

    lib.symbols.start_threads(cb.ptr, perThread, nthreads);

    // While native threads are posting tasks, keep the JS thread busy
    // allocating and freeing Strong<> handles so the HandleSet free list is
    // under contention. Creating/closing JSCallbacks exercises the exact same
    // HandleSet that the buggy trampoline was mutating off-thread.
    const noop = () => {};
    const noopOpts = { args: [], returns: "void" };
    while (received < total) {
      for (let i = 0; i < 64; i++) {
        const tmp = new JSCallback(noop, noopOpts);
        tmp.close();
      }
      // Drain any posted threadsafe callbacks.
      await new Promise((resolve) => setImmediate(resolve));
    }

    lib.symbols.join_threads();

    // Drain any callbacks that were posted after the loop above observed
    // the count but before join returned.
    while (received < total) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (received !== total) {
      throw new Error("received " + received + " expected " + total);
    }

    // Force a full GC so a corrupted strong-handle list is walked.
    Bun.gc(true);

    cb.close();
    lib.close();
    console.log("OK " + received);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK 20000");
  expect(exitCode).toBe(0);
});
