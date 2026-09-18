import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, rmScope, tempDir } from "harness";
import * as fs from "node:fs";

// The disposal paths in harness.ts (tempDir's DisposableString and rmScope)
// append a diagnostic to EBUSY/EPERM on Windows so test authors don't have to
// re-bisect "a process spawned by the test still holds the temp dir" (see
// #31688, #36971). These tests pin that behavior: the diagnostic is appended,
// the original error still propagates with its code intact, and everything
// else passes through unchanged.

const DIAGNOSTIC = "as its working directory or has an open handle inside it";

test.skipIf(!isWindows)("temp dir removal failures name the likely process hold on Windows", async () => {
  // Deliberately no `using`: the disposal calls are the subject under test.
  const dir = tempDir("rm-diagnostic", { "a.txt": "x" });
  const held = String(dir);

  // A live child whose cwd is inside the dir holds it open for as long as the
  // child exists, so every removal attempt below fails deterministically. The
  // cwd handle is established by the child-side loader after CreateProcess
  // returns, so wait for the child to print before touching the dir.
  const child = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('ready'); setInterval(() => {}, 1000)"],
    env: bunEnv,
    cwd: held,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  try {
    const reader = child.stdout.getReader();
    let started = "";
    while (!started.includes("ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      started += new TextDecoder().decode(value);
    }
    expect(started).toContain("ready");

    let syncError: NodeJS.ErrnoException | undefined;
    try {
      dir[Symbol.dispose]();
    } catch (error) {
      syncError = error as NodeJS.ErrnoException;
    }
    expect(syncError).toBeDefined();
    expect(["EBUSY", "EPERM"]).toContain(syncError!.code);
    expect(syncError!.message).toContain(DIAGNOSTIC);
    expect(syncError!.message).toContain(held);

    let asyncError: NodeJS.ErrnoException | undefined;
    try {
      await dir[Symbol.asyncDispose]();
    } catch (error) {
      asyncError = error as NodeJS.ErrnoException;
    }
    expect(asyncError).toBeDefined();
    expect(["EBUSY", "EPERM"]).toContain(asyncError!.code);
    expect(asyncError!.message).toContain(DIAGNOSTIC);

    let scopeError: NodeJS.ErrnoException | undefined;
    try {
      rmScope(held)[Symbol.dispose]();
    } catch (error) {
      scopeError = error as NodeJS.ErrnoException;
    }
    expect(scopeError).toBeDefined();
    expect(["EBUSY", "EPERM"]).toContain(scopeError!.code);
    expect(scopeError!.message).toContain(DIAGNOSTIC);
  } finally {
    child.kill();
    await child.exited;
    // Clean the dir up for real. Handle release after exit is asynchronous,
    // which is the whole point of the diagnostic, so poll with a deadline.
    for (let attempt = 0; ; attempt++) {
      try {
        dir[Symbol.dispose]();
        break;
      } catch (error) {
        if (attempt >= 100) throw error;
        await Bun.sleep(50);
      }
    }
  }
  expect(fs.existsSync(held)).toBe(false);
});

test.skipIf(!isWindows)("temp dir removal failures name the test process's own cwd hold on Windows", () => {
  const dir = tempDir("rm-diagnostic-cwd", { "a.txt": "x" });
  const held = String(dir);
  const original = process.cwd();
  try {
    process.chdir(held);
    let error: NodeJS.ErrnoException | undefined;
    try {
      dir[Symbol.dispose]();
    } catch (thrown) {
      error = thrown as NodeJS.ErrnoException;
    }
    expect(error).toBeDefined();
    expect(["EBUSY", "EPERM"]).toContain(error!.code);
    expect(error!.message).toContain("This test process's own working directory");
    expect(error!.message).not.toContain(DIAGNOSTIC);
  } finally {
    process.chdir(original);
  }
  // chdir is synchronous in this process, so disposal succeeds immediately.
  dir[Symbol.dispose]();
  expect(fs.existsSync(held)).toBe(false);
});

test("non-matching removal errors pass through unchanged", () => {
  // A path with a NUL byte fails validation before any syscall, on every
  // platform, with no `code` matching the diagnostic guard: the error must
  // come through the disposal catch untouched.
  let error: Error | undefined;
  try {
    rmScope("\0")[Symbol.dispose]();
  } catch (thrown) {
    error = thrown as Error;
  }
  expect(error).toBeDefined();
  expect(error!.message).not.toContain(DIAGNOSTIC);
});

test("tempDir sync dispose removes the dir when nothing holds it", () => {
  let p: string = "";
  {
    using dir = tempDir("rm-diagnostic-sync", { "a.txt": "x" });
    p = String(dir);
    expect(fs.existsSync(p)).toBe(true);
  }
  expect(fs.existsSync(p)).toBe(false);
});

test("tempDir async dispose removes the dir when nothing holds it", async () => {
  let p: string = "";
  {
    await using dir = tempDir("rm-diagnostic-async", { "a.txt": "x" });
    p = String(dir);
    expect(fs.existsSync(p)).toBe(true);
  }
  expect(fs.existsSync(p)).toBe(false);
});
