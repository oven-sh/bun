import { spawn } from "bun";
import { fileSinkInternals } from "bun:internal-for-testing";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isASAN } from "harness";

describe("spawn stdin ReadableStream", () => {
  test("basic ReadableStream as stdin", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("hello from stream");
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
    expect(text).toBe("hello from stream");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with multiple chunks", async () => {
    const chunks = ["chunk1\n", "chunk2\n", "chunk3\n"];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
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
    expect(text).toBe(chunks.join(""));
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with Uint8Array chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("binary "));
        controller.enqueue(encoder.encode("data "));
        controller.enqueue(encoder.encode("stream"));
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
    expect(text).toBe("binary data stream");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with delays between chunks", async () => {
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue("first\n");
        await Bun.sleep(50);
        controller.enqueue("second\n");
        await Bun.sleep(50);
        controller.enqueue("third\n");
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
    expect(text).toBe("first\nsecond\nthird\n");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with pull method", async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount <= 3) {
          controller.enqueue(`pull ${pullCount}\n`);
        } else {
          controller.close();
        }
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("pull 1\npull 2\npull 3\n");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with async pull and delays", async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        pullCount++;
        if (pullCount <= 3) {
          await Bun.sleep(30);
          controller.enqueue(`async pull ${pullCount}\n`);
        } else {
          controller.close();
        }
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("async pull 1\nasync pull 2\nasync pull 3\n");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with large data", async () => {
    const largeData = "x".repeat(1024 * 1024); // 1MB
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(largeData);
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
    expect(text).toBe(largeData);
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with very large chunked data", async () => {
    const chunkSize = 64 * 1024; // 64KB chunks
    const numChunks = 16; // 1MB total
    let pushedChunks = 0;
    const chunk = Buffer.alloc(chunkSize, "x");

    const stream = new ReadableStream({
      pull(controller) {
        if (pushedChunks < numChunks) {
          controller.enqueue(chunk);
          pushedChunks++;
        } else {
          controller.close();
        }
      },
    });

    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let length = 0;
        process.stdin.on('data', (data) => length += data.length);
        process.once('beforeExit', () => console.error(length));
        process.stdin.pipe(process.stdout)
`,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text.length).toBe(chunkSize * numChunks);
    expect(text).toBe(chunk.toString().repeat(numChunks));
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream cancellation when process exits early", async () => {
    let chunksEnqueued = 0;
    const { promise: cancelled, resolve: onCancel } = Promise.withResolvers<void>();

    const stream = new ReadableStream({
      async pull(controller) {
        // Keep enqueueing data slowly
        await Bun.sleep(50);
        chunksEnqueued++;
        controller.enqueue(`chunk ${chunksEnqueued}\n`);
      },
      cancel(_reason) {
        onCancel();
      },
    });

    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const readline = require('readline');
         const rl = readline.createInterface({
           input: process.stdin,
           output: process.stdout,
           terminal: false
         });
         let lines = 0;
         rl.on('line', (line) => {
           console.log(line);
           lines++;
           if (lines >= 2) process.exit(0);
         });`,
      ],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const [text] = await Promise.all([proc.stdout.text(), proc.exited]);

    // The child is gone, so the sink is dead: the pump must cancel the source
    // instead of pulling it forever. Hangs (and fails) if cancel() never runs.
    await cancelled;

    expect(chunksEnqueued).toBeGreaterThanOrEqual(2);
    // The child exits after 2 lines.
    expect(text.trim().split("\n").length).toBe(2);
  });

  test("ReadableStream error handling", async () => {
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue("before error\n");
        // Give time for the data to be consumed
        await Bun.sleep(10);
        controller.error(new Error("Stream error"));
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    // Process should receive data before the error
    expect(text).toBe("before error\n");

    // Process should exit normally (the stream error happens after data is sent)
    expect(await proc.exited).toBe(0);
  });

  test("erroring the stdin ReadableStream does not surface an unhandled rejection", async () => {
    // Regression: once ReadableStream locked-state detection works, the FileSink
    // teardown's stream.cancel() reaches readableStreamCancel, which returns a
    // rejected promise for an already-errored stream. That promise must be marked
    // handled, otherwise the stored error surfaces as an uncaught rejection in the
    // parent process. Run it in a child so a stray rejection lands on its stderr.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let uncaught = 0;
        process.on("unhandledRejection", () => { uncaught++; });
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue("hi\\n");
            await Bun.sleep(10);
            controller.error(new Error("stdin stream boom"));
          },
        });
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
          stdin: stream,
          stdout: "ignore",
        });
        await child.exited;
        await Bun.sleep(50);
        console.log("uncaught=" + uncaught);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("stdin stream boom");
    expect(stdout.trim()).toBe("uncaught=0");
    expect(exitCode).toBe(0);
  });

  // The ReadableStream -> stdin FileSink pump intentionally does not await the
  // Promise FileSink.write() returns for writes it cannot complete synchronously
  // (a full pipe on POSIX, every pipe write on Windows). When the child dies
  // while one is in flight, the sink rejects that Promise with EPIPE; the pump
  // must mark it handled or it surfaces as an unhandled rejection in the parent.
  // Run in a child process so a stray rejection lands on its counter.
  async function expectNoUnhandledRejectionWhenChildDies(useIterator: boolean) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let uncaught = 0;
        process.on("unhandledRejection", () => { uncaught++; });
        process.on("exit", () => console.log("uncaught=" + uncaught));

        const chunk = Buffer.alloc(256 * 1024, "x");
        async function* iterate(producedOne) {
          while (true) {
            await Bun.sleep(0);
            producedOne();
            yield chunk;
          }
        }
        function readable(producedOne) {
          return new ReadableStream({
            async pull(controller) {
              await Bun.sleep(0);
              producedOne();
              controller.enqueue(chunk);
            },
          });
        }

        // The child never reads its stdin, so the first 256 KiB write fills the
        // pipe, gets EAGAIN on the rest, and leaves the sink holding an in-flight
        // write. The pump parks right there, so no further chunk is ever produced:
        // kill on the first one, from a macrotask, which runs after the microtask
        // that issued the write. How far the pump gets before the parent notices
        // the death varies, so run several rounds.
        function round() {
          let produced = 0;
          const child = Bun.spawn({
            cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e9)"],
            stdin: (${useIterator} ? iterate : readable)(() => {
              if (++produced === 1) setTimeout(() => child.kill(), 0);
            }),
            stdout: "ignore",
            stderr: "ignore",
          });
          return child.exited;
        }
        await Promise.all(Array.from({ length: 8 }, round));

        // Unhandled rejections are only reported after a microtask drain; give
        // the tracker a turn so rejections from the last exits are counted.
        await Bun.sleep(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("EPIPE");
    expect(stdout.trim()).toBe("uncaught=0");
    expect(exitCode).toBe(0);
  }

  test("in-flight write when the child dies does not surface an unhandled rejection", async () => {
    await expectNoUnhandledRejectionWhenChildDies(false);
  });

  test("in-flight write from an async iterator stdin when the child dies does not surface an unhandled rejection", async () => {
    await expectNoUnhandledRejectionWhenChildDies(true);
  });

  // When the child dies mid-write the sink's close path must tear down the
  // ReadableStream feeding it (for an async iterable, return the generator),
  // or the still-running pull keeps the parent's event loop alive forever.
  // On Windows the libuv write-error path skipped that close notification.
  // https://github.com/oven-sh/bun/issues/33020
  async function expectParentExitsAfterChildDies(useIterator: boolean) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const chunk = Buffer.alloc(256 * 1024, "x");
        let produced = 0;
        function producedOne() {
          // The pump parks on the first refused write, so no second chunk is ever
          // produced. Kill from a macrotask, which runs after the microtask that
          // issued the write, so the sink is holding it when the child dies.
          if (++produced === 1) setTimeout(() => child.kill(), 0);
        }
        async function* iterate() {
          while (true) {
            await Bun.sleep(1);
            producedOne();
            yield chunk;
          }
        }
        function readable() {
          return new ReadableStream({
            async pull(controller) {
              await Bun.sleep(1);
              producedOne();
              controller.enqueue(chunk);
            },
          });
        }

        // The child never reads its stdin, so a 256 KiB write can never finish
        // and the sink holds an in-flight write when the child is killed.
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e9)"],
          stdin: (${useIterator} ? iterate : readable)(),
          stdout: "ignore",
          stderr: "ignore",
        });

        await child.exited;
        console.log("child exited");
        // No process.exit(): the point is that the event loop drains on its own.
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("EPIPE");
    expect(stdout.trim()).toBe("child exited");
    // The parent reached the natural end of its event loop; it was not killed.
    expect(proc.signalCode).toBe(null);
    expect(exitCode).toBe(0);
  }

  test("parent exits after the child dies when stdin is an async iterable", async () => {
    await expectParentExitsAfterChildDies(true);
  });

  test("parent exits after the child dies when stdin is a ReadableStream", async () => {
    await expectParentExitsAfterChildDies(false);
  });

  // The sink reports backpressure to the pump with a negative `write()` return,
  // a sentinel only the pump understands. That is safe because a sink fed by a
  // ReadableStream has no JS handle: spawn caches `proc.stdin` as the stream
  // itself. If that ever changes, the sentinel reaches user code instead.
  test("proc.stdin is the stream, not a writable sink, when stdin is a ReadableStream", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue("x");
        controller.close();
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.resume()"],
      stdin: stream,
      stdout: "ignore",
      env: bunEnv,
    });

    expect(proc.stdin).toBe(stream);
    expect((proc.stdin as any).write).toBeUndefined();
    expect(await proc.exited).toBe(0);
  });

  // A synchronous pull() re-fills the stream's queue inside the pump's own
  // microtask loop, so nothing but the sink refusing more data can stop it.
  // Both fixtures bail out of pull() past a generous bound so they terminate
  // instead of buffering the whole stream into memory.
  const syncPullSource = (bound: number) => /* js */ `
    const chunk = Buffer.alloc(64 * 1024, "x");
    let pulls = 0;
    const source = {
      pull(controller) {
        if (++pulls > ${bound}) {
          console.log("pull() was never bounded by backpressure");
          process.exit(1);
        }
        controller.enqueue(chunk);
      },
    };
  `;

  // Chunks larger than the pipe make the kernel refuse every write, so the pump
  // parks on `sink.flush(true)` and resumes once per chunk. Resolving that promise
  // re-enters JS from inside the sink's write-completion handler, which is where a
  // stale "buffer is drained" snapshot once closed the pipe on top of bytes that
  // had just been buffered. None of that may cost the child a byte.
  test("a child behind backpressure still receives every byte", async () => {
    const chunkSize = 256 * 1024;
    const numChunks = 5;
    const chunk = Buffer.alloc(chunkSize, "x");

    // Where the final resume lands varies; a few rounds is enough to pin it.
    for (let round = 0; round < 3; round++) {
      let pushed = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (pushed < numChunks) {
            controller.enqueue(chunk);
            pushed++;
          } else {
            controller.close();
          }
        },
      });

      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `let n = 0;
           process.stdin.on("data", d => (n += d.length));
           process.on("beforeExit", () => console.log(n));`,
        ],
        stdin: stream,
        stdout: "pipe",
        env: bunEnv,
      });

      const received = parseInt(await proc.stdout.text());
      expect({ round, received, exitCode: await proc.exited }).toEqual({
        round,
        received: chunkSize * numChunks,
        exitCode: 0,
      });
    }
  });

  test("a synchronous pull() does not starve the event loop", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        ${syncPullSource(512)}

        // Never reads its stdin, so the pipe fills and the sink must push back.
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e9)"],
          stdin: new ReadableStream(source),
          stdout: "ignore",
          stderr: "ignore",
        });

        let ticks = 0;
        const timer = setInterval(() => {
          if (++ticks < 3) return;
          clearInterval(timer);
          child.kill();
        }, 1);

        await child.exited;
        console.log("ticks=" + ticks);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ticks=3", exitCode: 0 });
    expect(stderr).not.toContain("EPIPE");
  });

  test("a synchronous pull() stops and cancels the source when the child exits early", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        ${syncPullSource(512)}
        const { promise: cancelled, resolve: onCancel } = Promise.withResolvers();
        source.cancel = () => onCancel();

        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "process.stdin.once('data', () => process.exit(0))"],
          stdin: new ReadableStream(source),
          stdout: "ignore",
          stderr: "ignore",
        });

        console.log("exited=" + (await child.exited));
        // The sink is dead, so the pump must cancel the source rather than pull
        // it forever. Hangs (and fails) if cancel() never runs.
        await cancelled;
        console.log("cancelled");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "exited=0\ncancelled", exitCode: 0 });
    expect(stderr).not.toContain("EPIPE");
  });

  test("ReadableStream with process that exits immediately", async () => {
    const stream = new ReadableStream({
      start(controller) {
        // Enqueue a lot of data
        for (let i = 0; i < 1000; i++) {
          controller.enqueue(`line ${i}\n`);
        }
        controller.close();
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.exit(0)"], // exits immediately
      stdin: stream,
      env: bunEnv,
    });

    expect(await proc.exited).toBe(0);

    // Give time for any pending operations
    await Bun.sleep(50);

    // The stream might be cancelled since the process exits before reading
    // This is implementation-dependent behavior
  });

  test("ReadableStream with process that fails", async () => {
    const stream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(0);
        controller.enqueue("data for failing process\n");
        controller.close();
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.exit(1)"],
      stdin: stream,
      env: bunEnv,
    });

    expect(await proc.exited).toBe(1);
  });

  test("already disturbed ReadableStream throws error", async () => {
    const stream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(0);
        controller.enqueue("data");
        controller.close();
      },
    });

    // Disturb the stream by reading from it
    const reader = stream.getReader();
    await reader.read();
    reader.releaseLock();

    expect(() => {
      const proc = spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stream,
        env: bunEnv,
      });
    }).toThrow("'stdin' ReadableStream has already been used");
  });

  test("ReadableStream with abort signal calls cancel", async () => {
    const controller = new AbortController();
    const cancel = mock();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("data before abort\n");
      },
      async pull(controller) {
        // Keep the stream open
        // but don't block the event loop.
        await Bun.sleep(1);
        controller.enqueue("more data\n");
      },
      cancel,
    });
    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      signal: controller.signal,
      env: bunEnv,
    });

    // Give it some time to start
    await Bun.sleep(10);

    // Abort the process
    controller.abort();

    try {
      await proc.exited;
    } catch (e) {
      // Process was aborted
    }

    // The process should have been killed
    expect(proc.killed).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("ReadableStream with backpressure", async () => {
    let pullCalls = 0;
    const maxChunks = 5;

    const stream = new ReadableStream({
      async pull(controller) {
        pullCalls++;
        if (pullCalls <= maxChunks) {
          // Add async to prevent optimization to blob
          await Bun.sleep(0);
          controller.enqueue(`chunk ${pullCalls}\n`);
        } else {
          controller.close();
        }
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    await proc.exited;

    // The pull method should have been called multiple times
    expect(pullCalls).toBeGreaterThan(1);
    expect(pullCalls).toBeLessThanOrEqual(maxChunks + 1); // +1 for the close pull
    expect(text).toContain("chunk 1\n");
    expect(text).toContain(`chunk ${maxChunks}\n`);
  });

  test("ReadableStream with multiple processes", async () => {
    const stream1 = new ReadableStream({
      start(controller) {
        controller.enqueue("stream1 data");
        controller.close();
      },
    });

    const stream2 = new ReadableStream({
      start(controller) {
        controller.enqueue("stream2 data");
        controller.close();
      },
    });

    await using proc1 = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream1,
      stdout: "pipe",
      env: bunEnv,
    });

    await using proc2 = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream2,
      stdout: "pipe",
      env: bunEnv,
    });

    const [text1, text2] = await Promise.all([new Response(proc1.stdout).text(), new Response(proc2.stdout).text()]);

    expect(text1).toBe("stream1 data");
    expect(text2).toBe("stream2 data");
    expect(await proc1.exited).toBe(0);
    expect(await proc2.exited).toBe(0);
  });

  test("ReadableStream with empty stream", async () => {
    const stream = new ReadableStream({
      start(controller) {
        // Close immediately without enqueueing anything
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
    expect(text).toBe("");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with null bytes", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([72, 101, 108, 108, 111, 0, 87, 111, 114, 108, 100])); // "Hello\0World"
        controller.close();
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const buffer = await new Response(proc.stdout).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    expect(bytes).toEqual(new Uint8Array([72, 101, 108, 108, 111, 0, 87, 111, 114, 108, 100]));
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with transform stream", async () => {
    // Create a transform stream that uppercases text
    const upperCaseTransform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      },
    });

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue("hello ");
        controller.enqueue("world");
        controller.close();
      },
    });

    const transformedStream = originalStream.pipeThrough(upperCaseTransform);

    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: transformedStream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    expect(text).toBe("HELLO WORLD");
    expect(await proc.exited).toBe(0);
  });

  test("ReadableStream with tee", async () => {
    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue("shared data");
        controller.close();
      },
    });

    const [stream1, stream2] = originalStream.tee();

    // Use the first branch for the process
    await using proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream1,
      stdout: "pipe",
      env: bunEnv,
    });

    // Read from the second branch independently
    const text2 = await new Response(stream2).text();

    const text1 = await proc.stdout.text();
    expect(text1).toBe("shared data");
    expect(text2).toBe("shared data");
    expect(await proc.exited).toBe(0);
  });

  // The native-sink pump's finally step clears the consumed tee branch's controller slot;
  // a tee reaction queued for the source's later error/close must skip that branch instead
  // of RELEASE_ASSERT'ing on the mismatched controller kind.
  test.each([
    { streamType: "bytes", finish: "error", result: "rejected upstream failed" },
    { streamType: "bytes", finish: "close", result: "resolved done=true" },
    { streamType: "default", finish: "error", result: "rejected upstream failed" },
  ] as const)(
    "tee()d $streamType stream: source $finish after stdin consumer exits does not crash",
    async ({ streamType, finish, result }) => {
      const script = `
        let ctrl;
        const src = new ReadableStream({
          ${streamType === "bytes" ? 'type: "bytes",' : ""}
          start(c) { ctrl = c; },
        });
        const [a, b] = src.tee();
        const bRead = b.getReader().read();
        bRead.catch(() => {});
        const child = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdin: a, stdout: "ignore", stderr: "ignore" });
        await child.exited;
        ${finish === "error" ? 'ctrl.error(new Error("upstream failed"));' : "ctrl.close();"}
        const settled = await bRead.then(
          v => "resolved done=" + v.done,
          e => "rejected " + e.message,
        );
        console.log("SURVIVED", ${JSON.stringify(streamType)}, ${JSON.stringify(finish)}, settled);
      `;

      await using proc = spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: `SURVIVED ${streamType} ${finish} ${result}`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  test("ReadableStream object type count", async () => {
    const iterations = isASAN
      ? // With ASAN, entire process gets killed. Likely an OOM or out of file
        // descriptors. 50 concurrent ASAN subprocesses also overrun the
        // per-test timeout.
        10
      : 50;

    async function main() {
      async function iterate(i: number) {
        const stream = new ReadableStream({
          async pull(controller) {
            await Bun.sleep(0);
            controller.enqueue(`iteration ${i}`);
            controller.close();
          },
        });

        await using proc = spawn({
          cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
          stdin: stream,
          stdout: "pipe",
          stderr: "inherit",
          env: bunEnv,
        });

        await Promise.all([proc.stdout.text(), proc.exited]);
      }

      const promises = Array.from({ length: iterations }, (_, i) => iterate(i));
      await Promise.all(promises);
    }

    await main();

    await Bun.sleep(1);
    Bun.gc(true);
    await Bun.sleep(1);

    // Check that we're not leaking objects
    await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
    await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  });

  // Regression: src/runtime/api/bun/subprocess/Writable.zig:115/193
  // (`pipe.assignToStream(...)`) — Zig's `FileSink.create` returns rc=1 which is
  // *transferred* into `Writable{ .pipe = pipe }`; `assignToStream` itself is
  // ref-neutral (`ref(); defer deref()`). A port that takes an extra +1 inside
  // `assign_to_stream` (and/or in `to_js`) leaves the native FileSink at rc>=1
  // even after the stream completes, the Subprocess is finalized, and all JS
  // wrappers are GC'd — leaking the IOWriter buffers and fd for the life of the
  // process. `heapStats()` only counts JS wrappers, so the test above does not
  // catch this; we must check the native live counter directly.
  // TODO(zig-rust-divergence): Rust port leaks one FileSink per spawn here;
  // see docs/ZIG_RUST_DIVERGENCE_AUDIT.md.
  test.todo("does not leak native FileSink when ReadableStream is used as stdin", async () => {
    async function once(i: number) {
      const stream = new ReadableStream({
        async pull(controller) {
          await Bun.sleep(0);
          controller.enqueue(`iteration ${i}`);
          controller.close();
        },
      });

      const proc = spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stream,
        stdout: "pipe",
        stderr: "ignore",
        env: bunEnv,
      });

      // Touch `.stdin` so `Writable.toJS` runs (the path that creates the JS
      // wrapper around the already-stored pipe).
      void proc.stdin;

      const [text] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(text).toBe(`iteration ${i}`);
    }

    // Warm up so any lazily-created sinks (and their JS wrappers) are present
    // in the baseline.
    await once(-1);
    Bun.gc(true);
    await Bun.sleep(1);

    const baseline = fileSinkInternals.liveCount();
    const iterations = 8;

    for (let i = 0; i < iterations; i++) {
      await once(i);
    }

    // Allow controller/sink JS wrappers to be collected so their finalizers
    // release the refs they legitimately hold.
    for (let i = 0; i < 50; i++) {
      Bun.gc(true);
      if (fileSinkInternals.liveCount() <= baseline + 1) break;
      await Bun.sleep(10);
    }

    // With correct ref-transfer semantics every native FileSink reaches rc=0
    // and is freed once GC reclaims the wrappers. With an over-ref, every
    // iteration leaks one native FileSink (delta == iterations). Allow one
    // straggler whose wrapper has not yet been finalized.
    expect(fileSinkInternals.liveCount()).toBeLessThanOrEqual(baseline + 1);
  });
});
