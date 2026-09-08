/**
 * Edge case tests for spawn with ReadableStream stdin.
 *
 * **IMPORTANT**: Many of these tests use `await` in ReadableStream constructors
 * (e.g., `await Bun.sleep(0)`, `await 42`) to prevent Bun from optimizing
 * the ReadableStream into a Blob. When a ReadableStream is synchronous and
 * contains only string/buffer data, Bun may normalize it to a Blob for
 * performance reasons. The `await` ensures the stream remains truly streaming
 * and tests the actual ReadableStream code paths in spawn.
 */

import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { readdirSync } from "node:fs";

describe("spawn stdin ReadableStream edge cases", () => {
  test("ReadableStream with exception in pull", async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue("chunk 1\n");
        } else if (pullCount === 2) {
          controller.enqueue("chunk 2\n");
          throw new Error("Pull error");
        }
      },
    });

    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    // Should receive data before the exception
    expect(text).toContain("chunk 1\n");
    expect(text).toContain("chunk 2\n");
  });

  test("ReadableStream writing after process closed", async () => {
    let writeAttempts = 0;
    let errorOccurred = false;

    const stream = new ReadableStream({
      async pull(controller) {
        writeAttempts++;
        if (writeAttempts <= 10) {
          await Bun.sleep(100);
          try {
            controller.enqueue(`attempt ${writeAttempts}\n`);
          } catch (e) {
            errorOccurred = true;
            throw e;
          }
        } else {
          controller.close();
        }
      },
    });

    // Use a command that exits quickly after reading one line
    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const readline = require('readline');
         const rl = readline.createInterface({
           input: process.stdin,
           output: process.stdout,
           terminal: false
         });
         rl.on('line', (line) => {
           console.log(line);
           process.exit(0);
         });`,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    await proc.exited;

    // Give time for more pull attempts
    await Bun.sleep(500);

    // The stream should have attempted multiple writes but only the first succeeded
    expect(writeAttempts).toBeGreaterThanOrEqual(1);
    expect(text).toBe("attempt 1\n");
  });

  test("ReadableStream with mixed types", async () => {
    const stream = new ReadableStream({
      start(controller) {
        // String
        controller.enqueue("text ");
        // Uint8Array
        controller.enqueue(new TextEncoder().encode("binary "));
        // ArrayBuffer
        const buffer = new ArrayBuffer(5);
        const view = new Uint8Array(buffer);
        view.set([100, 97, 116, 97, 32]); // "data "
        controller.enqueue(buffer);
        // Another string
        controller.enqueue("end");
        controller.close();
      },
    });

    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("text binary data end");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with process consuming data slowly", async () => {
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) {
      chunks.push(`chunk ${i}\n`);
    }

    let currentChunk = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (currentChunk < chunks.length) {
          controller.enqueue(chunks[currentChunk]);
          currentChunk++;
        } else {
          controller.close();
        }
      },
    });

    // Use a script that reads slowly
    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: false
        });
        
        rl.on('line', async (line) => {
          await Bun.sleep(10);
          console.log(line);
        });
      `,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(lines[i]).toBe(`chunk ${i}`);
    }
    expect(await proc.exited).toBe(0);
  });

  test.todo("ReadableStream with cancel callback verification", async () => {
    let cancelReason: any = null;
    let cancelCalled = false;

    const stream = new ReadableStream({
      start(controller) {
        // Start sending data
        let count = 0;
        const interval = setInterval(() => {
          count++;
          try {
            controller.enqueue(`data ${count}\n`);
          } catch (e) {
            clearInterval(interval);
          }
        }, 50);

        // Store interval for cleanup
        (controller as any).interval = interval;
      },
      cancel(reason) {
        cancelCalled = true;
        cancelReason = reason;
        // Clean up interval if exists
        if ((this as any).interval) {
          clearInterval((this as any).interval);
        }
      },
    });

    // Kill the process after some data
    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    // Wait a bit then kill
    await Bun.sleep(150);
    proc.kill();

    try {
      await proc.exited;
    } catch (e) {
      // Expected - process was killed
    }

    // Give time for cancel to be called
    await Bun.sleep(50);

    expect(cancelCalled).toBe(true);
  });

  test("ReadableStream with high frequency small chunks", async () => {
    const totalChunks = 1000;
    let sentChunks = 0;

    const stream = new ReadableStream({
      pull(controller) {
        // Send multiple small chunks per pull
        for (let i = 0; i < 10 && sentChunks < totalChunks; i++) {
          controller.enqueue(`${sentChunks}\n`);
          sentChunks++;
        }

        if (sentChunks >= totalChunks) {
          controller.close();
        }
      },
    });

    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `let count = 0;
         const readline = require('readline');
         const rl = readline.createInterface({
           input: process.stdin,
           output: process.stdout,
           terminal: false
         });
         rl.on('line', () => count++);
         rl.on('close', () => console.log(count));`,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(parseInt(text.trim())).toBe(totalChunks);
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with several pulls", async () => {
    let pullCount = 0;

    const stream = new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount <= 5) {
          // Enqueue data larger than high water mark
          controller.enqueue(Buffer.alloc(1024, "x"));
        } else {
          controller.close();
        }
      },
    });

    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("x".repeat(1024 * 5));
    expect(await proc.exited).toBe(0);

    // TODO: this is not quite right. But it's still godo to have
    expect(pullCount).toBe(6);
  });

  test("ReadableStream reuse prevention", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("test data");
        controller.close();
      },
    });

    // First use
    const proc1 = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text1 = await new Response(proc1.stdout).text();
    expect(text1).toBe("test data");
    expect(await proc1.exited).toBe(0);

    // Second use should fail
    expect(() => {
      spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stream,
        env: bunEnv,
      });
    }).toThrow();
  });

  test("ReadableStream errored in start() throws its reason from spawn", () => {
    const reason = new Error("boom");
    const stream = new ReadableStream({
      start(controller) {
        controller.error(reason);
      },
    });

    expect(() => {
      spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stream,
        env: bunEnv,
      });
    }).toThrow(reason);
  });

  test("ReadableStream with a non-byte chunk throws from spawn", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2));
        controller.enqueue(42);
        controller.close();
      },
    });

    expect(() => {
      spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stream,
        env: bunEnv,
      });
    }).toThrow("write() expects a string, ArrayBufferView, or ArrayBuffer");
  });

  test("a stdin stream that fails before spawn returns never reaches the unhandled rejection handler", async () => {
    const script = `
      const makers = {
        locked() {
          const s = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3)); c.close(); } });
          s.getReader();
          return s;
        },
        errored() {
          return new ReadableStream({ start(c) { c.error(new Error("boom")); } });
        },
        badChunk() {
          return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2)); c.enqueue(42); c.close(); } });
        },
      };
      for (const [name, make] of Object.entries(makers)) {
        try {
          Bun.spawn({ cmd: [process.execPath, "-e", "process.stdin.resume()"], stdin: make(), stdout: "ignore", stderr: "ignore" });
          console.log(name, "did not throw");
        } catch (e) {
          console.log(name, "caught", e.message.includes("locked") ? "locked" : e.message);
        }
      }
    `;
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      [
        "locked caught locked",
        "errored caught boom",
        "badChunk caught write() expects a string, ArrayBufferView, or ArrayBuffer",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A locked stream is rejected before the child is forked (covered in
  // spawn-stdin-readable-stream.test.ts). These fail inside the pump, after the fork.
  const failingStdinStreams = {
    "errored in start()": {
      make() {
        return new ReadableStream({
          start(controller) {
            controller.error(new Error("start boom"));
          },
        });
      },
      message: "start boom",
    },
    "non-byte chunk": {
      make() {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2));
            controller.enqueue(42);
            controller.close();
          },
        });
      },
      message: "write() expects a string, ArrayBufferView, or ArrayBuffer",
    },
    "direct stream whose pull throws": {
      make() {
        return new ReadableStream({
          type: "direct",
          pull() {
            throw new Error("direct boom");
          },
        });
      },
      message: "direct boom",
    },
  };

  test.skipIf(isWindows).each(Object.entries(failingStdinStreams))(
    "a spawn that throws on its stdin stream (%s) kills and reaps the child",
    async (_name, { make, message }) => {
      let onExitCalls = 0;

      expect(() => {
        spawn({
          cmd: ["sleep", "5"],
          stdin: make(),
          stdout: "ignore",
          stderr: "ignore",
          onExit() {
            onExitCalls++;
          },
        });
      }).toThrow(message);

      const listChildren = () =>
        Bun.spawnSync(["ps", "-ax", "-o", "pid=,ppid=,stat=,comm="])
          .stdout.toString()
          .split("\n")
          .map(line => line.trim().split(/\s+/))
          // Linux prints the basename, macOS the executable path.
          .filter(([, ppid, , comm]) => ppid === String(process.pid) && (comm === "sleep" || comm?.endsWith("/sleep")));

      const deadline = Date.now() + 2000;
      let children = listChildren();
      while (children.length > 0 && Date.now() < deadline) {
        await Bun.sleep(20);
        children = listChildren();
      }
      expect(children).toEqual([]);
      expect(onExitCalls).toBe(0);
    },
  );

  test.skipIf(!isLinux)("a spawn that throws on its stdin stream does not leak 'socket-fd' descriptors", async () => {
    const countFds = () => readdirSync("/proc/self/fd").length;
    const before = countFds();

    for (let i = 0; i < 8; i++) {
      expect(() => {
        spawn({
          cmd: ["sleep", "5"],
          stdio: [failingStdinStreams["non-byte chunk"].make(), "ignore", "ignore", "socket-fd"],
        });
      }).toThrow("write() expects a string, ArrayBufferView, or ArrayBuffer");
    }

    // The parent-side socket closes when the unreachable Subprocess is collected after the child exits.
    const deadline = Date.now() + 5000;
    let after = countFds();
    while (after > before && Date.now() < deadline) {
      Bun.gc(true);
      await Bun.sleep(20);
      after = countFds();
    }
    expect(after).toBeLessThanOrEqual(before);
  });

  test("ReadableStream with byte stream", async () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }

    const stream = new ReadableStream({
      type: "bytes",
      start(controller) {
        // Enqueue as byte chunks
        controller.enqueue(data.slice(0, 128));
        controller.enqueue(data.slice(128, 256));
        controller.close();
      },
    });

    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const buffer = await new Response(proc.stdout).arrayBuffer();
    const result = new Uint8Array(buffer);
    expect(result).toEqual(data);
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with stdin and other pipes", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("stdin data");
        controller.close();
      },
    });

    // Create a script that also writes to stdout and stderr
    const script = `
      process.stdin.on('data', (data) => {
        process.stdout.write('stdout: ' + data);
        process.stderr.write('stderr: ' + data);
      });
    `;

    const proc = spawn({
      cmd: [bunExe(), "-e", script],
      stdin: stream,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

    expect(stdout).toBe("stdout: stdin data");
    expect(stderr).toBe("stderr: stdin data");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with very long single chunk", async () => {
    // Create a chunk larger than typical pipe buffer (64KB on most systems)
    const size = 256 * 1024; // 256KB
    const chunk = "a".repeat(size);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `let count = 0;
         process.stdin.on('data', (chunk) => count += chunk.length);
         process.stdin.on('end', () => console.log(count));`,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(parseInt(text.trim())).toBe(size);
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with alternating data types", async () => {
    const stream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(0);

        // Alternate between strings and Uint8Arrays
        controller.enqueue("string1 ");
        controller.enqueue(new TextEncoder().encode("binary1 "));
        controller.enqueue("string2 ");
        controller.enqueue(new TextEncoder().encode("binary2"));
        controller.close();
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("string1 binary1 string2 binary2");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with spawn options variations", async () => {
    // Test with different spawn configurations
    const configs = [
      { stdout: "pipe", stderr: "ignore" },
      { stdout: "pipe", stderr: "pipe" },
      { stdout: "pipe", stderr: "inherit" },
    ];

    // Run the configs at once: three sequential debug-build children do not fit the per-test budget.
    const results = await Promise.all(
      configs.map(async config => {
        const stream = new ReadableStream({
          async pull(controller) {
            await Bun.sleep(0);
            controller.enqueue("test input");
            controller.close();
          },
        });

        const proc = spawn({
          cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
          stdin: stream,
          ...config,
          env: bunEnv,
        });

        return [await proc.stdout.text(), await proc.exited];
      }),
    );
    expect(results).toEqual(configs.map(() => ["test input", 0]));
  });
});
