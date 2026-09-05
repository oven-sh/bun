import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
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

  // `ulimit -n` caps the fd table of the child. The script then opens /dev/null
  // until EMFILE, so the first touch of process.stdout / process.stderr cannot
  // dup() its fd for the FileSink fast path. The stream must still deliver the
  // bytes before process.exit(), the way node's synchronous stdio does.
  describe.skipIf(isWindows)("stdio writes at the fd limit", () => {
    const script = /* js */ `
      const fs = require("fs");
      // A debug build reads internal modules from disk on first use. Load the
      // stream module while an fd is still free.
      new fs.WriteStream(null, { fd: 1, autoClose: false });
      const held = [];
      try {
        for (;;) held.push(fs.openSync("/dev/null", "r"));
      } catch {}
      const ok = process.stderr.write("E1 diagnostic on stderr\\n");
      process.stdout.write("O1 line on stdout\\n");
      process.exit(ok ? 0 : 1);
    `;
    // detect_leaks=0: LeakSanitizer needs an fd for /proc/<pid>/task at exit
    // and prints its own failure on stderr when the table is full.
    const env = {
      ...bunEnv,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    };

    test("pipe: bytes written before process.exit() reach the reader", async () => {
      await using proc = spawn({
        cmd: ["/bin/sh", "-c", `ulimit -n 32 && exec "$1" -e "$2"`, "sh", bunExe(), script],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("O1 line on stdout\n");
      expect(stderr).toBe("E1 diagnostic on stderr\n");
      expect(exitCode).toBe(0);
    });

    test("file: bytes written before process.exit() reach the file", async () => {
      using dir = tempDir("stdio-fd-limit", {});
      const out = path.join(String(dir), "out.txt");
      const err = path.join(String(dir), "err.txt");
      await using proc = spawn({
        cmd: ["/bin/sh", "-c", `ulimit -n 32 && exec "$1" -e "$2" >"$3" 2>"$4"`, "sh", bunExe(), script, out, err],
        env,
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      expect(await Bun.file(out).text()).toBe("O1 line on stdout\n");
      expect(await Bun.file(err).text()).toBe("E1 diagnostic on stderr\n");
      expect(exitCode).toBe(0);
    });

    test("non-blocking pipe: a write larger than the pipe waits for the reader", async () => {
      const size = 1 << 20;
      // `Bun.file(1).writer()` puts O_NONBLOCK on the stdout description, so the
      // fallback meets EAGAIN once the pipe is full. The writer stays open: its
      // end() closes the dup on another thread, which would free an fd slot.
      // The parent starts reading only after the child has begun its write.
      const nonblockingScript = /* js */ `
        const fs = require("fs");
        new fs.WriteStream(null, { fd: 1, autoClose: false });
        const writer = Bun.file(1).writer();
        const held = [];
        try {
          for (;;) held.push(fs.openSync("/dev/null", "r"));
        } catch {}
        fs.writeSync(2, "writing\\n");
        process.stdout.write(Buffer.alloc(${size}, "x"));
        process.exit(writer ? 0 : 1);
      `;
      await using proc = spawn({
        cmd: ["/bin/sh", "-c", `ulimit -n 32 && exec "$1" -e "$2"`, "sh", bunExe(), nonblockingScript],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      let stderr = "";
      for await (const chunk of proc.stderr) {
        stderr += Buffer.from(chunk).toString();
        if (stderr.includes("writing\n")) break;
      }
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(stderr).toBe("writing\n");
      expect(stdout.length).toBe(size);
      expect(stdout.every(b => b === 0x78)).toBe(true);
      expect(exitCode).toBe(0);
    });
  });
});
