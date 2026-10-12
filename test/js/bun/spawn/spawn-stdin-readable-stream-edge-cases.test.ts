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
import { bunEnv, bunExe, isLinux } from "harness";

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
    ] as const;

    for (const config of configs) {
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

      const stdout = await proc.stdout.text();
      expect(stdout).toBe("test input");
      expect(await proc.exited).toBe(0);
    }
  });

  // A direct stream is pulled from while Bun.spawn attaches it, which is after the child was started. The call then
  // fails with a child nobody was handed, which kept running.
  test("a direct ReadableStream whose pull() throws inside Bun.spawn ends the child", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          Bun.spawn({
            cmd: [process.execPath, "-e", "setTimeout(() => {}, 30_000)"],
            stdin: new ReadableStream({ type: "direct", pull() { throw new Error("from pull"); } }),
            stdout: "ignore",
            stderr: "inherit",
          });
        } catch (e) {
          console.log(e.message);
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The child holds stderr as well, so that only ends once both are gone.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "from pull", stderr: "", exitCode: 0 });
  });

  // Nor is it a zombie. In the second case its pipes and its pidfd stayed open too.
  describe.skipIf(!isLinux)("a direct ReadableStream that fails inside Bun.spawn leaves nothing behind", () => {
    const spawnWith = (pull: string) => /* js */ `
      Bun.spawn({
        cmd: ["sleep", "1000"],
        stdin: new ReadableStream({ type: "direct", pull() { ${pull} } }),
        stdout: "pipe",
        stderr: "pipe",
      });
    `;
    const prelude = /* js */ `
      import { readdirSync, readFileSync, readlinkSync } from "node:fs";
      // Those a child's stdio and pidfd are, and none of what a thread's event loop opens.
      const openFds = () =>
        readdirSync("/proc/self/fd").filter(fd => {
          try {
            return /^socket:|pidfd/.test(readlinkSync("/proc/self/fd/" + fd));
          } catch {
            return false;
          }
        }).length;
      const baseline = openFds();
      // Running or zombie. The kernel lists them per thread, and hands those of a thread that ends to another one,
      // unless it was built without CONFIG_PROC_CHILDREN. Then every process is asked for its parent, the field after
      // its parenthesized name and state.
      function children() {
        let pids;
        try {
          pids = readdirSync("/proc/self/task").flatMap(tid =>
            readFileSync("/proc/self/task/" + tid + "/children", "utf8").split(" ").filter(Boolean),
          );
        } catch {
          pids = readdirSync("/proc").filter(pid => {
            if (!/^\\d+$/.test(pid)) return false;
            try {
              const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
              return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1] === String(process.pid);
            } catch {
              return false;
            }
          });
        }
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {}
        }
        return pids.length;
      }
      // Some are closed on the work pool, or by a collection.
      async function leakedFds() {
        const deadline = performance.now() + 2000;
        while (openFds() > baseline && performance.now() < deadline) {
          Bun.gc(true);
          await Bun.sleep(5);
        }
        return openFds() - baseline;
      }
    `;

    async function run(code: string) {
      await using proc = spawn({ cmd: [bunExe(), "-e", prelude + code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    // Only an Error was taken for a failure. With anything else the call returned a Subprocess whose stdin never ended.
    test.concurrent.each([`new Error("from pull")`, `42`, `"from pull"`, `{ code: "E" }`])(
      "when pull() throws %s",
      async thrown => {
        const result = await run(/* js */ `
          const thrown = ${thrown};
          let caught;
          try {
            ${spawnWith(`throw thrown;`)}
          } catch (e) {
            caught = e === thrown;
          }
          console.log(JSON.stringify({ caught, children: children(), leakedFds: await leakedFds() }));
        `);
        expect(result).toEqual({
          stdout: JSON.stringify({ caught: true, children: 0, leakedFds: 0 }),
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test.concurrent("when pull() ends the worker", async () => {
      const result = await run(/* js */ `
        import { Worker } from "node:worker_threads";
        const worker = new Worker(${JSON.stringify(spawnWith(`process.exit(7);`))}, { eval: true });
        const workerExitCode = await new Promise(resolve => worker.on("exit", resolve));
        console.log(JSON.stringify({ workerExitCode, children: children(), leakedFds: await leakedFds() }));
      `);
      expect(result).toEqual({
        stdout: JSON.stringify({ workerExitCode: 7, children: 0, leakedFds: 0 }),
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
