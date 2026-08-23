import { spawn } from "bun";
import { fileSinkInternals } from "bun:internal-for-testing";
import { describe, expect, mock, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  emptyProcessMaxRSS,
  expectMaxObjectTypeCount,
  isASAN,
  isDebug,
  isWindows,
  runFixtureMaxRSS,
  tempDir,
} from "harness";
import path from "node:path";

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
    const { promise: cancelledPromise, resolve: onCancelled } = Promise.withResolvers<void>();
    let cancelled = false;
    let chunksEnqueued = 0;

    const stream = new ReadableStream({
      async pull(controller) {
        // Keep enqueueing data slowly
        await Bun.sleep(50);
        chunksEnqueued++;
        controller.enqueue(`chunk ${chunksEnqueued}\n`);
      },
      cancel(_reason) {
        cancelled = true;
        onCancelled();
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

    const text = await proc.stdout.text();
    await proc.exited;

    // Wait for the sink to propagate cancellation back to the source.
    await cancelledPromise;

    expect(cancelled).toBe(true);
    expect(chunksEnqueued).toBeGreaterThanOrEqual(2);
    // head -n 2 should only output 2 lines
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

        // The child never reads its stdin, so a 256 KiB write can never
        // finish and the sink always holds an in-flight write. The pump
        // suspends on backpressure after the first chunk; kill the child
        // once that write is in flight. Run several rounds to cover timing.
        function round() {
          let firstProduced;
          const onFirst = new Promise(r => { firstProduced = r; });
          const child = Bun.spawn({
            cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e9)"],
            stdin: (${useIterator} ? iterate : readable)(firstProduced),
            stdout: "ignore",
            stderr: "ignore",
          });
          return onFirst.then(() => { child.kill(); return child.exited; });
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
        let firstProduced;
        const onFirst = new Promise(r => { firstProduced = r; });
        async function* iterate() {
          while (true) {
            await Bun.sleep(1);
            firstProduced();
            yield chunk;
          }
        }
        function readable() {
          return new ReadableStream({
            async pull(controller) {
              await Bun.sleep(1);
              firstProduced();
              controller.enqueue(chunk);
            },
          });
        }

        // The child never reads its stdin, so a 256 KiB write can never
        // finish and the sink holds an in-flight write when the child is
        // killed (the pump suspends on backpressure after the first chunk).
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e9)"],
          stdin: (${useIterator} ? iterate : readable)(),
          stdout: "ignore",
          stderr: "ignore",
        });

        await onFirst;
        child.kill();
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

  test("does not leak native FileSink when ReadableStream is used as stdin", async () => {
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

    await Promise.all(Array.from({ length: iterations }, (_, i) => once(i)));

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

  // An HTMLRewriter body piped into a child's stdin is a native ByteStream →
  // FileSink pump with a synchronous producer: the FileSink's drain callback
  // resumes the ByteStream, which makes the rewriter feed the next file chunk
  // and, at EOF, end the sink, all before the drain callback returns. The
  // child reads slowly, so each chunk's output overfills the pipe and its
  // tail stays buffered in the sink when the sink is ended from inside that
  // callback. Every byte must still reach the child before its stdin closes:
  // the buffered tail, and whatever the document-end handler emits after the
  // last chunk's write reported backpressure.
  describe("HTMLRewriter body as stdin while the child reads slowly", () => {
    // Two file reads (256 KiB + the rest); each element's output grows by
    // `appended`, so each chunk's output is about 1 MiB, more than a stdin
    // pipe holds on any platform.
    const piece = `<p>${Buffer.alloc(8192, "a").toString()}</p>`;
    const count = 56;
    const input = Buffer.alloc(piece.length * count, piece).toString();
    const appended = Buffer.alloc(32 * 1024, "b").toString();
    const footer = "<!-- end -->";

    const slowChild = `
      const fs = require("node:fs");
      const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
      let total = 0;
      for (;;) {
        const n = fs.readSync(0, buf);
        if (n === 0) break;
        total += n;
        Bun.sleepSync(10);
      }
      process.stdout.write(String(total));
    `;

    test.each([
      ["no document-end output", false],
      ["output appended at document end", true],
    ])("every byte reaches the child: %s", async (_, appendAtEnd) => {
      using dir = tempDir("hr-stdin-slow-child", { "in.html": input });
      let rewriter = new HTMLRewriter().on("p", { element: e => void e.append(appended) });
      if (appendAtEnd) rewriter = rewriter.onDocument({ end: e => void e.append(footer, { html: true }) });
      const res = rewriter.transform(new Response(Bun.file(path.join(String(dir), "in.html"))));

      await using proc = spawn({
        cmd: [bunExe(), "-e", slowChild],
        env: bunEnv,
        stdin: res,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(Number(stdout)).toBe(input.length + count * appended.length + (appendAtEnd ? footer.length : 0));
      expect(exitCode).toBe(0);
    });
  });

  // A fetch response body piped into a child's stdin is a native ByteStream →
  // FileSink pump. While the child stalls before reading, the pipe fills and
  // the FileSink backpressures; that must pause the upstream response socket
  // instead of buffering the payload in-process. The child then drains all
  // of it, so the awaited condition is completion of the whole transfer.
  test("fetch response.body as stdin bounds memory while the child stalls", async () => {
    const fixture = `
      const net = require("node:net");
      const CHUNK = Buffer.alloc(64 * 1024, 0x47), COUNT = 2048; // 128 MB
      const source = net.createServer(sock => {
        sock.write("HTTP/1.1 200 OK\\r\\ncontent-length: " + CHUNK.length * COUNT + "\\r\\nconnection: close\\r\\n\\r\\n");
        let n = 0;
        const pump = () => { while (n < COUNT) { n++; if (!sock.write(CHUNK)) return sock.once("drain", pump); } sock.end(); };
        pump();
      });
      await new Promise(r => source.listen(0, "127.0.0.1", r));

      const up = await fetch(\`http://127.0.0.1:\${source.address().port}/\`);
      // Child stalls before reading, then drains stdin to EOF.
      const child = Bun.spawn({
        cmd: [
          ${JSON.stringify(bunExe())},
          "-e",
          "await Bun.sleep(500); let total = 0; for await (const c of process.stdin) total += c.length; console.log(total);",
        ],
        env: process.env,
        stdin: up.body,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [received, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      source.close();
      console.log(JSON.stringify({ received: Number(received), exitCode }));
      process.exit(0);
    `;
    const [fixtureMaxRSS, baselineMaxRSS] = await Promise.all([
      runFixtureMaxRSS(fixture, { received: 128 * 1024 * 1024, exitCode: 0 }),
      emptyProcessMaxRSS(),
    ]);
    // Without source-side backpressure the whole payload lands in the
    // pumping process while the child stalls.
    expect((fixtureMaxRSS - baselineMaxRSS) / 1024 / 1024).toBeLessThan(isASAN || isDebug ? 256 : 96);
  }, 20_000);

  // Same stalled-then-draining child, but the source is a JS pull() stream.
  // The readStreamIntoSink pump must suspend on the sink's backpressure
  // instead of pulling every chunk into memory while the child stalls.
  test("JS pull() source as stdin bounds memory while the child stalls", async () => {
    const fixture = `
      const CHUNK = Buffer.alloc(64 * 1024, 0x47), COUNT = 2048; // 128 MB
      let n = 0;
      const stdin = new ReadableStream({ pull(c) { if (n < COUNT) { n++; c.enqueue(CHUNK); } else c.close(); } });

      const child = Bun.spawn({
        cmd: [
          ${JSON.stringify(bunExe())},
          "-e",
          "await Bun.sleep(500); let total = 0; for await (const c of process.stdin) total += c.length; console.log(total);",
        ],
        env: process.env,
        stdin,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [received, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      console.log(JSON.stringify({ received: Number(received), exitCode }));
      process.exit(0);
    `;
    const [fixtureMaxRSS, baselineMaxRSS] = await Promise.all([
      runFixtureMaxRSS(fixture, { received: 128 * 1024 * 1024, exitCode: 0 }),
      emptyProcessMaxRSS(),
    ]);
    expect((fixtureMaxRSS - baselineMaxRSS) / 1024 / 1024).toBeLessThan(isASAN || isDebug ? 256 : 96);
  }, 20_000);

  // Handing a ReadableStream to a native sink (spawn stdin) must mark it
  // locked + disturbed so a second consumer errors instead of hanging.
  test("using a fetch response.body as stdin locks the stream", async () => {
    await using source = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({ pull: c => c.enqueue(new Uint8Array(64 * 1024)) })),
    });
    const res = await fetch(source.url);
    await using child = spawn({
      cmd: [bunExe(), "-e", "await Bun.sleep(60000)"],
      env: bunEnv,
      stdin: res.body!,
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(res.body!.locked).toBe(true);
    expect(res.bodyUsed).toBe(true);
    expect(() => res.body!.getReader()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));

    child.kill();
    await child.exited;
  });

  // for-await over a subprocess stderr pipe is pull-driven: when the consumer
  // stalls, the OS pipe fills and the child's write() blocks on drain, so the
  // child cannot race to completion while the reader is slow. The child reports
  // each stderr write's index on stdout (tiny, never fills its pipe); the parent
  // drains stdout concurrently and samples the child's progress while the
  // stderr reader is deliberately stalled.
  //
  // Windows: WindowsBufferedReader::on_read discards the on_read_chunk return
  // value, so FileReader's highwater mark never propagates to uv_read_stop and
  // the pipe drains at socket speed regardless of JS demand. Same limitation as
  // the process-stdin.test.ts "pipe backpressure" suite; skipped there too.
  test.skipIf(isWindows)("spawn stderr for-await applies backpressure to the writer", async () => {
    const chunkSize = 64 * 1024;
    const chunkCount = 128; // 8 MB — well above the OS pipe + ByteStream buffers
    const totalBytes = chunkSize * chunkCount;

    const writer = `
      const chunk = Buffer.alloc(${chunkSize}, 66);
      function write(i) {
        if (i >= ${chunkCount}) {
          process.stdout.write("done\\n");
          return;
        }
        process.stdout.write(i + "\\n");
        if (!process.stderr.write(chunk)) {
          process.stderr.once("drain", () => write(i + 1));
        } else {
          setImmediate(() => write(i + 1));
        }
      }
      write(0);
    `;

    await using proc = spawn({
      cmd: [bunExe(), "-e", writer],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    let writerProgress = 0;
    let writerDone = false;
    const stdoutDrain = (async () => {
      let buf = "";
      for await (const c of proc.stdout) {
        buf += Buffer.from(c).toString();
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (line === "done") writerDone = true;
          else if (line) writerProgress = parseInt(line) + 1;
        }
      }
    })();

    let received = 0;
    let progressWhileStalled = -1;
    let doneWhileStalled: boolean | null = null;
    for await (const chunk of proc.stderr) {
      received += chunk.length;
      // Once a quarter of the payload has arrived, stall the reader and sample
      // the writer's progress. With backpressure the writer is parked on drain;
      // without it, 8 MB of writes complete in well under 50 ms.
      if (progressWhileStalled < 0 && received >= totalBytes / 4) {
        await Bun.sleep(50);
        progressWhileStalled = writerProgress;
        doneWhileStalled = writerDone;
      }
      if (progressWhileStalled < 0) await Bun.sleep(10);
    }

    await stdoutDrain;
    const exitCode = await proc.exited;

    expect(received).toBe(totalBytes);
    expect(progressWhileStalled).toBeGreaterThan(0);
    expect(progressWhileStalled).toBeLessThan(chunkCount);
    expect(doneWhileStalled).toBe(false);
    expect(writerDone).toBe(true);
    expect(exitCode).toBe(0);
  });
  // A worker that goes away while a ReadableStream is still being pumped into
  // a subprocess's stdin FileSink — either terminated mid-pump or exiting on
  // its own with the pump backpressured —
  // must release every ref the sink holds (the JS pump's, the pending write's
  // keep-alive, the subprocess's) exactly once: no native sink outlives the
  // worker and nothing touches a freed one (ASAN).
  test("worker teardown with a pending ReadableStream pump frees the FileSink exactly once", async () => {
    using dir = tempDir("filesink-worker-teardown", {
      "main.js": /* js */ `
        const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");
        const { fileSinkInternals } = require("bun:internal-for-testing");
        if (!isMainThread) {
          const mode = workerData;
          let signalled = false;
          const signal = () => {
            if (!signalled) parentPort.postMessage("pumping");
            signalled = true;
          };
          // "idle": the pump's first pull never resolves. Otherwise: 1 MiB chunks
          // into a child that never reads, so a write goes pending.
          const stream = new ReadableStream({
            pull(c) {
              if (mode === "idle") {
                signal();
                return new Promise(() => {});
              }
              c.enqueue(new Uint8Array(1 << 20));
              signal();
            },
          });
          // A child that never reads stdin; short-lived, since a terminated
          // worker does not get to kill it.
          const proc = Bun.spawn({
            cmd: [process.execPath, "-e", "setTimeout(() => {}, 2000)"],
            env: process.env,
            stdin: stream,
            stdout: "ignore",
            stderr: "ignore",
          });
          void proc.stdin;
          process.on("exit", () => proc.kill());
          parentPort.on("message", () => process.exit(0));
        } else {
          const baseline = fileSinkInternals.liveCount();
          for (const mode of ["idle", "backpressure"]) {
            for (const how of ["terminate", "exit"]) {
              const w = new Worker(__filename, { workerData: mode });
              const failed = new Promise((_, reject) => {
                w.once("error", reject);
                w.once("exit", code => reject(new Error("worker exited early: " + code)));
              });
              await Promise.race([new Promise(resolve => w.once("message", resolve)), failed]);
              if (how === "terminate") await w.terminate();
              else {
                const exited = new Promise((resolve, reject) => {
                  w.removeAllListeners("exit");
                  w.once("exit", resolve);
                  w.once("error", reject);
                });
                w.postMessage("exit");
                await exited;
              }
            }
          }
          Bun.gc(true);
          console.log("delta", fileSinkInternals.liveCount() - baseline);
        }
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("delta 0");
    expect(exitCode).toBe(0);
  });
});
