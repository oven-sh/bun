import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
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
});

// https://github.com/oven-sh/bun/issues/7251
// console.log() writes directly to fd 1/2 in Bun (bypassing process.stdout), so a
// broken-pipe EPIPE was swallowed and `process.stdout.on('error', ...)` never fired,
// leaving a `setImmediate` loop running forever. Node.js routes console.log through
// process.stdout.write(), so the 'error' listener is called. Bun now forwards the
// write error from the native console writer onto process.stdout/stderr.
describe.concurrent.skipIf(isWindows)("console.* EPIPE surfaces on process.stdout/stderr (#7251)", () => {
  const script = (fn: "log" | "error", stream: "stdout" | "stderr") => `
    process.${stream}.on('error', (err) => {
      process.${stream === "stdout" ? "stderr" : "stdout"}.write(
        JSON.stringify({ code: err.code, syscall: err.syscall, errno: err.errno }) + '\\n',
      );
      process.exit(0);
    });
    function loop() {
      console.${fn}('bun');
      setImmediate(loop);
    }
    loop();
  `;

  // Spawn `bun -e <script>` with the chosen stdio piped, read a small prefix to let the
  // child start writing, then close the pipe so subsequent writes EPIPE.
  async function runWithBrokenPipe(code: string, which: "stdout" | "stderr") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const target = which === "stdout" ? proc.stdout : proc.stderr;
    const other = which === "stdout" ? proc.stderr : proc.stdout;
    const reader = target.getReader();
    await reader.read();
    reader.releaseLock();
    await target.cancel();

    const [otherText, exitCode] = await Promise.all([other.text(), proc.exited]);
    return { otherText, exitCode };
  }

  test("console.log → process.stdout 'error' listener fires with EPIPE", async () => {
    const { otherText, exitCode } = await runWithBrokenPipe(script("log", "stdout"), "stdout");
    expect(JSON.parse(otherText)).toEqual({ code: "EPIPE", syscall: "write", errno: -32 });
    expect(exitCode).toBe(0);
  });

  test("console.error → process.stderr 'error' listener fires with EPIPE", async () => {
    const { otherText, exitCode } = await runWithBrokenPipe(script("error", "stderr"), "stderr");
    expect(JSON.parse(otherText)).toEqual({ code: "EPIPE", syscall: "write", errno: -32 });
    expect(exitCode).toBe(0);
  });

  test("console.log with no 'error' listener does not throw when piped to a closed reader", async () => {
    // Node.js's console.log adds a once('error', noop) so the common `| head` case
    // without a listener completes quietly instead of throwing an uncaught exception.
    // A tight sync loop writing >64KB guarantees the pipe buffer fills and later
    // writes EPIPE; the process should still finish normally.
    const code = `
      const s = Buffer.alloc(1024, 120).toString();
      for (let i = 0; i < 2000; i++) console.log(s);
      process.stderr.write('DONE\\n');
    `;
    const { otherText, exitCode } = await runWithBrokenPipe(code, "stdout");
    expect(otherText).toContain("DONE");
    expect(exitCode).toBe(0);
  });
});
