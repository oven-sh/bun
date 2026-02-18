import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27097
// Segfault when pipe write completion callback fires after close() freed StreamBuffer
// The bug: on Windows, close() called onCloseSource() synchronously, which could
// free the writer's StreamBuffer resources. If a uv_write was pending, its callback
// would later access the freed memory, causing a segfault at 0xFFFFFFFFFFFFFFFF.

test("closing spawn stdin while write is pending should not crash", async () => {
  // Spawn a process that reads from stdin.
  // Write data to stdin, then immediately close.
  // This creates a scenario where a pipe write may be pending when close() is called.
  for (let i = 0; i < 5; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdin.resume(); process.stdin.on('close', () => process.exit(0));"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });

    // Write a large amount of data to stdin - this makes it more likely that
    // a write will be pending when we close
    try {
      proc.stdin.write("x".repeat(65536));
      proc.stdin.flush();
    } catch {
      // Write may fail if process already exited - that's fine
    }

    // Close stdin while the write may still be pending
    proc.stdin.end();

    // Wait for the process to exit
    await proc.exited;
  }
}, 30_000);

test("rapid spawn and close cycles should not corrupt pipe state", async () => {
  // Simulate the pattern from the bug report: many spawn operations over time.
  // Each spawn creates pipes, writes some data, and tears down.
  const iterations = 10;

  for (let i = 0; i < iterations; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('ok');"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }
}, 30_000);

test("FileSink write and close race should not crash", async () => {
  // Test the FileSink (StreamingWriter) path by using spawn with a ReadableStream
  // as stdin, which creates a FileSink internally.
  for (let i = 0; i < 5; i++) {
    const data = "hello ".repeat(1000);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(data));
        controller.close();
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "let t=0; process.stdin.on('data',(c)=>{t+=c.length}); process.stdin.on('end',()=>{console.log(t)})",
      ],
      env: bunEnv,
      stdin: stream,
      stdout: "pipe",
      stderr: "ignore",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(Number(stdout.trim())).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  }
}, 30_000);
