import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: stream,
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await proc.stdout.text();
    console.log(text); // "some data from a stream"
    expect(text).toBe("some data from a stream");
  });

  test("piping HTTP response to process", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(async function* () {
          yield "Line 1\n";
          yield "Line 2\n";
          yield "Line 3\n";
        });
      },
    });

    // Count lines using Bun subprocess
    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        /*js*/ `
        let count = 0;
           const readline = require('readline');
           const rl = readline.createInterface({
             input: process.stdin,
             output: process.stdout,
             terminal: false
           });
           rl.on('line', () => count++);
           rl.on('close', () => console.log(count));`,
      ],
      stdin: await fetch(server.url),
      stdout: "pipe",
      env: bunEnv,
    });
    const output = await proc.stdout.text();
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
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: transformedStream,
      stdout: "pipe",
      env: bunEnv,
    });

    const result = await proc.stdout.text();
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

    // Process the stream (just echo it for cross-platform compatibility)
    const proc = spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      stdin: fileStream,
      stdout: "pipe",
      env: bunEnv,
    });

    const result = await proc.stdout.text();
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

    // Process the CSV data using Bun
    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `let sum = 0, count = 0;
         const readline = require('readline');
         const rl = readline.createInterface({
           input: process.stdin,
           output: process.stdout,
           terminal: false
         });
         rl.on('line', (line) => {
           const [_, value] = line.split(',');
           sum += parseFloat(value);
           count++;
         });
         rl.on('close', () => console.log(sum / count));`,
      ],
      stdin: dataStream,
      stdout: "pipe",
      env: bunEnv,
    });

    const avgStr = await proc.stdout.text();
    const avg = parseFloat(avgStr.trim());

    // Average should be between 0 and 100
    expect(avg).toBeGreaterThanOrEqual(0);
    expect(avg).toBeLessThanOrEqual(100);
  });
});
