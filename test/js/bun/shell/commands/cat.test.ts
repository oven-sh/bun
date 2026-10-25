import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, libcPathForDlopen, tempDir } from "harness";
import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

// On POSIX `cat` is the system binary unless this flag is set. On Windows the builtin is the default.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// Runs `script` in a child and returns its output, which ends with an `exit=<code>` line unless the child hung or crashed.
async function runScript(script: string, stdin: string | number, quiet: boolean) {
  const run = `Bun.$\`\${{ raw: ${JSON.stringify(script)} }}\`.nothrow()`;
  const trailer = `process.stdout.write("exit=" + r.exitCode + "\\n");`;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      quiet
        ? `const r = await ${run}.quiet(); process.stdout.write(r.stdout); ${trailer}`
        : `const r = await ${run}; ${trailer}`,
    ],
    env: builtinEnv,
    stdin: typeof stdin === "number" ? stdin : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (typeof stdin === "string") {
    proc.stdin!.write(stdin);
    proc.stdin!.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every `cat` reading the same stdin registers with one shared reader.
describe.concurrent("cat (builtin) sharing one stdin reader", () => {
  test.each([
    ["cat; echo ---; cat", "hi\n", true, "hi\n---\n"],
    // With inherited stdout, a command can also finish in a write callback after the EOF callback returned.
    ["cat; echo ---; cat", "hi\n", false, "hi\n---\n"],
    ["cat; cat; cat; cat; cat; cat; echo ---", "hi\n", true, "hi\n---\n"],
    // The subshell reuses the first cat's node id, so a stale listener would call into a node that isn't a cat.
    ["cat; (echo ---; cat)", "hi\n", true, "hi\n---\n"],
    ["echo hi | (cat; echo ---; cat)", "", true, "hi\n---\n"],
  ] as const)("a later cat reads EOF: %s (stdin %j, quiet %p)", async (script, input, quiet, expected) => {
    expect(await runScript(script, input, quiet)).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
  });

  test("a later cat also fails after the first cat failed to read", async () => {
    // read() fails on a directory.
    const fd = openSync(import.meta.dir, "r");
    try {
      const script = "cat || echo first-failed; (echo ---; cat) || echo second-failed";
      expect(await runScript(script, fd, true)).toEqual({
        stdout: "first-failed\n---\nsecond-failed\nexit=0\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      closeSync(fd);
    }
  });
});

describe.concurrent("cat (builtin) after a read error", () => {
  // A directory opens but cannot be read. Linux reports that while the read starts.
  test.skipIf(isWindows).each([
    ["cat . || echo failed", false, "failed\n"],
    ["true | cat . || echo failed", true, "failed\n"],
    ["cat . | cat . || echo failed", false, "failed\n"],
    ["cat .; cat .; cat .; cat .; echo after", false, "after\n"],
  ] as const)("an operand that cannot be read: %s (quiet %p)", async (script, quiet, expected) => {
    expect(await runScript(script, "", quiet)).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
  });

  test.skipIf(!isLinux)("writes what it read before the error", async () => {
    // glibc before 2.34 has openpty in libutil.
    const { openpty } = dlopen(isMusl ? libcPathForDlopen() : "libutil.so.1", {
      openpty: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    }).symbols;
    const master = new Int32Array(1);
    const slave = new Int32Array(1);
    expect(openpty(master, slave, null, null, null)).toBe(0);
    // After the slave closes, read() on the master returns these bytes and then fails with EIO (5).
    writeSync(slave[0], "read before the error");
    closeSync(slave[0]);
    try {
      expect(await runScript("cat", master[0], false)).toEqual({
        stdout: "read before the errorexit=5\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      closeSync(master[0]);
    }
  });
});

test.skipIf(isWindows)("cat (builtin) stops reading while nothing takes its output", async () => {
  using dir = tempDir("shell-cat-backpressure", {});
  const release = join(String(dir), "release");
  expect(await Bun.spawn(["mkfifo", release]).exited).toBe(0);
  // The next stage never reads its stdin. It exits when the test writes to the FIFO.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "await Bun.$`cat | sh -c 'read line < release'`.nothrow();"],
    env: builtinEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
  const chunk = Buffer.alloc(64 * 1024, "a");
  const limit = 16 * 1024 * 1024;
  let taken = 0;
  while (taken < limit) {
    proc.stdin.write(chunk);
    // A flush that stays pending means the pipe is full and cat has stopped.
    const flushed = Promise.resolve(proc.stdin.flush()).then(() => true);
    if (!(await Promise.race([flushed, Bun.sleep(500).then(() => false)]))) break;
    taken += chunk.length;
  }
  writeFileSync(release, "\n");
  expect(taken).toBeLessThan(limit / 4);
  expect(await proc.exited).toBe(0);
});
