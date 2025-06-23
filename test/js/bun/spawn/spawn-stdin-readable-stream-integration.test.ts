import { spawn } from "bun";
import { describe, expect, test } from "bun:test";

describe("spawn stdin ReadableStream integration", () => {
  test("example from documentation", async () => {
    const stream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(1);
        controller.enqueue("some data from a stream");
        controller.close();
      },
    });

    const proc = spawn({
      cmd: ["cat"],
      stdin: stream,
    });

    const text = await new Response(proc.stdout).text();
    console.log(text); // "some data from a stream"
    expect(text).toBe("some data from a stream");
  });

  test("piping HTTP response to process", async () => {
    // Simulate an HTTP response stream
    const responseStream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(1);
        controller.enqueue("Line 1\n");
        controller.enqueue("Line 2\n");
        controller.enqueue("Line 3\n");
        controller.close();
      },
    });

    // Count lines using wc -l
    const proc = spawn({
      cmd: ["wc", "-l"],
      stdin: responseStream,
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    expect(parseInt(output.trim())).toBe(3);
  });

  test("transforming data before passing to process", async () => {
    // Original data stream
    const dataStream = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(1);
        controller.enqueue("hello world");
        controller.enqueue("\n");
        controller.enqueue("foo bar");
        controller.close();
      },
    });

    // Transform to uppercase
    const upperCaseTransform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      },
    });

    // Pipe through transform then to process
    const transformedStream = dataStream.pipeThrough(upperCaseTransform);

    const proc = spawn({
      cmd: ["cat"],
      stdin: transformedStream,
      stdout: "pipe",
    });

    const result = await new Response(proc.stdout).text();
    expect(result).toBe("HELLO WORLD\nFOO BAR");
  });

  test("streaming large file through process", async () => {
    // Simulate streaming a large file in chunks
    const chunkSize = 1024;
    const numChunks = 100;
    let currentChunk = 0;

    const fileStream = new ReadableStream({
      pull(controller) {
        if (currentChunk < numChunks) {
          // Simulate file chunk
          controller.enqueue(`Chunk ${currentChunk}: ${"x".repeat(chunkSize - 20)}\n`);
          currentChunk++;
        } else {
          controller.close();
        }
      },
    });

    // Process the stream (e.g., compress it)
    const proc = spawn({
      cmd: ["gzip"],
      stdin: fileStream,
      stdout: "pipe",
    });

    // Decompress to verify
    const decompress = spawn({
      cmd: ["gunzip"],
      stdin: proc.stdout,
      stdout: "pipe",
    });

    const result = await new Response(decompress.stdout).text();
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(numChunks);
    expect(lines[0]).toStartWith("Chunk 0:");
    expect(lines[99]).toStartWith("Chunk 99:");
  });

  test("real-time data processing", async () => {
    let dataPoints = 0;
    const maxDataPoints = 5;

    // Simulate real-time data stream
    const dataStream = new ReadableStream({
      async pull(controller) {
        if (dataPoints < maxDataPoints) {
          const timestamp = Date.now();
          const value = Math.random() * 100;
          controller.enqueue(`${timestamp},${value.toFixed(2)}\n`);
          dataPoints++;

          // Simulate real-time delay
          await Bun.sleep(10);
        } else {
          controller.close();
        }
      },
    });

    // Process the CSV data
    const proc = spawn({
      cmd: ["awk", "-F,", "{ sum += $2; count++ } END { print sum/count }"],
      stdin: dataStream,
      stdout: "pipe",
    });

    const avgStr = await new Response(proc.stdout).text();
    const avg = parseFloat(avgStr.trim());

    // Average should be between 0 and 100
    expect(avg).toBeGreaterThanOrEqual(0);
    expect(avg).toBeLessThanOrEqual(100);
  });
});
