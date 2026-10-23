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

// A FileSink writes a string as UTF-8, so process.stdout/stderr decode every other encoding before the sink. Each row
// is statements run with `w` as the stream, then what node v26.3.0 does with them: the bytes on the fd in hex, or the
// code thrown.
describe.concurrent.each(["stdout", "stderr"] as const)("process.%s.write(chunk, encoding)", name => {
  const rows: [statements: string, expected: string][] = [
    [`w.write("0001ff", "hex")`, "0001ff"],
    [`w.write("0001ff", "HEX")`, "0001ff"],
    [`w.write("AAEC/w==", "base64")`, "000102ff"],
    [`w.write("AAEC_w", "base64url")`, "000102ff"],
    [`w.write("\\u00e9\\u00ff", "latin1")`, "e9ff"],
    [`w.write("\\u00e9\\u00ff", "binary")`, "e9ff"],
    [`w.write("a\\u00e9", "ascii")`, "61e9"],
    [`w.write("ab", "utf16le")`, "61006200"],
    [`w.write("ab", "utf-16le")`, "61006200"],
    [`w.write("ab", "ucs2")`, "61006200"],
    [`w.write("ab", "ucs-2")`, "61006200"],
    [`w.write("\\u00e9", "utf8")`, "c3a9"],
    [`w.write("\\u00e9", "utf-8")`, "c3a9"],
    [`w.write("\\u00e9", "UTF8")`, "c3a9"],
    [`w.write("\\u00e9")`, "c3a9"],
    [`w.write("\\u00e9", "")`, "c3a9"],
    [`w.write("\\u00e9", null, () => {})`, "c3a9"],
    [`w.write("\\u00e9", () => {})`, "c3a9"],
    [`w.write("0001ff", "hex", () => {})`, "0001ff"],
    [`w.write("", "hex")`, ""],
    [`w.write("zz", "hex")`, ""],
    [`w.write(Buffer.from("x"), "hex")`, "78"],
    [`w.write(Buffer.from("x"), "buffer")`, "78"],
    [`w.write(new Uint8Array([120]), "hex")`, "78"],
    [`w.write("00", "hex"); w.write("A"); w.write("AQ==", "base64"); w.write("B")`, "00410142"],

    [`w.setDefaultEncoding("hex"); w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("HEX"); w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("hex"); w.write("0001ff", () => {})`, "0001ff"],
    [`w.setDefaultEncoding("hex"); w.write("\\u00e9", "utf8")`, "c3a9"],
    [`w.setDefaultEncoding("hex"); w.write(Buffer.from("x"))`, "78"],
    [`w.setDefaultEncoding("hex"); w.write("00"); w.setDefaultEncoding("utf8"); w.write("00")`, "003030"],
    [`w._writableState.defaultEncoding = "hex"; w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("hex"); new (require("node:console").Console)(w).log("ff")`, "ff"],

    [`w.write.bind(w)("0001ff", "hex")`, "0001ff"],
    [
      `const write = w.write; w.write = function (chunk, encoding, cb) { return write.call(this, chunk, encoding, cb); }; w.write("0001ff", "hex"); w.write = write`,
      "0001ff",
    ],
    [`w.cork(); w.write("0001ff", "hex"); w.uncork()`, "0001ff"],

    [`w.write("x", "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", "buffer", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(Buffer.from("x"), "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(new Uint8Array([120]), "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", 123, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", {}, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", true, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("", "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(123, "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(undefined, "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(null, "nope", cb)`, "ERR_STREAM_NULL_VALUES"],

    [`w.destroy(); w.write("0001ff", "hex")`, "0001ff"],
  ];

  // A ";" follows each row: no row can write that byte. The child reports the codes thrown, and how often `cb` ran, on
  // the other stream.
  const script = `
    const w = process.${name};
    const separator = Buffer.from(";");
    const threw = {};
    let callbacks = 0;
    const cb = () => callbacks++;
    process.on("exit", () => require("node:fs").writeSync(${name === "stdout" ? 2 : 1}, JSON.stringify({ threw, callbacks })));
    ${rows
      .map(
        ([statements], i) =>
          `try { ${statements}; } catch (e) { threw[${i}] = e.code; } w.setDefaultEncoding("utf8"); w.write(separator);`,
      )
      .join("\n    ")}
    w.write("41", "hex"); w.write("42", "hex"); w.write("c"); process.exit(0);
  `;

  test.each(["pipe", "file"] as const)("to a %s", async target => {
    using dir = tempDir(`process-${name}-write-encoding`, {});
    const file = path.join(String(dir), "out");
    const stdio = (stream: "stdout" | "stderr") => (stream === name && target === "file" ? Bun.file(file) : "pipe");
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: stdio("stdout"),
      stderr: stdio("stderr"),
    });
    const piped = (stream: "stdout" | "stderr") =>
      stream === name && target === "file" ? undefined : (proc[stream] as ReadableStream<Uint8Array>).bytes();
    const [stdout, stderr, exitCode] = await Promise.all([piped("stdout"), piped("stderr"), proc.exited]);
    const [mine, other] = name === "stdout" ? [stdout, stderr] : [stderr, stdout];
    const written = Buffer.from(target === "file" ? await Bun.file(file).bytes() : mine!);

    const reported = Buffer.from(other!).toString();
    let report: { threw: Record<number, string>; callbacks: number };
    try {
      report = JSON.parse(reported);
    } catch {
      throw new Error(`the child did not report on the other stream: ${JSON.stringify(reported)}`);
    }
    // latin1 maps each byte to one char and back, so this splits the bytes at each separator.
    const segments = written
      .toString("latin1")
      .split(";")
      .map(segment => Buffer.from(segment, "latin1").toString("hex"));
    const actual = rows.map(([statements], i) => [
      statements,
      i in report.threw ? [report.threw[i], segments[i]].filter(Boolean).join(" after writing ") : segments[i],
    ]);

    expect({
      rows: Object.fromEntries(actual),
      beforeExit: segments.slice(rows.length),
      callbacks: report.callbacks,
      exitCode,
    }).toEqual({
      rows: Object.fromEntries(rows),
      // "41" and "42" as hex, then "c": the decoded chunks leave in call order, and process.exit() does not drop them.
      beforeExit: ["414263"],
      callbacks: 0,
      exitCode: 0,
    });
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
