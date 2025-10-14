import { spawn } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isASAN, isCI } from "harness";

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

  test.todo("ReadableStream cancellation when process exits early", async () => {
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

    // Give some time for cancellation to happen
    await Bun.sleep(100);

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

  test("ReadableStream object type count", async () => {
    const iterations =
      isASAN && isCI
        ? // With ASAN, entire process gets killed, including the test runner in CI. Likely an OOM or out of file descriptors.
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
});
