import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { release } from "node:os";
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

    // Node's stream writes with write(2), so after setBlocking(true) a write waits for the reader and all of it is out when
    // write() returns. Command-line tools (tsc, uglify-js) call it so that a process.exit() right after loses nothing.
    // The child first fills the socket or the pipe, which nobody reads yet: a write that does not wait then puts no byte into
    // it and returns false. It says what setBlocking(true) returned before it writes, and what the writes returned after.
    // tsc and uglify-js write strings: an ASCII, a Latin-1 and a UTF-16 string each take their own way into the sink.
    const blockingWriterScript = (name: "stdout" | "stderr") => `
      const fs = require("fs");
      const [stream, fd, otherFd] = [process.${name}, ${name === "stdout" ? "1, 2" : "2, 1"}];
      const report = v => fs.writeSync(otherFd, JSON.stringify(v) + "\\n");
      const chunk = Buffer.alloc(1 << 20, "B");
      const lines = ["plain ASCII\\n", Buffer.from([99, 97, 102, 233, 10]).toString("latin1"), "\\u6f22\\u5b57 \\u{1f600}\\n"];
      let filled = 0;
      try {
        for (;;) filled += fs.writeSync(fd, Buffer.alloc(1 << 16, "A"));
      } catch (err) {
        if (err.code !== "EAGAIN") throw err;
      }
      report({ result: stream._handle.setBlocking(true), filled });
      const buffer = stream.write(chunk);
      let strings = true;
      for (let i = 0; i < 600; i++) strings = stream.write(lines[i % 3]) && strings;
      report({ buffer, strings });
      process.exit(0);`;
    const lines = "plain ASCII\n" + "caf\u00e9\n" + "\u6f22\u5b57 \u{1f600}\n";
    const written = Buffer.concat([Buffer.alloc(1 << 20, "B"), Buffer.alloc(200 * Buffer.byteLength(lines), lines)]);
    // What arrived after the bytes that filled the descriptor.
    const afterFilled = (bytes: Uint8Array, filled: number) => ({
      bytes: bytes.byteLength - filled,
      same: written.equals(bytes.subarray(filled)),
    });
    const allWritten = { result: 0, buffer: true, strings: true, bytes: written.length, same: true };

    // Socketpair with a lazy parent: nothing reads the stream until the child is about to write to it.
    test.each(["stdout", "stderr"] as const)(
      "process.%s.write after _handle.setBlocking(true) is complete when it returns, ahead of process.exit()",
      async name => {
        await using proc = spawn({
          cmd: [bunExe(), "-e", blockingWriterScript(name)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
          lazy: true,
        });
        const [output, reports] = name === "stdout" ? [proc.stdout, proc.stderr] : [proc.stderr, proc.stdout];
        const events = jsonLines(reports);
        const { result, filled } = await events.next();
        const [bytes, wrote, exitCode] = await Promise.all([output.bytes(), events.next(), proc.exited]);
        expect({ result, ...wrote, ...afterFilled(bytes, filled) }).toEqual(allWritten);
        expect(exitCode).toBe(0);
      },
    );

    // Real pipe(2) via sh. The reader only starts on SIGUSR1, so the pipe is full while the write waits.
    test("process.stdout.write after _handle.setBlocking(true) waits for the reader of a real pipe", async () => {
      await using proc = spawn({
        cmd: ["sh", "-c", `"$0" -e "$1" | "$0" -e "$2"`, bunExe(), blockingWriterScript("stdout"), gatedReader],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const events = jsonLines(proc.stderr);
      const seen: { reader?: number; result?: number; filled?: number; buffer?: boolean; strings?: boolean } = {};
      while (seen.reader === undefined || seen.result === undefined) Object.assign(seen, await events.next());
      process.kill(seen.reader, "SIGUSR1");
      const [bytes, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      while (seen.buffer === undefined) Object.assign(seen, await events.next());
      const { reader, filled, ...reports } = seen;
      expect({ ...reports, ...afterFilled(bytes, filled!) }).toEqual(allWritten);
      expect(exitCode).toBe(0);
    });

    // What a write from before the call left in the stream drains with writes that wait too.
    test("process.stdout.write after _handle.setBlocking(true) and the 'drain' of an earlier write is complete when it returns", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const report = v => require("fs").writeSync(2, JSON.stringify(v) + "\\n");
           const chunk = Buffer.alloc(1 << 20, "B");
           report({ first: process.stdout.write(Buffer.alloc(1 << 20, "A")) });
           report({ result: process.stdout._handle.setBlocking(true) });
           process.stdout.once("drain", () => {
             report({ ret: process.stdout.write(chunk) });
             process.exit(0);
           });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const events = jsonLines(proc.stderr);
      expect(await events.next()).toEqual({ first: false });
      const [bytes, reports, exitCode] = await Promise.all([
        proc.stdout.bytes(),
        (async () => [await events.next(), await events.next()])(),
        proc.exited,
      ]);
      // All of A, then all of B.
      expect({ reports, bytes: bytes.byteLength, lastA: bytes.lastIndexOf(65), firstB: bytes.indexOf(66) }).toEqual({
        reports: [{ result: 0 }, { ret: true }],
        bytes: 2 << 20,
        lastA: (1 << 20) - 1,
        firstB: 1 << 20,
      });
      expect(exitCode).toBe(0);
    });

    // As in libuv, what was queued before the call waits for the writable poll: nobody reads yet, and the loop still runs.
    // process.exit() then writes it and waits for the reader, where a stream that was not asked to block only tries once.
    test("bytes queued before _handle.setBlocking(true) do not stop the event loop, and process.exit() writes them", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const report = v => require("fs").writeSync(2, JSON.stringify(v) + "\\n");
           const first = process.stdout.write(Buffer.alloc(1 << 20, "A"));
           report({ first, result: process.stdout._handle.setBlocking(true) });
           setImmediate(() => {
             report({ loopRuns: true });
             process.exit(0);
           });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const events = jsonLines(proc.stderr);
      expect([await events.next(), await events.next()]).toEqual([{ first: false, result: 0 }, { loopRuns: true }]);
      const [bytes, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(bytes.byteLength).toBe(1 << 20);
      expect(exitCode).toBe(0);
    });

    // setBlocking(false) puts the stream's own writes back, and not only O_NONBLOCK: the inherit spawn clears that flag
    // again, and the stream still does not wait. Node reads the argument with IsTrue(), so 1 does not turn it on.
    const blockingThenNot = `for (const blocking of [true, false, 1]) if (process.stdout._handle.setBlocking(blocking) !== 0) throw new Error("setBlocking failed");`;
    test("process.stdout.write on a socket is asynchronous again after _handle.setBlocking(false)", async () => {
      await expectDrainOverSocket(blockingThenNot + afterInheritSpawn, 1 + (1 << 20));
    });

    test.skipIf(!pipesHaveNowait)(
      "process.stdout.write on a pipe is asynchronous again after _handle.setBlocking(false) (RWF_NOWAIT)",
      async () => {
        await expectDrainOverPipe(blockingThenNot + afterInheritSpawn, "{}", { drained: true }, 1 + (1 << 20));
      },
    );

    // After setBlocking(true) a socket is written with write(2), as libuv does, and not with send(MSG_NOSIGNAL).
    test("process.stdout.write after _handle.setBlocking(true) to a socket that nobody reads fails with EPIPE", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const fs = require("fs");
           const result = process.stdout._handle.setBlocking(true);
           fs.readSync(0, Buffer.alloc(1)); // until the parent has closed its end of stdout
           process.stdout.on("error", err => {
             fs.writeSync(2, JSON.stringify({ result, code: err.code, syscall: err.syscall }));
             process.exit(7);
           });
           process.stdout.write(Buffer.alloc(1 << 20, "B"));`,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.stdout.cancel();
      proc.stdin.write("x");
      await proc.stdin.end();
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stderr)).toEqual({ result: 0, code: "EPIPE", syscall: "write" });
      expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 7, signalCode: null });
    });

    // libuv reopens a terminal, so its O_NONBLOCK never reaches the description that the parent shell has too.
    test("process.stdout._handle.setBlocking(false) leaves a terminal blocking", async () => {
      let output = "";
      const reported = Promise.withResolvers<void>();
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const result = process.stdout._handle.setBlocking(false);
           require("fs").writeSync(1, JSON.stringify({ isTTY: process.stdout.isTTY, result }) + " ");
           process.argv = [process.argv[0], "probe", "1"];
           require(${JSON.stringify(probe)});`,
        ],
        env: bunEnv,
        terminal: {
          data(_terminal, chunk: Uint8Array) {
            output += Buffer.from(chunk).toString();
            if (/\d:(non)?blocking/.test(output)) reported.resolve();
          },
          exit() {
            reported.reject(new Error("the terminal closed before the report: " + JSON.stringify(output)));
          },
        },
      });
      await reported.promise;
      expect(output.trim()).toBe('{"isTTY":true,"result":0} 1:blocking');
      expect(await proc.exited).toBe(0);
      proc.terminal!.close();
    });
  },
);
