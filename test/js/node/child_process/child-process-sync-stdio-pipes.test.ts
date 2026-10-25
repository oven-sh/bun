/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A sync spawn has nobody to hand a stdio pipe above stderr to. Node.js reads
 * the pipe as it reads stdout and stderr, and returns the bytes in `output`:
 * https://github.com/nodejs/node/blob/v26.3.0/src/spawn_sync.cc#L765-L786
 */
import assert from "node:assert";
import type { StdioOptions } from "node:child_process";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";
// Under Bun a child gets the env that the harness gives every child.
const env: NodeJS.ProcessEnv = isBun ? (await import("harness")).bunEnv : process.env;
const exe = process.execPath;
const stdio: StdioOptions = ["ignore", "pipe", "pipe", "pipe"];
const code = (error: NodeJS.ErrnoException | undefined) => error?.code;

describe("a pipe at stdio index >= 3 of a sync spawn", () => {
  // More than a pipe holds on any platform: a child that writes this much to a pipe nobody reads never exits.
  const size = 1_000_000;
  // The child writes `size` bytes to the pipe, then "done" to stdout. The script has no double quote, so that
  // a shell command can quote it.
  const fill =
    `const fs = require('node:fs'); const chunk = Buffer.alloc(${size}, 'a'); ` +
    `for (let n = 0; n < chunk.length; ) n += fs.writeSync(3, chunk, n); fs.writeSync(1, 'done');`;
  const fail = `require('node:fs').writeSync(3, 'three'); process.exit(1);`;

  test("spawnSync returns what the child writes, also when it is more than the pipe holds", () => {
    const { status, signal, error, output } = spawnSync(exe, ["-e", fill], { stdio, env });
    assert.deepStrictEqual(
      {
        status,
        signal,
        error,
        entries: output.length,
        stdout: String(output[1]),
        stderr: String(output[2]),
        intact: Buffer.alloc(size, "a").equals(output[3]!),
      },
      { status: 0, signal: null, error: undefined, entries: 4, stdout: "done", stderr: "", intact: true },
    );
  });

  const execFile = (script: string, stdio: StdioOptions) =>
    execFileSync(exe, ["-e", script], { stdio, env, encoding: "utf8" });
  const exec = (script: string, stdio: StdioOptions) =>
    execSync(`"${exe}" -e "${script}"`, { stdio, env, encoding: "utf8" });
  // The pipe is not one of the descriptors that cmd.exe gives to the process it starts.
  const noPipeThroughShell = isWindows && "the child of cmd.exe has no fd 3";

  for (const [name, call, skip] of [
    ["execFileSync", execFile, false],
    ["execSync", exec, noPipeThroughShell],
  ] as const) {
    test(`${name} returns when the child writes more than the pipe holds`, { skip }, () => {
      assert.strictEqual(call(fill, stdio), "done");
    });

    test(`the error that ${name} throws has what the child wrote to the pipe`, { skip }, () => {
      assert.throws(() => call(fail, stdio), { status: 1, output: [null, "", "", "three"] });
    });

    test(`the error that ${name} throws has an entry for a stdio slot that is not a pipe`, () => {
      assert.throws(() => call("process.exit(1);", ["ignore", "pipe", "pipe", "ignore"]), {
        status: 1,
        output: [null, "", "", null],
      });
    });
  }

  // What jest-image-snapshot does: the child gets its input on stdin and answers on the pipe.
  test("spawnSync writes `input` to the child while it reads the pipe", () => {
    const input = Buffer.alloc(2_000_000, "i");
    // Copies stdin to the pipe. The end of a stdin pipe is an EOF error on Windows.
    const copy =
      `const fs = require('node:fs'); const chunk = Buffer.alloc(65536); for (;;) { let n = 0; ` +
      `try { n = fs.readSync(0, chunk); } catch (e) { if (e.code !== 'EOF') throw e; } if (n === 0) break; ` +
      `for (let at = 0; at < n; ) at += fs.writeSync(3, chunk, at, n - at); }`;
    const { status, signal, error, output } = spawnSync(exe, ["-e", copy], {
      input,
      stdio: ["pipe", "inherit", "inherit", "pipe"],
      env,
      maxBuffer: 2 * input.length,
    });
    assert.deepStrictEqual(
      { status, signal, error, output: output.map((entry, fd) => (fd === 3 ? input.equals(entry!) : entry)) },
      { status: 0, signal: null, error: undefined, output: [null, null, null, true] },
    );
  });

  // The child writes to the pipes at 3 and 6 and leaves the pipe at 5 alone.
  const slots: StdioOptions = ["ignore", "pipe", "pipe", "pipe", "ignore", "pipe", "pipe"];
  const slotWriter =
    `const fs = require('node:fs'); fs.writeSync(3, 'three'); fs.writeSync(6, 'six'); ` +
    `fs.writeSync(1, 'out'); fs.writeSync(2, 'err');`;

  test("output has an entry for each stdio slot", () => {
    const { output } = spawnSync(exe, ["-e", slotWriter], { stdio: slots, env });
    assert.deepStrictEqual(output, [
      null,
      Buffer.from("out"),
      Buffer.from("err"),
      Buffer.from("three"),
      null,
      Buffer.alloc(0),
      Buffer.from("six"),
    ]);
  });

  test("encoding applies to every entry of output", () => {
    const { output } = spawnSync(exe, ["-e", slotWriter], { stdio: slots, env, encoding: "hex" });
    const hex = (text: string) => Buffer.from(text).toString("hex");
    assert.deepStrictEqual(output, [null, hex("out"), hex("err"), hex("three"), null, "", hex("six")]);
  });

  test("output has an entry for each stdio slot when none above stderr is a pipe", () => {
    const { output } = spawnSync(exe, ["-e", "require('node:fs').writeSync(1, 'out');"], {
      stdio: ["ignore", "pipe", "pipe", "ignore", null, undefined],
      env,
      encoding: "utf8",
    });
    assert.deepStrictEqual(output, [null, "out", "", null, null, null]);
  });

  // Node.js has one maxBuffer for every output pipe of the call:
  // https://github.com/nodejs/node/blob/v26.3.0/src/spawn_sync.cc#L648-L655
  describe("maxBuffer", () => {
    const maxBuffer = 1000;
    const outAndErr: StdioOptions = ["ignore", "pipe", "pipe"];
    // Each stream gets its own byte, so that an entry of `output` shows which pipe it came from.
    const write = (fd: number, byte: string, length: number) =>
      length ? `fs.writeSync(${fd}, Buffer.alloc(${length}, '${byte}'));` : "";
    const writer = (out: number, err: number, three: number) =>
      `const fs = require('node:fs');` + write(1, "a", out) + write(2, "b", err) + write(3, "c", three);

    // What the child writes to stdout, to stderr and to fd 3: `maxBuffer` bytes in all. The byte over the limit is one
    // more to the last of them.
    const shapes: [counted: string, stdio: StdioOptions, atLimit: [out: number, err: number, three: number]][] = [
      ["stdout and stderr", ["ignore", "pipe", "pipe"], [500, 500, 0]],
      ["stdout and stderr below an entry that is not a pipe", ["ignore", "pipe", "pipe", "ignore"], [500, 500, 0]],
      ["stderr when it is the only pipe", ["ignore", "ignore", "pipe"], [0, 1000, 0]],
      ["stdout and the pipe", ["ignore", "pipe", "ignore", "pipe"], [500, 0, 500]],
      ["stderr and the pipe", ["ignore", "ignore", "pipe", "pipe"], [0, 500, 500]],
      ["the pipe when it is the only one", ["ignore", "ignore", "ignore", "pipe"], [0, 0, 1000]],
    ];
    for (const [counted, stdio, atLimit] of shapes) {
      for (const over of [0, 1]) {
        test(`counts ${counted}: ${over ? "one byte over the limit is ENOBUFS" : "at the limit"}`, () => {
          const last = atLimit.findLastIndex(Boolean);
          const [out, err, three] = atLimit.map((size, i) => size + (i === last ? over : 0));
          const result = spawnSync(exe, ["-e", writer(out, err, three)], { stdio, env, maxBuffer });
          assert.deepStrictEqual(
            { error: code(result.error), message: result.error?.message, output: result.output },
            {
              error: over ? "ENOBUFS" : undefined,
              message: over ? `spawnSync ${exe} ENOBUFS` : undefined,
              output: [null, Buffer.alloc(out, "a"), Buffer.alloc(err, "b"), Buffer.alloc(three, "c")]
                .slice(0, stdio.length)
                .map((bytes, fd) => (stdio[fd] === "pipe" ? bytes : null)),
            },
          );
          // A child that goes over the limit is killed, unless it exits first.
          if (!over) assert.deepStrictEqual([result.status, result.signal], [0, null]);
        });
      }
    }

    // Node.js closes every pipe inside the read that crosses the limit (SyncProcessRunner::Kill). Bun stops each
    // other reader before its next read. Either way `output` has one read above the limit at most, and a read is
    // 64 KiB at most.
    const bytes = (output: (Buffer | null)[]) => output.reduce((sum, entry) => sum + (entry ? entry.length : 0), 0);

    test("the call keeps at most one read above the limit", () => {
      const pipes = 8;
      const script =
        `const fs = require('node:fs'); const chunk = Buffer.alloc(60000); ` +
        `for (let fd = 3; fd < ${3 + pipes}; fd++) for (let n = 0; n < chunk.length; ) n += fs.writeSync(fd, chunk, n);`;
      const { error, output } = spawnSync(exe, ["-e", script], {
        stdio: ["ignore", "ignore", "ignore", ...Array(pipes).fill("pipe")],
        env,
        maxBuffer,
      });
      const kept = bytes(output);
      assert.deepStrictEqual(
        { error: code(error), entries: output.length, over: kept > maxBuffer, oneRead: kept <= maxBuffer + 64 * 1024 },
        { error: "ENOBUFS", entries: 3 + pipes, over: true, oneRead: true },
      );
    });

    // Each of the two is under the limit: a count made after the call would keep all of both.
    test("the call keeps at most one read above the limit of stdout and stderr", () => {
      const maxBuffer = 200_000;
      const script =
        `const fs = require('node:fs'); const chunk = Buffer.alloc(150000); ` +
        `for (const fd of [1, 2]) for (let n = 0; n < chunk.length; ) n += fs.writeSync(fd, chunk, n);`;
      const { error, output } = spawnSync(exe, ["-e", script], { stdio: outAndErr, env, maxBuffer });
      const kept = bytes(output);
      assert.deepStrictEqual(
        { error: code(error), over: kept > maxBuffer, oneRead: kept <= maxBuffer + 64 * 1024 },
        { error: "ENOBUFS", over: true, oneRead: true },
      );
    });

    // The child writes as much as the limit to stderr, then one byte to stdout, then stays. A write to stderr does
    // not return before the call has read it, so the byte over the limit comes when the call watches the child.
    test("a child that goes over the limit on stdout and stderr together is killed", () => {
      const script =
        `const fs = require('node:fs'); const chunk = Buffer.alloc(${size}, 'b'); ` +
        `for (let n = 0; n < chunk.length; ) n += fs.writeSync(2, chunk, n); fs.writeSync(1, 'a'); ` +
        `setTimeout(() => {}, 3000);`;
      const { status, signal, error, output } = spawnSync(exe, ["-e", script], {
        stdio: outAndErr,
        env,
        maxBuffer: size,
      });
      assert.deepStrictEqual(
        { error: code(error), status, signal, stdout: String(output[1]), stderr: output[2]?.length },
        { error: "ENOBUFS", status: null, signal: "SIGTERM", stdout: "a", stderr: size },
      );
    });

    // With no options the limit is 1 MiB, and stderr is a pipe.
    test("counts stdout and stderr against the default limit", () => {
      const limit = 1024 * 1024;
      for (const over of [0, 1]) {
        const script =
          `const fs = require('node:fs'); const chunk = Buffer.alloc(${limit - 100}, 'a'); ` +
          `for (let n = 0; n < chunk.length; ) n += fs.writeSync(1, chunk, n); ` +
          `fs.writeSync(2, Buffer.alloc(${100 + over}, 'b'));`;
        const { error, stdout, stderr } = spawnSync(exe, ["-e", script], { env });
        assert.deepStrictEqual(
          { error: code(error), stdout: stdout.length, stderr: stderr.length },
          { error: over ? "ENOBUFS" : undefined, stdout: limit - 100, stderr: 100 + over },
        );
      }
    });

    // With no `stdio` option these two pipe stderr, and write it to the stderr of this process after the call.
    for (const [name, call] of [
      ["execFileSync", (script: string) => execFileSync(exe, ["-e", script], { env, maxBuffer })],
      ["execSync", (script: string) => execSync(`"${exe}" -e "${script}"`, { env, maxBuffer })],
    ] as const) {
      test(`${name} counts stdout and stderr`, () => {
        assert.deepStrictEqual(call(writer(maxBuffer - 1, 1, 0)), Buffer.alloc(maxBuffer - 1, "a"));
        assert.throws(() => call(writer(maxBuffer - 1, 2, 0)), {
          code: "ENOBUFS",
          stdout: Buffer.alloc(maxBuffer - 1, "a"),
          stderr: Buffer.from("bb"),
        });
      });
    }

    test("a stream that is not a pipe does not count", () => {
      const { error, output } = spawnSync(exe, ["-e", writer(maxBuffer, 5000, 0)], {
        stdio: ["ignore", "pipe", "ignore"],
        env,
        maxBuffer,
      });
      assert.deepStrictEqual(
        { error, output },
        { error: undefined, output: [null, Buffer.alloc(maxBuffer, "a"), null] },
      );
    });
  });

  describe("a descendant of the child holds the pipe", () => {
    // The descendant has nothing of the call but the pipe. On POSIX the child is a /bin/sh script: its descendant
    // reads the pipe, which never has a byte for it, so it exits when the call closes its end. Windows has no
    // /bin/sh. The child is an `exe -e` script there, and its descendant exits after `holderLifetime`.
    const holder = "(read _ <&3) >/dev/null 2>&1 &";
    const holderLifetime = 5000;
    // `exe -e` scripts: the child runs `before`, starts `descendant` with the pipe as its fd 3, then runs `after`.
    const withDescendant = (before: string, descendant: string, after: string) =>
      [
        exe,
        [
          "-e",
          `const fs = require('node:fs'); ${before}; require('node:child_process').spawn(process.execPath, ` +
            `['-e', ${JSON.stringify(descendant)}, String(process.pid)], ` +
            `{ stdio: ['ignore', 'ignore', 'ignore', 3], detached: true }).unref(); ${after};`,
        ],
      ] as const;
    const hold = `setTimeout(() => {}, ${holderLifetime});`;
    const sh = (script: string) => ["/bin/sh", ["-c", script]] as const;

    test("the call waits for the end of the pipe, as it does for stdout", () => {
      // The descendant writes once the child is gone. In the /bin/sh script `kill -0` fails when the call has
      // seen the child exit.
      const [file, args] = isWindows
        ? withDescendant(
            "fs.writeSync(3, 'early')",
            "const alive = () => { try { process.kill(Number(process.argv[1]), 0); return true; } catch { return false; } }; " +
              "while (alive()) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); " +
              "require('node:fs').writeSync(3, 'late');",
            "0",
          )
        : sh("printf early >&3; (while kill -0 $$; do :; done; printf late >&3) >/dev/null 2>&1 & exit 0");
      const { status, signal, error, output } = spawnSync(file, args, { stdio, env, encoding: "utf8" });
      assert.deepStrictEqual(
        { status, signal, error, output },
        { status: 0, signal: null, error: undefined, output: [null, "", "", "earlylate"] },
      );
    });

    test("timeout ends the wait", () => {
      // The child is gone long before the timeout.
      const [file, args] = isWindows
        ? withDescendant("fs.writeSync(3, 'early')", hold, "0")
        : sh(`printf early >&3; ${holder} exit 0`);
      const { status, signal, error, output } = spawnSync(file, args, {
        stdio,
        env,
        timeout: isWindows ? holderLifetime / 2 : 500,
        encoding: "utf8",
      });
      assert.deepStrictEqual(
        { status, signal, error: code(error), output },
        { status: 0, signal: null, error: "ETIMEDOUT", output: [null, "", "", "early"] },
      );
    });

    test("maxBuffer ends the wait", () => {
      // The child goes one byte over the limit on stdout.
      const [file, args] = isWindows
        ? withDescendant("0", hold, "fs.writeSync(1, Buffer.alloc(1001, '0'))")
        : sh(`${holder} printf %01001d 0`);
      const { error, output } = spawnSync(file, args, { stdio, env, maxBuffer: 1000, encoding: "utf8" });
      assert.deepStrictEqual(
        { error: code(error), output },
        { error: "ENOBUFS", output: [null, Buffer.alloc(1001, "0").toString(), "", ""] },
      );
    });
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L1035-L1043
  describe("an 'ipc' entry throws ERR_IPC_SYNC_FORK", () => {
    const ipc: StdioOptions = ["ignore", "pipe", "pipe", "ipc"];
    for (const [name, call] of [
      ["spawnSync", () => spawnSync(exe, ["-e", ""], { stdio: ipc, env })],
      ["spawnSync, at index 0", () => spawnSync(exe, ["-e", ""], { stdio: ["ipc", "pipe", "pipe"], env })],
      ["spawnSync, more than one", () => spawnSync(exe, ["-e", ""], { stdio: ["ipc", "ipc", "pipe"], env })],
      ["execFileSync", () => execFileSync(exe, ["-e", ""], { stdio: ipc, env })],
      ["execSync", () => execSync("exit 0", { stdio: ipc, env })],
    ] as const) {
      test(name, () => {
        assert.throws(call, {
          name: "Error",
          code: "ERR_IPC_SYNC_FORK",
          message: "IPC cannot be used with synchronous forks",
        });
      });
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { nodeExeAtLeast } = await import("harness");
  // From v24 on every Node.js release runs a .ts file as it is.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...env, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
