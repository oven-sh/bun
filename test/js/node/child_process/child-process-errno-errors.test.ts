/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * node:child_process reports a failure that it detects itself (a timeout, a
 * full buffer, a Windows batch file) with an error of node's ErrnoException:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L725-L751
 */
import assert from "node:assert";
import { execFile, execFileSync, execSync, fork, spawn, spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getSystemErrorName } from "node:util";

const exe = process.execPath;
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
const never = ["-e", "setInterval(() => {}, 1 << 30)"];
const flood = ["-e", "process.stdout.write(Buffer.alloc(65536, 120))"];
const onlyOnWindows = { skip: process.platform !== "win32" };

// What tells an ErrnoException from an error of another class, and the fields that class gives it. The keys are
// sorted: Bun lists `syscall` before `code`.
function errnoExceptionShape(error: any) {
  return {
    name: error.name,
    constructor: error.constructor,
    prototypeKeys: Reflect.ownKeys(Object.getPrototypeOf(error)),
    string: String(error),
    // node also has `error`, the error itself, on what execFileSync() and execSync() throw. Bun leaves it out:
    // https://github.com/oven-sh/bun/issues/26844
    keys: Object.keys(error)
      .filter(key => key !== "error")
      .sort(),
    errno: getSystemErrorName(error.errno),
    code: error.code,
    syscall: error.syscall,
  };
}

function thrownBy(fn: () => unknown) {
  let error: any;
  assert.throws(fn, thrown => ((error = thrown), true));
  return error;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L1126-L1130
describe("the error of a spawnSync() timeout or maxBuffer", () => {
  for (const [code, args, options] of [
    ["ETIMEDOUT", never, { timeout: 50 }],
    ["ENOBUFS", flood, { maxBuffer: 10 }],
  ] as const) {
    test(`spawnSync() reports ${code} with an ErrnoException`, () => {
      const error = spawnSync(exe, args, { ...options, env }).error as NodeJS.ErrnoException & { spawnargs: string[] };
      assert.deepStrictEqual(
        { ...errnoExceptionShape(error), path: error.path, spawnargs: error.spawnargs },
        {
          name: "Error",
          constructor: Error,
          prototypeKeys: ["constructor"],
          string: `Error: spawnSync ${exe} ${code}`,
          keys: ["code", "errno", "path", "spawnargs", "syscall"],
          errno: code,
          code,
          syscall: `spawnSync ${exe}`,
          path: exe,
          spawnargs: [...args],
        },
      );
      // The name is the one every Error inherits, so a program can replace it.
      error.name = "LimitError";
      assert.strictEqual(String(error), `LimitError: spawnSync ${exe} ${code}`);
    });
  }

  for (const [name, code, run] of [
    ["execFileSync", "ETIMEDOUT", () => execFileSync(exe, never, { timeout: 50, env })],
    ["execSync", "ENOBUFS", () => execSync(`"${exe}" ${flood[0]} "${flood[1]}"`, { maxBuffer: 10, env })],
  ] as const) {
    test(`${name}() throws it with the fields of the result`, () => {
      const error = thrownBy(run);
      assert.deepStrictEqual(errnoExceptionShape(error), {
        name: "Error",
        constructor: Error,
        prototypeKeys: ["constructor"],
        // The file of execSync() is the shell.
        string: `Error: spawnSync ${error.path} ${code}`,
        keys: [
          "code",
          "errno",
          "output",
          "path",
          "pid",
          "signal",
          "spawnargs",
          "status",
          "stderr",
          "stdout",
          "syscall",
        ],
        errno: code,
        code,
        syscall: `spawnSync ${error.path}`,
      });
    });
  }
});

// On Windows, CreateProcess runs a .bat or .cmd file through cmd.exe, which parses the arguments again by its own rules.
// node refuses to start one unless `shell` is set: https://github.com/nodejs/node/blob/v26.3.0/src/process_wrap.cc#L243-L244
describe("the error of a Windows batch file without `shell`", () => {
  const file = "does-not-exist.cmd";

  test("spawnSync() reports EINVAL with an ErrnoException", onlyOnWindows, () => {
    const error = spawnSync(file, ["a"]).error as NodeJS.ErrnoException & { spawnargs: string[] };
    assert.deepStrictEqual(
      { ...errnoExceptionShape(error), path: error.path, spawnargs: error.spawnargs },
      {
        name: "Error",
        constructor: Error,
        prototypeKeys: ["constructor"],
        string: `Error: spawnSync ${file} EINVAL`,
        keys: ["code", "errno", "path", "spawnargs", "syscall"],
        errno: "EINVAL",
        code: "EINVAL",
        syscall: `spawnSync ${file}`,
        path: file,
        spawnargs: ["a"],
      },
    );
  });

  for (const [name, run] of [
    ["spawn", () => spawn(file, ["a"])],
    ["execFile", () => execFile(file, ["a"])],
    ["fork", () => fork("does-not-exist.js", [], { execPath: file })],
  ] as const) {
    test(`${name}() throws \`spawn EINVAL\``, onlyOnWindows, () => {
      assert.deepStrictEqual(errnoExceptionShape(thrownBy(run)), {
        name: "Error",
        constructor: Error,
        prototypeKeys: ["constructor"],
        string: "Error: spawn EINVAL",
        keys: ["code", "errno", "syscall"],
        errno: "EINVAL",
        code: "EINVAL",
        syscall: "spawn",
      });
    });
  }

  // node validates the options before its binding rejects the file: https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L789-L797
  for (const [name, run, code] of [
    ["spawn() with an invalid timeout", () => spawn(file, [], { timeout: -1 }), "ERR_OUT_OF_RANGE"],
    ["spawn() with an invalid signal", () => spawn(file, [], { signal: 5 as any }), "ERR_INVALID_ARG_TYPE"],
    ["spawn() with an invalid killSignal", () => spawn(file, [], { killSignal: "NOPE" as any }), "ERR_UNKNOWN_SIGNAL"],
    [
      "spawn() with an invalid serialization",
      () => spawn(file, [], { serialization: "x" as any }),
      "ERR_INVALID_ARG_VALUE",
    ],
    [
      "fork() with an invalid timeout",
      () => fork("does-not-exist.js", [], { execPath: file, timeout: -1 }),
      "ERR_OUT_OF_RANGE",
    ],
  ] as const) {
    test(`${name} throws for the option`, onlyOnWindows, () => {
      assert.strictEqual(thrownBy(run).code, code);
    });
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js runs a TypeScript file as it is from v22.18.0, and parses the `await using` below from v24.0.0.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
