import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
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

    // The chunk the sink holds is pending in Writable: writableLength counts it and writableNeedDrain is set until
    // 'drain'. Write callbacks run in write order, after 'drain', never inside write().
    test("process.stdout tracks a held write in writableLength and writableNeedDrain", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const out = process.stdout, report = o => require("fs").writeSync(2, JSON.stringify(o) + "\\n");
           const state = () => ({ length: out.writableLength, needDrain: out.writableNeedDrain });
           const order = [];
           const ret1 = out.write(Buffer.alloc(1 << 20, "A"), () => order.push("cb1"));
           const ret2 = out.write("B", () => order.push("cb2"));
           report({ ret1, ret2, order, ...state() });
           out.once("drain", () => {
             order.push("drain");
             process.nextTick(() => report({ order, ...state() }));
           });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const events = jsonLines(proc.stderr);
      expect(await events.next()).toEqual({
        ret1: false,
        ret2: false,
        order: [],
        length: (1 << 20) + 1,
        needDrain: true,
      });
      const [stdout, drained, exitCode] = await Promise.all([proc.stdout.bytes(), events.next(), proc.exited]);
      expect(stdout.byteLength).toBe((1 << 20) + 1);
      expect(stdout[stdout.byteLength - 1]).toBe("B".charCodeAt(0));
      expect(drained).toEqual({ order: ["drain", "cb1", "cb2"], length: 0, needDrain: false });
      expect(exitCode).toBe(0);
    });

    // pino's sonic-boom takes its batched fd writer only when process.stdout.write is the prototype's.
    test("process.stdout.write is inherited from the prototype", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Writable } = require("node:stream");
           process.stdout.write(JSON.stringify({
             own: Object.hasOwn(process.stdout, "write"),
             proto: process.stdout.write === process.stdout.constructor.prototype.write,
             writable: process.stdout instanceof Writable,
           }) + "\\n");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ own: false, proto: true, writable: true });
      expect(exitCode).toBe(0);
    });

    test("process.stdout.write decodes the encoding argument and the default encoding", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write("\u00e9", "latin1");
           process.stdout.write("aGk=", "base64");
           process.stdout.write("hi", "utf16le");
           process.stdout.setDefaultEncoding("hex");
           process.stdout.write("4142");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(Buffer.from(stdout).toString("hex")).toBe("e9" + "6869" + "68006900" + "4142");
      expect(exitCode).toBe(0);
    });

    test("process.stdout holds corked writes until uncork() and then calls back in order", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const out = process.stdout, order = [];
           out.cork();
           for (const c of ["a", "b", "c"]) out.write(c, () => order.push(c));
           const corked = { length: out.writableLength, corked: out.writableCorked, order: [...order] };
           out.uncork();
           process.nextTick(() => {
             require("fs").writeSync(2, JSON.stringify({ corked, after: { length: out.writableLength, order } }) + "\\n");
           });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("abc");
      expect(JSON.parse(stderr)).toEqual({
        corked: { length: 3, corked: 1, order: [] },
        after: { length: 0, order: ["a", "b", "c"] },
      });
      expect(exitCode).toBe(0);
    });

    // The reader goes away after the first chunk. The held write fails with EPIPE, the stream emits 'error' and
    // 'close' and is reset, as node's stdout is, so a later write still calls back.
    test("process.stdout takes writes again after a failed write", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const out = process.stdout, ev = [], report = o => require("fs").writeSync(2, JSON.stringify(o) + "\\n");
           out.on("close", () => ev.push("close"));
           out.once("error", e => {
             ev.push("error:" + e.code);
             out.write("again", e => {
               ev.push("cbAfter:" + (e ? e.code : null));
               process.nextTick(() => report({ ev, length: out.writableLength, errored: out.errored, writable: out.writable }));
             });
           });
           out.write(Buffer.alloc(1 << 20, "A"), e => ev.push("cb1:" + (e ? e.code : null)));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = proc.stdout.getReader();
      await reader.read();
      await reader.cancel();
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const report = JSON.parse(stderr.trim().split("\n").pop()!);
      expect(report.ev.slice(0, 3)).toEqual(["cb1:EPIPE", "error:EPIPE", "close"]);
      expect(report.ev.filter(e => e.startsWith("cbAfter:"))).toHaveLength(1);
      expect({ length: report.length, errored: report.errored, writable: report.writable }).toEqual({
        length: 0,
        errored: null,
        writable: true,
      });
      expect(exitCode).toBe(0);
    });

    // A service that writes a line on every tick, with an 'uncaughtException' handler and no 'error' listener on the
    // stream. Three writes after the handler first ran, it stops and reports on `reportFd` what the handler was told.
    const tickingService = (name: "stdout" | "stderr", reportFd: 1 | 2) =>
      `const told = [];
       process.on("uncaughtException", (err, origin) => told.push(err.code + " from " + origin));
       let writesAfter = 0;
       const timer = setInterval(() => {
         process.${name}.write("tick\\n");
         if (told.length > 0 && ++writesAfter === 3) {
           clearInterval(timer);
           require("fs").writeSync(${reportFd}, JSON.stringify([...new Set(told)]) + "\\n");
         }
       }, 1);`;
    const toldEpipe = JSON.stringify(["EPIPE from uncaughtException"]) + "\n";

    // The reader takes the first chunk and leaves. As in node, the EPIPE of a later write is thrown from a tick when
    // the stream has no 'error' listener, so the handler gets it and the service runs on.
    test.each(["stdout", "stderr"] as const)(
      "an EPIPE on process.%s over a socket with no 'error' listener goes to the uncaughtException handler",
      async name => {
        await using proc = spawn({
          cmd: [bunExe(), "-e", tickingService(name, name === "stdout" ? 2 : 1)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const reader = proc[name].getReader();
        await reader.read();
        await reader.cancel();
        const [report, exitCode] = await Promise.all([
          proc[name === "stdout" ? "stderr" : "stdout"].text(),
          proc.exited,
        ]);
        expect(report).toBe(toldEpipe);
        expect(exitCode).toBe(0);
      },
    );

    // The same over a real pipe(2) whose reader is `head -n 1`. The service reports on sh's stderr, then sh adds its
    // exit code.
    test.each([
      ["stdout", `"$0" -e "$1"`],
      ["stderr", `"$0" -e "$1" 3>&2 2>&1 1>&3`],
    ] as const)(
      "an EPIPE on process.%s over a pipe with no 'error' listener goes to the uncaughtException handler",
      async (name, run) => {
        await using proc = spawn({
          cmd: [
            "sh",
            "-c",
            `{ ${run}; echo "exit code $?" >&2; } | head -n 1`,
            bunExe(),
            tickingService(name, name === "stdout" ? 2 : 1),
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe("tick\n");
        expect(stderr).toBe(toldEpipe + "exit code 0\n");
        expect(exitCode).toBe(0);
      },
    );

    // A throw from the callback of a held write, or from a 'drain' listener, is an uncaughtException as in node.
    test.each(["callback", "drain"])("a throw from the %s of a held write is an uncaughtException", async where => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.on("uncaughtException", e => { require("fs").writeSync(2, "uncaughtException:" + e.message); process.exit(0); });
           process.on("unhandledRejection", e => { require("fs").writeSync(2, "unhandledRejection:" + e.message); process.exit(1); });
           const out = process.stdout;
           if (${JSON.stringify(where)} === "drain") out.once("drain", () => { throw new Error("from drain"); });
           out.write(Buffer.alloc(1 << 20, "A"), () => { if (${JSON.stringify(where)} === "callback") throw new Error("from callback"); });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stdout.byteLength).toBe(1 << 20);
      expect(stderr).toBe("uncaughtException:from " + where);
      expect(exitCode).toBe(0);
    });

    // Bun.stdout.writer() takes an ArrayBuffer. So do the streams over it, unlike node's.
    test("process.stdout.write takes an ArrayBuffer and a SharedArrayBuffer", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const ab = new Uint8Array([65, 66]).buffer;
           const sab = new SharedArrayBuffer(2); new Uint8Array(sab).set([67, 68]);
           process.stdout.write(ab); process.stdout.write(sab); process.stdout.write("\\n");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ABCD\n");
      expect(exitCode).toBe(0);
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
