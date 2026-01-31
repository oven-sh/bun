import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import { Writable } from "stream";
import { Worker } from "worker_threads";

describe("worker_threads stdio", () => {
  // This test documents the current (broken) behavior
  test("Worker stdout/stderr are currently null (not implemented)", async () => {
    using dir = tempDir("worker-stdio-test", {
      "worker.js": `
        const { parentPort } = require('worker_threads');
        console.log("hello from worker");
        parentPort.postMessage({ done: true });
      `,
    });

    const workerPath = join(String(dir), "worker.js");
    const worker = new Worker(workerPath);

    // Current behavior: always null (this is the bug)
    expect(worker.stdout).toBeNull();
    expect(worker.stderr).toBeNull();
    expect(worker.stdin).toBeNull();

    await new Promise<void>(resolve => {
      worker.on("message", () => resolve());
      worker.on("error", () => resolve());
      worker.on("exit", () => resolve());
    });

    await worker.terminate();
  });

  // This test shows what SHOULD work (like Node.js)
  test("Worker with stdout: true should have readable stdout stream", async () => {
    using dir = tempDir("worker-stdio-test", {
      "worker.js": `console.log("hello from worker");`,
    });

    const worker = new Worker(join(String(dir), "worker.js"), {
      stdout: true,
      stderr: true,
    });

    // Expected behavior (not yet implemented):
    expect(worker.stdout).not.toBeNull();
    expect(worker.stderr).not.toBeNull();
    expect(typeof worker.stdout?.pipe).toBe("function");

    const output = await new Promise<string>(resolve => {
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
    });

    expect(output.trim()).toBe("hello from worker");
  });

  // This test shows the BullMQ use case
  test("Worker stdout can be piped (BullMQ pattern)", async () => {
    using dir = tempDir("worker-stdio-test", {
      "worker.js": `
        const { parentPort } = require('worker_threads');
        console.log("Processing job");
        parentPort.postMessage({ done: true });
      `,
    });

    const worker = new Worker(join(String(dir), "worker.js"), {
      stdout: true,
      stderr: true,
    });

    // BullMQ does this:
    // worker.stdout.pipe(process.stdout);
    // worker.stderr.pipe(process.stderr);

    expect(worker.stdout).not.toBeNull();
    expect(typeof worker.stdout?.pipe).toBe("function");

    // Should not throw
    const chunks: string[] = [];
    worker.stdout!.pipe(
      new Writable({
        write(chunk: Buffer, _: string, callback: () => void) {
          chunks.push(chunk.toString());
          callback();
        },
      }),
    );

    await new Promise<void>(resolve => {
      worker.on("message", (msg: { done?: boolean }) => {
        if (msg.done) resolve();
      });
    });

    await worker.terminate();

    expect(chunks.join("")).toContain("Processing job");
  });

  test("Worker stdin throws NotImplementedError", async () => {
    using dir = tempDir("worker-stdio-test", {
      "worker.js": `console.log("job");`,
    });

    const worker = new Worker(join(String(dir), "worker.js"), {
      stdin: true,
      stdout: true,
    });

    expect(worker.stdout).not.toBeNull();
    expect(() => worker.stdin).toThrow(
      "worker_threads.stdin is not yet implemented in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/22585",
    );

    await worker.terminate();
  });

  test.todo("Worker stdin can be written to", async () => {
    using dir = tempDir("worker-stdio-test", {
      "worker.js": `
      const fs = require('fs');
      // Read from stdin (fd 0) and log it
      const input = fs.readFileSync(0, 'utf-8');
      console.log("Received: " + input);
    `,
    });

    const worker = new Worker(join(String(dir), "worker.js"), {
      stdin: true,
      stdout: true,
    });

    // Write to the worker's stdin
    worker.stdin!.write("Hello from parent");
    worker.stdin!.end();

    const output = await new Promise<string>(resolve => {
      let data = "";
      worker.stdout.on("data", c => (data += c));
      worker.on("exit", () => resolve(data));
    });

    expect(output).toContain("Received: Hello from parent");
  });
});
