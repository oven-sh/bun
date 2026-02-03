import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import { Writable } from "stream";
import stripAnsi from "strip-ansi";
import { Worker } from "worker_threads";

describe("worker_threads stdio", () => {
  describe("default behavior (no stdio options)", () => {
    test("stdout/stderr/stdin are null when not configured", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          const { parentPort } = require('worker_threads');
          console.log("hello from worker");
          parentPort.postMessage({ done: true });
        `,
      });

      const workerPath = join(String(dir), "worker.js");
      const worker = new Worker(workerPath);

      expect(worker.stdout).toBeNull();
      expect(worker.stderr).toBeNull();
      expect(worker.stdin).toBeNull();

      const { promise, resolve } = Promise.withResolvers<void>();
      worker.on("message", () => resolve());
      worker.on("error", () => resolve());
      worker.on("exit", () => resolve());
      await promise;

      await worker.terminate();
    });
  });

  describe("stdout", () => {
    test("stdout is a readable stream when stdout: true", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.log("hello from worker");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      expect(worker.stdout).not.toBeNull();
      expect(typeof worker.stdout?.pipe).toBe("function");
      expect(typeof worker.stdout?.on).toBe("function");

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(output.trim()).toBe("hello from worker");
    });

    test("captures multiple console.log outputs", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.log("line 1");
          console.log("line 2");
          console.log("line 3");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      const lines = output.trim().split("\n");
      expect(lines).toEqual(["line 1", "line 2", "line 3"]);
    });

    test("captures large output", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          // Generate a large output (100KB+)
          const line = Buffer.alloc(1000, "x").toString();
          for (let i = 0; i < 100; i++) {
            console.log(line);
          }
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      const lines = output.trim().split("\n");
      expect(lines.length).toBe(100);
      expect(lines[0].length).toBe(1000);
    });

    test("captures unicode and emoji output", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.log("Hello 世界 🌍");
          console.log("日本語テスト");
          console.log("🎉🎊🎁");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      // Use toContain for robustness - output buffering may combine lines
      expect(output).toContain("Hello 世界 🌍");
      expect(output).toContain("日本語テスト");
      expect(output).toContain("🎉🎊🎁");
    });

    test("captures output with special characters", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.log("line with\\ttab");
          console.log("line with\\rcarriage return");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(output).toContain("line with\ttab");
      expect(output).toContain("line with\rcarriage return");
    });

    test("stdout can be piped to a writable stream (BullMQ pattern)", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          const { parentPort } = require('worker_threads');
          console.log("Processing job");
          parentPort.postMessage({ done: true });
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      expect(worker.stdout).not.toBeNull();
      expect(typeof worker.stdout?.pipe).toBe("function");

      const chunks: string[] = [];
      worker.stdout!.pipe(
        new Writable({
          write(chunk: Buffer, _: string, callback: () => void) {
            chunks.push(chunk.toString());
            callback();
          },
        }),
      );

      const { promise, resolve } = Promise.withResolvers<void>();
      worker.on("message", (msg: { done?: boolean }) => {
        if (msg.done) resolve();
      });
      await promise;

      await worker.terminate();

      expect(chunks.join("")).toContain("Processing job");
    });

    test("stdout stream ends when worker exits", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.log("done");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
      });

      // Read from the stream to ensure we reach EOF
      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.stdout!.on("end", () => resolve(data));
      const output = await promise;

      expect(output.trim()).toBe("done");
    });

    test("stdout with eval: true", async () => {
      const worker = new Worker(`console.log("eval worker output");`, {
        eval: true,
        stdout: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stdout!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(output.trim()).toBe("eval worker output");
    });
  });

  describe("stderr", () => {
    test("stderr is a readable stream when stderr: true", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.error("error from worker");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      expect(worker.stderr).not.toBeNull();
      expect(typeof worker.stderr?.pipe).toBe("function");
      expect(typeof worker.stderr?.on).toBe("function");

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(stripAnsi(output).trim()).toBe("error from worker");
    });

    test("captures console.error output", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.error("error 1");
          console.error("error 2");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      const lines = stripAnsi(output).trim().split("\n");
      expect(lines).toEqual(["error 1", "error 2"]);
    });

    test("captures console.warn output", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.warn("warning message");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(stripAnsi(output).trim()).toBe("warning message");
    });

    test("captures errors with stack traces", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.error("Error: Something went wrong");
          console.error("    at someFunction (file.js:10:5)");
          console.error("    at main (file.js:20:3)");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(output).toContain("Error: Something went wrong");
      expect(output).toContain("at someFunction");
      expect(output).toContain("at main");
    });

    test("stderr can be piped to a writable stream", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.error("piped error");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      const chunks: string[] = [];
      worker.stderr!.pipe(
        new Writable({
          write(chunk: Buffer, _: string, callback: () => void) {
            chunks.push(chunk.toString());
            callback();
          },
        }),
      );

      const { promise, resolve } = Promise.withResolvers<void>();
      worker.on("exit", () => resolve());
      await promise;

      expect(stripAnsi(chunks.join("")).trim()).toBe("piped error");
    });

    test("stderr stream ends when worker exits", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `console.error("done");`,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stderr: true,
      });

      // Read from the stream to ensure we reach EOF
      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.stderr!.on("end", () => resolve(data));
      const output = await promise;

      expect(stripAnsi(output).trim()).toBe("done");
    });

    test("stderr with eval: true", async () => {
      const worker = new Worker(`console.error("eval error output");`, {
        eval: true,
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      let data = "";
      worker.stderr!.on("data", chunk => (data += chunk));
      worker.on("exit", () => resolve(data));
      const output = await promise;

      expect(stripAnsi(output).trim()).toBe("eval error output");
    });
  });

  describe("stdout and stderr together", () => {
    test("both streams work independently", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.log("stdout message");
          console.error("stderr message");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<[string, string]>();
      let stdoutData = "";
      let stderrData = "";
      worker.stdout!.on("data", chunk => (stdoutData += chunk));
      worker.stderr!.on("data", chunk => (stderrData += chunk));
      worker.on("exit", () => resolve([stdoutData, stderrData]));
      const [stdout, stderr] = await promise;

      expect(stdout.trim()).toBe("stdout message");
      expect(stripAnsi(stderr).trim()).toBe("stderr message");
    });

    test("interleaved stdout and stderr", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          console.log("out 1");
          console.error("err 1");
          console.log("out 2");
          console.error("err 2");
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<[string, string]>();
      let stdoutData = "";
      let stderrData = "";
      worker.stdout!.on("data", chunk => (stdoutData += chunk));
      worker.stderr!.on("data", chunk => (stderrData += chunk));
      worker.on("exit", () => resolve([stdoutData, stderrData]));
      const [stdout, stderr] = await promise;

      expect(stdout.trim().split("\n")).toEqual(["out 1", "out 2"]);
      expect(stripAnsi(stderr).trim().split("\n")).toEqual(["err 1", "err 2"]);
    });

    test("large interleaved output", async () => {
      using dir = tempDir("worker-stdio-test", {
        "worker.js": `
          for (let i = 0; i < 50; i++) {
            console.log("stdout line " + i);
            console.error("stderr line " + i);
          }
        `,
      });

      const worker = new Worker(join(String(dir), "worker.js"), {
        stdout: true,
        stderr: true,
      });

      const { promise, resolve } = Promise.withResolvers<[string, string]>();
      let stdoutData = "";
      let stderrData = "";
      worker.stdout!.on("data", chunk => (stdoutData += chunk));
      worker.stderr!.on("data", chunk => (stderrData += chunk));
      worker.on("exit", () => resolve([stdoutData, stderrData]));
      const [stdout, stderr] = await promise;

      const stdoutLines = stdout.trim().split("\n");
      const stderrLines = stripAnsi(stderr).trim().split("\n");

      expect(stdoutLines.length).toBe(50);
      expect(stderrLines.length).toBe(50);
      expect(stdoutLines[0]).toBe("stdout line 0");
      expect(stdoutLines[49]).toBe("stdout line 49");
      expect(stderrLines[0]).toBe("stderr line 0");
      expect(stderrLines[49]).toBe("stderr line 49");
    });
  });

  describe("stdin", () => {
    test("stdin throws NotImplementedError", async () => {
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
});
