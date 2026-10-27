/**
 * node:child_process tested `args` and `options.stdio` with a check that is
 * true only for a plain array object. Node uses `ArrayIsArray`, which is also
 * true for a Proxy whose target is an array and for `Array.prototype`:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L133 (fork, args)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L164 (fork, options.stdio)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L266 (execFile, args)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L575 (spawn, args)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L998 (options.stdio)
 * So Bun took a Proxy `args` for the options object, and rejected or replaced a
 * Proxy `stdio`.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * Node.js, which is where the expected values come from. It cannot import from
 * "harness" at the top for the same reason.
 */
import assert from "node:assert";
import { execFile, execFileSync, fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { text } from "node:stream/consumers";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const fixtures = path.join(import.meta.dirname, "fixtures");
const echoArgv = path.join(fixtures, "child-process-echo-argv.js");
const echoMessage = path.join(fixtures, "child-process-echo-message.js");
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };

function proxied<T>(array: T[]): T[] {
  return new Proxy(array, {});
}

// A Proxy of an array that throws when anything but `length` or an index is read.
// Node reads a `stdio` array that way, so no method of the caller's array runs.
function indexedOnly<T>(array: T[]): T[] {
  return new Proxy(array, {
    get(target, key, receiver) {
      if (key !== "length" && !(typeof key === "string" && /^\d+$/.test(key))) {
        throw new Error(`stdio.${String(key)} was read`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

function revoked(): any[] {
  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  return proxy;
}

// What `Array.isArray()` throws for a revoked Proxy. Node: "Cannot perform 'IsArray' on a proxy that has been revoked".
const revokedProxyError = { name: "TypeError", message: /IsArray|Array\.isArray/ };

describe("child_process takes a Proxy of an array", () => {
  describe("as args", () => {
    test("spawnSync()", () => {
      const { stdout, status } = spawnSync(process.execPath, proxied(["-e", "console.log('spawnSync')"]), { env });
      assert.strictEqual(String(stdout), "spawnSync\n");
      assert.strictEqual(status, 0);
    });

    test("spawn()", async () => {
      const child = spawn(process.execPath, proxied(["-e", "console.log('spawn')"]), {
        env,
        stdio: ["ignore", "pipe", "inherit"],
      });
      // Node copies the arguments, so the child does not keep the Proxy.
      assert.deepStrictEqual(child.spawnargs, [process.execPath, "-e", "console.log('spawn')"]);
      const [stdout, [code]] = await Promise.all([text(child.stdout!), once(child, "close")]);
      assert.strictEqual(stdout, "spawn\n");
      assert.strictEqual(code, 0);
    });

    test("execFileSync()", () => {
      const stdout = execFileSync(process.execPath, proxied(["-e", "console.log('execFileSync')"]), { env });
      assert.strictEqual(String(stdout), "execFileSync\n");
    });

    test("execFile()", async () => {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      execFile(process.execPath, proxied(["-e", "console.log('execFile')"]), { env }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      assert.strictEqual(await promise, "execFile\n");
    });

    test("fork()", async () => {
      const child = fork(echoArgv, proxied(["a", "b"]), { env, silent: true });
      const [stdout, [code]] = await Promise.all([text(child.stdout!), once(child, "close")]);
      assert.strictEqual(stdout, "a\nb\n");
      assert.strictEqual(code, 0);
    });

    test("Array.prototype is an array too", () => {
      // The arguments are accepted, so the check after them, of the timeout, is the one that throws.
      assert.throws(() => spawnSync(process.execPath, Array.prototype, { timeout: -1 }), {
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
      });
    });
  });

  describe("as options.stdio", () => {
    test("spawnSync()", () => {
      const { stdout, status } = spawnSync(process.execPath, ["-e", "console.log('spawnSync')"], {
        env,
        stdio: indexedOnly(["ignore", "pipe", "inherit"]),
      });
      assert.strictEqual(String(stdout), "spawnSync\n");
      assert.strictEqual(status, 0);
    });

    test("spawn()", async () => {
      const child = spawn(process.execPath, ["-e", "console.log('spawn')"], {
        env,
        stdio: indexedOnly(["ignore", "pipe", "inherit"]),
      });
      assert.strictEqual(child.stdin, null);
      assert.strictEqual(child.stderr, null);
      const [stdout, [code]] = await Promise.all([text(child.stdout!), once(child, "close")]);
      assert.strictEqual(stdout, "spawn\n");
      assert.strictEqual(code, 0);
    });

    test("spawn() opens the IPC channel that the Proxy names", async () => {
      const child = spawn(process.execPath, [echoMessage], {
        env,
        stdio: indexedOnly(["ignore", "inherit", "inherit", "ipc"]),
      });
      child.send({ from: "spawn" });
      const [[message], [code]] = await Promise.all([once(child, "message"), once(child, "close")]);
      assert.deepStrictEqual(message, { from: "spawn" });
      assert.strictEqual(code, 0);
    });

    test("spawn() keeps a hole of the target a hole", async () => {
      // A hole is not `undefined`: `undefined` in slot 0 is a pipe, and a hole is not.
      const child = spawn(process.execPath, ["-e", ""], { env, stdio: indexedOnly([, "ignore", "ignore"]) });
      assert.strictEqual(child.stdin, null);
      const [code] = await once(child, "close");
      assert.strictEqual(code, 0);
    });

    test("spawn() allows one 'ipc' slot", () => {
      assert.throws(() => spawn(process.execPath, [], { stdio: indexedOnly(["ignore", "ipc", "ipc"]) }), {
        name: "Error",
        code: "ERR_IPC_ONE_PIPE",
        message: "Child process can have only one IPC pipe",
      });
    });

    test("fork() keeps the stdio of the Proxy", async () => {
      const child = fork(echoMessage, [], {
        env,
        stdio: indexedOnly(["ignore", "pipe", "inherit", "ipc"]),
      });
      // With the default stdio, fork() inherits stdout and `child.stdout` is null.
      assert.notStrictEqual(child.stdout, null);
      child.send({ from: "fork" });
      const [[message], [code]] = await Promise.all([once(child, "message"), once(child, "close")]);
      assert.deepStrictEqual(message, { from: "fork" });
      assert.strictEqual(code, 0);
    });

    test("fork() requires 'ipc' in the Proxy", () => {
      assert.throws(() => fork(echoArgv, [], { env, stdio: indexedOnly(["ignore", "pipe", "inherit"]) }), {
        name: "Error",
        code: "ERR_CHILD_PROCESS_IPC_REQUIRED",
        message: "Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
      });
    });

    test("a revoked Proxy is the TypeError of Array.isArray()", () => {
      assert.throws(() => spawnSync(process.execPath, [], { stdio: revoked() }), revokedProxyError);
      assert.throws(() => spawn(process.execPath, [], { stdio: revoked() }), revokedProxyError);
      assert.throws(() => fork(echoArgv, [], { stdio: revoked() }), revokedProxyError);
    });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The expected values above are those of v26.3.0.
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
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
