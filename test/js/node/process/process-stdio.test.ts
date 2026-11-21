import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { spawn as nodeSpawn } from "node:child_process";
import { once } from "node:events";
import { release } from "node:os";
import type { Readable } from "node:stream";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe<boolean | undefined>(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test.skipIf(isWindows)("process.stdout still writes when it's first read with no file descriptors left", async () => {
    const script = `
      const fs = require("node:fs");
      // Debug builds load the stream modules from disk on first use, so load them before the fds run out.
      process.stderr;
      await new Promise(resolve => process.nextTick(resolve));
      const held = [];
      try {
        for (;;) held.push(fs.openSync("/dev/null", "r"));
      } catch {}
      const stdout = process.stdout;
      for (const fd of held) fs.closeSync(fd);
      stdout.write("written\\n", err => console.error("callback", err));
    `;
    await using proc = spawn({
      cmd: ["sh", "-c", 'ulimit -n 64 && exec "$0" -e "$1"', bunExe(), script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "written\n", stderr: "callback null\n" });
    expect(exitCode).toBe(0);
  });
});

// Like Node, process.stdout/stderr put O_NONBLOCK on fd 1/2 when they are pipes or sockets. The flag lives on the shared open
// file description, so spawn clears it again for a child's fds 0-2 (libuv does the same), and the native console writer must
// wait on EAGAIN instead of dropping the rest of the line.
describe.concurrent.skipIf(isWindows)(
  "O_NONBLOCK on process.stdout/stderr does not leak to children or truncate console output",
  () => {
    const probe = path.join(import.meta.dir, "fd-nonblock-fixture.js");

    // What command-line tools do before native code of theirs writes to the descriptor. Without it a write stops at a full pipe.
    test.each(["stdout", "stderr"] as const)(
      "process.%s._handle.setBlocking(true) makes the pipe blocking",
      async name => {
        const [fd, otherFd] = name === "stdout" ? [1, 2] : [2, 1];
        await using proc = spawn({
          cmd: [
            bunExe(),
            "-e",
            `
            const { writeSync } = require("node:fs");
            const handle = process.${name}._handle;
            const result = handle.setBlocking(true);
            const written = writeSync(${fd}, Buffer.alloc(1_000_000, "x"));
            writeSync(${otherFd}, JSON.stringify({ fd: handle.fd, result, written }));
          `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const [output, report] = name === "stdout" ? [stdout, stderr] : [stderr, stdout];
        expect(JSON.parse(report)).toEqual({ fd, result: 0, written: 1_000_000 });
        expect(output.length).toBe(1_000_000);
        expect(exitCode).toBe(0);
      },
    );

    test("a file has no _handle, as in Node", async () => {
      using dir = tempDir("stdout-file-handle", {});
      await using proc = spawn({
        cmd: [bunExe(), "-e", `require("node:fs").writeSync(2, typeof process.stdout._handle)`],
        env: bunEnv,
        stdout: Bun.file(path.join(String(dir), "out.txt")),
        stderr: "pipe",
      });
      expect(await proc.stderr.text()).toBe("undefined");
      expect(await proc.exited).toBe(0);
    });

    // Newline-delimited JSON events from a child's stderr, one at a time, plus the raw remainder at EOF.
    function jsonLines(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      const seen: any[] = [];
      let buf = "";
      return {
        seen,
        async next() {
          while (true) {
            const nl = buf.indexOf("\n");
            if (nl >= 0) {
              const v = JSON.parse(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
              seen.push(v);
              return v;
            }
            const { value, done } = await reader.read();
            if (done) throw new Error("stderr closed early: " + JSON.stringify(seen) + " " + JSON.stringify(buf));
            buf += Buffer.from(value).toString();
          }
        },
        async rest() {
          while (true) {
            const { value, done } = await reader.read();
            if (done) return buf;
            buf += Buffer.from(value).toString();
          }
        },
      };
    }

    // Child that writes 1 MiB to stdout and reports write()'s return, then 'drain' (plus `drainExtra`, evaluated then) on stderr.
    const writerScript = (prelude: string, drainExtra = "{}") => `${prelude}
      const ret = process.stdout.write(Buffer.alloc(1 << 20, "A"));
      require("fs").writeSync(2, JSON.stringify({ ret }) + "\\n");
      process.stdout.once("drain", () => require("fs").writeSync(2, JSON.stringify({ drained: true, ...(${drainExtra}) }) + "\\n"));`;
    // Reader end of a shell pipe that only starts draining stdin on SIGUSR1, so the writer is guaranteed to hit a full pipe.
    const gatedReader = `process.on("SIGUSR1", async () => { for await (const c of Bun.stdin.stream()) require("fs").writeSync(1, c); process.exit(0); });
      setInterval(() => {}, 1 << 30);
      require("fs").writeSync(2, JSON.stringify({ reader: process.pid }) + "\\n");`;

    // Socketpair stdout (Bun.spawn "pipe") with a lazy parent: nothing reads stdout until write() has reported.
    async function expectDrainOverSocket(prelude: string, expectedBytes: number) {
      await using proc = spawn({
        cmd: [bunExe(), "-e", writerScript(prelude)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const events = jsonLines(proc.stderr);
      expect(await events.next()).toEqual({ ret: false });
      const [stdout, drained, exitCode] = await Promise.all([proc.stdout.bytes(), events.next(), proc.exited]);
      expect(stdout.byteLength).toBe(expectedBytes);
      expect(drained).toEqual({ drained: true });
      expect(exitCode).toBe(0);
    }

    // Real pipe(2) via sh, reader gated on SIGUSR1.
    async function expectDrainOverPipe(
      prelude: string,
      drainExtra: string,
      expectedDrain: object,
      expectedBytes: number,
    ) {
      await using proc = spawn({
        cmd: ["sh", "-c", `"$0" -e "$1" | "$0" -e "$2"`, bunExe(), writerScript(prelude, drainExtra), gatedReader],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const events = jsonLines(proc.stderr);
      let readerPid: number | undefined, ret: boolean | undefined;
      while (readerPid === undefined || ret === undefined) {
        const v = await events.next();
        if ("reader" in v) readerPid = v.reader;
        if ("ret" in v) ret = v.ret;
      }
      expect(ret).toBe(false);
      process.kill(readerPid!, "SIGUSR1");
      expect(await events.next()).toEqual(expectedDrain);
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(stdout.byteLength).toBe(expectedBytes);
      expect(exitCode).toBe(0);
    }

    test("an inherit child sees blocking fd 1 and 2 after the parent wrote to process.stdout/stderr", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write("out\\n");
         process.stderr.write("err\\n");
         const r = Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1", "2"], { stdio: ["inherit", "inherit", "inherit"] });
         process.exit(r.exitCode);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("err\n");
      expect(stdout).toBe("out\n1:blocking 2:blocking\n");
      expect(exitCode).toBe(0);
    });

    test("a plain tool with inherited stdout can write more than a pipe holds after process.stdout was used", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write("start\\n");
         const r = Bun.spawnSync(["head", "-c", "1000000", "/dev/zero"], { stdio: ["inherit", "inherit", "inherit"] });
         process.stderr.write("rc=" + r.exitCode + "\\n");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("rc=0\n");
      expect(stdout).toEqual(new Uint8Array(Buffer.concat([Buffer.from("start\n"), Buffer.alloc(1000000)])));
      expect(exitCode).toBe(0);
    });

    // A single 1 MiB line is larger than any pipe buffer, so the console writer's second write(2) hits EAGAIN regardless of how
    // fast the reader is; it used to drop the rest of the line there.
    test("console.log is not truncated after process.stdout was used", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString());`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(stdout.byteLength).toBe((1 << 20) + 1);
      expect(exitCode).toBe(0);
    });

    test("console.error is not truncated after process.stderr was used", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `void process.stderr.isTTY; console.error(Buffer.alloc(1 << 20, "B").toString());`],
        env: bunEnv,
        stdout: "inherit",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.bytes(), proc.exited]);
      expect(stderr.byteLength).toBe((1 << 20) + 1);
      expect(exitCode).toBe(0);
    });

    test("process.stdout.write to a full pipe still returns false and emits drain", async () => {
      await expectDrainOverSocket("", 1 << 20);
    });

    // Bun.spawn's "pipe" is a socketpair; these go through sh so fd 1 is a real pipe(2).
    test("console.log and process.stdout.write are not truncated over a real pipe", async () => {
      await using proc = spawn({
        cmd: [
          "sh",
          "-c",
          `"$0" -e 'void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString()); process.stdout.write(Buffer.alloc(1 << 20, "B"));' | cat`,
          bunExe(),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toEqual(
        new Uint8Array(Buffer.concat([Buffer.alloc(1 << 20, "A"), Buffer.from("\n"), Buffer.alloc(1 << 20, "B")])),
      );
      expect(exitCode).toBe(0);
    });

    test("process.stdout.write to a full real pipe returns false and emits drain; a child spawned after still gets a blocking fd 1", async () => {
      const probeFd1 = `{ probe: Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1"], { stdio: ["inherit", "inherit", "pipe"], env: { ...process.env, PROBE_OUT_FD: "2" } }).stderr.toString().trim() }`;
      await expectDrainOverPipe("", probeFd1, { drained: true, probe: "1:blocking" }, 1 << 20);
    });

    // Spawning an inherit child clears O_NONBLOCK on the shared description (above). The parent's own process.stdout must
    // stay asynchronous after that where the OS has a per-call nonblocking write: sockets everywhere (send + MSG_DONTWAIT /
    // MSG_NBIO), pipes on Linux (pwritev2 + RWF_NOWAIT). macOS pipes have no such call, so they behave like Node there.
    const afterInheritSpawn = `process.stdout.write("x"); Bun.spawnSync(["true"], { stdio: ["inherit", "inherit", "inherit"] });`;
    test("process.stdout.write on a socket stays asynchronous after an inherit spawn cleared O_NONBLOCK", async () => {
      await expectDrainOverSocket(afterInheritSpawn, 1 + (1 << 20));
    });

    // pwritev2(RWF_NOWAIT) works on pipes from Linux 6.4 (FMODE_NOWAIT on pipes); older kernels behave like macOS/Node here.
    const pipesHaveNowait =
      isLinux &&
      (() => {
        const [maj, min] = release().split(".").map(Number);
        return maj > 6 || (maj === 6 && min >= 4);
      })();
    test.skipIf(!pipesHaveNowait)(
      "process.stdout.write on a pipe stays asynchronous after an inherit spawn cleared O_NONBLOCK (RWF_NOWAIT)",
      async () => {
        await expectDrainOverPipe(afterInheritSpawn, "{}", { drained: true }, 1 + (1 << 20));
      },
    );
  },
);

// On Windows: a synchronous end of a named pipe, an end from CreatePipe(), an overlapped end, and one that
// the process in between has used.
const pipeKinds = ["spawn", "shell", ...(isWindows ? ["fd 3", "fd 3 in use"] : [])];
describe.concurrent.each(pipeKinds)("stdout is a pipe from %s", kind => {
  function start(main: string) {
    const dir = tempDir("stdout-kinds", {
      "main.js": main,
      "relay.js": `
        const fs = require("fs"), buffer = Buffer.alloc(65536);
        try {
          for (let n; (n = fs.readSync(0, buffer)); ) for (let at = 0; at < n; ) at += fs.writeSync(1, buffer, at, n - at);
        } catch {}
      `,
      "pass-on.js": `
        if (process.argv[2]) require("net").connect({ fd: 3, pauseOnConnect: true }).unref();
        Bun.spawn([process.execPath, "main.js"], { stdio: ["ignore", 3, "inherit"], onExit: (_, code) => process.exit(code) });
      `,
    });
    const options = { cwd: String(dir), env: bunEnv };
    const child =
      kind === "spawn"
        ? nodeSpawn(bunExe(), ["main.js"], options)
        : kind === "shell"
          ? nodeSpawn(`"${bunExe()}" main.js | "${bunExe()}" relay.js`, { ...options, shell: true })
          : nodeSpawn(bunExe(), ["pass-on.js", ...(kind === "fd 3" ? [] : ["in use"])], {
              ...options,
              stdio: ["ignore", "ignore", "pipe", "pipe"],
            });
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    const ended = Promise.all([once(child, "exit"), once(child.stderr!, "end")]);
    return {
      output: (child.stdout ?? child.stdio[3]) as Readable,
      result: async () => ({ exitCode: (await ended)[0][0], stderr }),
      async [Symbol.asyncDispose]() {
        this.output.destroy();
        child.kill();
        await ended;
        dir[Symbol.dispose]();
      },
    };
  }
  const sizes = [1, 7, 0, 65535, 65536, 65537, 1, 300_000, 3, 700_000, 2];
  const chunks = `${JSON.stringify(sizes)}.map((size, i) => Buffer.alloc(size, i + "|"))`;
  const digest = (data: Buffer[]) => Bun.SHA1.hash(Buffer.concat(data), "hex");
  const expected = digest(sizes.map((size, i) => Buffer.alloc(size, i + "|")));

  test.each([
    ["process.stdout.write()", `for (const chunk of chunks) process.stdout.write(chunk)`],
    ["process.stdout.write(string)", `for (const chunk of chunks) process.stdout.write(chunk.toString())`],
    [
      "process.stdout.write() and process.exit() in the last callback",
      `chunks.forEach((chunk, i) => process.stdout.write(chunk, () => i === chunks.length - 1 && process.exit(0)))`,
    ],
    ["pipeline()", `require("stream").pipeline(require("stream").Readable.from(chunks), process.stdout, () => {})`],
    ["console.write()", `for (const chunk of chunks) console.write(chunk)`],
    [
      "Bun.write(Bun.stdout)",
      `(async () => { for (const chunk of chunks) if (chunk.length) await Bun.write(Bun.stdout, chunk); })()`,
    ],
    [
      "Bun.stdout.writer()",
      `const sink = Bun.stdout.writer(); for (const chunk of chunks) sink.write(chunk); sink.end()`,
    ],
    [
      "fs.writeSync(1)",
      `for (const chunk of chunks) for (let at = 0; at < chunk.length; ) at += require("fs").writeSync(1, chunk, at)`,
    ],
    [
      "fs.createWriteStream",
      `const out = require("fs").createWriteStream(null, { fd: 1 }); for (const chunk of chunks) out.write(chunk)`,
    ],
    [
      "a child that inherits it",
      `Bun.spawn([process.execPath, "-e", "for (const chunk of " + source + ") process.stdout.write(chunk)"], { stdout: "inherit" })`,
    ],
  ])("%s delivers every byte once, in order", async (_, write) => {
    await using child = start(`const source = ${JSON.stringify(chunks)}, chunks = eval(source); ${write}`);
    expect(digest(await Array.fromAsync(child.output))).toBe(expected);
    expect(await child.result()).toEqual({ exitCode: 0, stderr: "" });
  });

  // Rejects with the error of ftruncate().
  test.todoIf(isWindows)("Bun.write(Bun.stdout) takes an empty string", async () => {
    await using child = start(`for (const text of ["a", "", "b"]) await Bun.write(Bun.stdout, text)`);
    expect((await Array.fromAsync(child.output)).join("")).toBe("ab");
    expect(await child.result()).toEqual({ exitCode: 0, stderr: "" });
  });

  test("keeps lines whole when several processes write to it", async () => {
    await using child = start(`
      for (const letter of "abcd")
        Bun.spawn([process.execPath, "-e", "for (let i = 0; i < 200; i++) console.log(Buffer.alloc(200, process.argv[1]).toString())", letter], { stdout: "inherit" });
    `);
    const counts: Record<string, number> = {};
    for (const line of Buffer.concat(await Array.fromAsync(child.output))
      .toString()
      .split("\n"))
      counts[line] = (counts[line] ?? 0) + 1;
    expect(counts).toEqual({
      ...Object.fromEntries([..."abcd"].map(c => [Buffer.alloc(200, c).toString(), 200])),
      "": 1,
    });
    expect(await child.result()).toEqual({ exitCode: 0, stderr: "" });
  });

  test.each([
    [
      "process.stdout",
      `process.stdout.on("error", report); (function more() { process.stdout.write(chunk, error => error || setImmediate(more)); })()`,
    ],
    ["Bun.write(Bun.stdout)", `(async () => { for (;;) await Bun.write(Bun.stdout, chunk); })().catch(report)`],
    [
      "Bun.stdout.writer()",
      `(async () => { const sink = Bun.stdout.writer(); for (;;) await sink.write(chunk), await sink.flush(); })().catch(report)`,
    ],
    ["fs.writeSync(1)", `try { for (;;) require("fs").writeSync(1, chunk); } catch (error) { report(error); }`],
  ])("%s reports that the reader has left", async (_, write) => {
    await using child = start(`
      ${isWindows ? "" : `process.on("SIGPIPE", () => {});`}
      const chunk = Buffer.alloc(100_000, "x");
      const report = error => { console.error(error.code); process.exit(0); };
      ${write}
    `);
    await once(child.output, "data");
    child.output.destroy();
    // A write that was under way when the reader left ends with ERROR_BROKEN_PIPE, which is EOF to node:fs as well, or as on a socket.
    const underWay = isWindows ? "EOF" : isMacOS ? "ENOTCONN" : kind === "spawn" ? "ECONNRESET" : "EPIPE";
    expect(await child.result()).toEqual({
      exitCode: 0,
      stderr: expect.stringMatching(new RegExp(`^(EPIPE|${underWay})\n$`)),
    });
  });
});

// Cygwin, MSYS2 and others hand down pipes that no Bun or Node.js process would make.
describe.concurrent.skipIf(!isWindows).each([
  ["does not wait", { nowait: 1 }],
  ["does not wait and is overlapped", { nowait: 1, overlapped: 1 }],
  ["carries messages", { message: 1 }],
  ["carries messages and is read by message", { message: 1, byMessage: 1 }],
  ["carries messages, is read by message and is overlapped", { message: 1, byMessage: 1, overlapped: 1 }],
])("a pipe that %s", (_, kind) => {
  async function run(direction: "read" | "write", script: string) {
    using dir = tempDir("foreign-pipe", {
      "child.js": script,
      "peer.js": `
        const fs = require("fs");
        while (!fs.existsSync("ready")) Bun.sleepSync(1);
        if (process.argv[2] === "write") console.log(fs.readFileSync(0).length);
        else for (const size of [1, 0, 70000, 3, 200000]) fs.writeSync(1, Buffer.alloc(size)), Bun.sleepSync(2);
      `,
      "main.js": `
        const fs = require("fs");
        const k32 = require("bun:ffi").dlopen("kernel32.dll", {
          CreateNamedPipeW: { args: ["ptr", "u32", "u32", "u32", "u32", "u32", "u32", "ptr"], returns: "i64" },
          CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "i64" },
        }).symbols;
        const { nowait = 0, overlapped = 0, message = 0, byMessage = 0 } = ${JSON.stringify(kind)};
        const name = Buffer.from("\\\\\\\\.\\\\pipe\\\\bun-test-" + crypto.randomUUID() + "\\0", "utf16le");
        const [theirs, ours] = [
          k32.CreateNamedPipeW(name, 3 | (overlapped << 30), (message << 2) | (byMessage << 1) | nowait, 1, 4096, 4096, 0, null),
          k32.CreateFileW(name, 0xc0000000, 0, null, 3, 0, null),
        ].map(windowsHandle => fs.createReadStream(null, { windowsHandle, autoClose: false }).fd);
        const slots = fd => ${direction === "read"} === (fd === theirs) ? [fd, "inherit", "inherit"] : ["ignore", fd, "inherit"];
        Bun.spawn([process.execPath, "child.js"], { stdio: slots(theirs) });
        Bun.spawn([process.execPath, "peer.js", "${direction}"], { stdio: slots(ours) });
        fs.closeSync(theirs), fs.closeSync(ours);
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const ready = `setImmediate(() => require("fs").writeFileSync("ready", ""));`;

  test.each([
    [
      "process.stdin",
      `let n = 0; process.stdin.on("data", chunk => (n += chunk.length)).on("end", () => console.log(n));`,
    ],
    [
      "Bun.stdin.stream()",
      `let n = 0; for await (const chunk of Bun.stdin.stream()) n += chunk.length; console.log(n);`,
    ],
  ])("is read by %s", async (_, read) => {
    expect(await run("read", ready + read)).toEqual({ stdout: "270004\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["process.stdout", `process.stdout.write(data)`],
    ["console.write()", `console.write(data)`],
    ["Bun.stdout.writer()", `const sink = Bun.stdout.writer(); sink.write(data); sink.end()`],
    ["fs.writeSync(1)", `for (let at = 0; at < data.length; ) at += require("fs").writeSync(1, data, at)`],
    ["Bun.write()", `Bun.write(Bun.stdout, data)`],
    ["the shell", "Bun.$`cat < ${data}`.then()"],
  ])("is written by %s", async (_, write) => {
    const script = `require("fs").writeFileSync("ready", ""); const data = Buffer.alloc(300000, "x"); ${write}`;
    expect(await run("write", script)).toEqual({ stdout: "300000\n", stderr: "", exitCode: 0 });
  });
});

describe.concurrent.skipIf(!isWindows)("a TCP socket", () => {
  async function run(slot: number, script: string) {
    const { promise: received, resolve } = Promise.withResolvers<number>();
    let count = 0;
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open: socket => void (slot === 0 && socket.end("from the peer")),
        data: (_, data) => void (count += data.length),
        close: () => resolve(count),
      },
    });
    using dir = tempDir("socket-stdio", {
      "child.js": script,
      "main.js": `
        const ws2 = require("bun:ffi").dlopen("ws2_32.dll", {
          WSAStartup: { args: ["u16", "ptr"], returns: "i32" },
          WSASocketW: { args: ["i32", "i32", "i32", "ptr", "u32", "u32"], returns: "i64" },
          connect: { args: ["i64", "ptr", "i32"], returns: "i32" },
        }).symbols;
        ws2.WSAStartup(0x202, Buffer.alloc(512));
        const windowsHandle = ws2.WSASocketW(2, 1, 6, null, 0, 0);
        ws2.connect(windowsHandle, Buffer.from([2, 0, ${server.port >> 8}, ${server.port & 255}, 127, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), 16);
        const { fd } = require("fs").createReadStream(null, { windowsHandle, autoClose: false });
        const stdio = ["ignore", "inherit", "inherit"];
        stdio[${slot}] = fd;
        process.exitCode = await Bun.spawn([process.execPath, "child.js"], { stdio }).exited;
      `,
    });
    await using proc = spawn({ cmd: [bunExe(), "main.js"], cwd: String(dir), env: bunEnv, stderr: "inherit" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode, received: await received };
  }

  test("is read by Bun.stdin.text()", async () => {
    expect(await run(0, `console.log(await Bun.stdin.text());`)).toEqual({
      stdout: "from the peer\n",
      exitCode: 0,
      received: 0,
    });
  });

  test("is written by process.stdout", async () => {
    expect(await run(1, `process.stdout.write(Buffer.alloc(300000))`)).toEqual({
      stdout: "",
      exitCode: 0,
      received: 300000,
    });
  });
});
