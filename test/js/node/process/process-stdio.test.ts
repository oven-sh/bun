import { $, spawn, spawnSync } from "bun";
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

  test("a write to process.stdout or process.stderr queues no tick", async () => {
    const script = `
      const { stdout, stderr, nextTick } = process;
      const queued = [];
      process.nextTick = (...args) => queued.push(args);
      stdout.write("out ");
      stderr.write("err");
      process.nextTick = nextTick;
      console.log(queued.length);
    `;
    await using proc = spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "out 0\n", stderr: "err" });
    expect(exitCode).toBe(0);
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

  // The reader takes nothing from the pipe until the writer's event loop has shown that it runs.
  test.each([
    ["fs.write(1, data, callback)", `fs.write(1, data, () => {});`],
    ["fs.writev(1, [data], callback)", `fs.writev(1, [data], () => {});`],
    ["Bun.write(Bun.stdout, data)", `Bun.write(Bun.stdout, data);`],
  ])("%s with more than the pipe holds leaves the event loop running", async (_, write) => {
    using dir = tempDir("stdout-write-leaves-the-loop", {
      "writer.js": `
        const fs = require("node:fs");
        const data = Buffer.alloc(1024 * 1024, "x");
        ${write}
        setImmediate(() => fs.writeFileSync("loop-runs", ""));
      `,
      "reader.js": `
        const fs = require("node:fs");
        const deadline = Date.now() + 30_000;
        while (!fs.existsSync("loop-runs") && Date.now() < deadline) Bun.sleepSync(5);
        const loopRan = fs.existsSync("loop-runs");
        let total = 0;
        for await (const chunk of Bun.stdin.stream()) total += chunk.length;
        console.log(JSON.stringify({ loopRan, total }));
      `,
    });
    const { stdout, exitCode } = await $`${bunExe()} writer.js | ${bunExe()} reader.js`
      .cwd(String(dir))
      .env(bunEnv)
      .quiet()
      .nothrow();
    expect({ ...JSON.parse(stdout.toString()), exitCode }).toEqual({ loopRan: true, total: 1024 * 1024, exitCode: 0 });
  });
});

describe.concurrent.if(isWindows)(
  "like in Node, a write to process.stdout/stderr is over when it returns if they are pipes",
  () => {
    describe.each(["stdout", "stderr"] as const)("process.%s", name => {
      test.each([
        ["process.exit(0)", 0],
        ["throw new Error('thrown')", 1],
      ])("%s right after a write loses nothing", async (ending, expectedExitCode) => {
        await using proc = spawn({
          cmd: [bunExe(), "-e", `process.${name}.write(Buffer.alloc(1_000_000, "x")); ${ending};`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect((name === "stdout" ? stdout : stderr).match(/^x*/)![0].length).toBe(1_000_000);
        expect(exitCode).toBe(expectedExitCode);
      });
    });

    test("writes stay in order with those of console.log() and fs.writeSync()", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        process.stdout.write(Buffer.alloc(300_000, "A"));
        console.log("B");
        process.stdout.write("CCC");
        require("node:fs").writeSync(1, "D");
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(Array.from(stdout.matchAll(/(.)\1*/gs), ([run, char]) => [char, run.length])).toEqual([
        ["A", 300_000],
        ["B", 1],
        ["\n", 1],
        ["C", 3],
        ["D", 1],
      ]);
      expect(exitCode).toBe(0);
    });

    // The mode belongs to the end of the pipe, so whoever shares the end can set it: Cygwin, Ruby and Python do. To a write
    // that does not fit at once, such an end answers with success and 0 bytes written.
    test.each([
      ["process.stdout.write()", `process.stdout.write(data);`],
      ["console.log()", `for (let i = 0; i < 4; i++) console.log(data.toString("latin1", 0, 74_999));`],
      ["fs.writeSync()", `for (let written = 0; written < data.length; ) written += fs.writeSync(1, data, written);`],
      ["fs.write()", `await new Promise(done => fs.write(1, data, done));`],
      ["Bun.write()", `await Bun.write(Bun.stdout, data);`],
      ["Bun.stdout.writer()", `const writer = Bun.stdout.writer(); writer.write(data); await writer.end();`],
    ])("%s loses nothing on a pipe in the mode PIPE_NOWAIT", async (_, script) => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        const fs = require("node:fs");
        const { dlopen, ptr } = require("bun:ffi");
        const { GetStdHandle, SetNamedPipeHandleState } = dlopen("kernel32.dll", {
          GetStdHandle: { args: ["i32"], returns: "u64" },
          SetNamedPipeHandleState: { args: ["u64", "ptr", "ptr", "ptr"], returns: "i32" },
        }).symbols;
        const PIPE_NOWAIT = 1;
        if (!SetNamedPipeHandleState(GetStdHandle(-11), ptr(new Uint32Array([PIPE_NOWAIT])), null, null)) throw new Error();
        const data = Buffer.alloc(300_000, "x");
        ${script}
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.replaceAll("\n", "x").match(/^x*$/)![0].length).toBe(300_000);
      expect(exitCode).toBe(0);
    });
  },
);

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
