import { test, expect, describe } from "bun:test";
import { Worker } from "worker_threads";

describe("worker_threads stdout/stderr capture", () => {
  test("stdout and stderr are null by default", async () => {
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("ready");
    `,
      { eval: true }
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    expect(worker.stdout).toBeNull();
    expect(worker.stderr).toBeNull();
    await worker.terminate();
  });

  test("stdout and stderr are null when explicitly set to false", async () => {
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("ready");
    `,
      { eval: true, stdout: false, stderr: false }
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    expect(worker.stdout).toBeNull();
    expect(worker.stderr).toBeNull();
    await worker.terminate();
  });

  test("stdout capture returns a ReadableStream when stdout: true", async () => {
    const worker = new Worker(
      `
      console.log("hello from worker stdout");
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("done");
    `,
      { eval: true, stdout: true }
    );

    expect(worker.stdout).not.toBeNull();
    expect(worker.stdout).toBeInstanceOf(ReadableStream);

    // Wait for worker to finish
    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    // Read the stdout content
    const reader = worker.stdout!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const output = Buffer.concat(chunks).toString();
    expect(output).toContain("hello from worker stdout");

    await worker.terminate();
  });

  test("stderr capture returns a ReadableStream when stderr: true", async () => {
    const worker = new Worker(
      `
      console.error("hello from worker stderr");
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("done");
    `,
      { eval: true, stderr: true }
    );

    expect(worker.stderr).not.toBeNull();
    expect(worker.stderr).toBeInstanceOf(ReadableStream);

    // Wait for worker to finish
    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    // Read the stderr content
    const reader = worker.stderr!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const output = Buffer.concat(chunks).toString();
    expect(output).toContain("hello from worker stderr");

    await worker.terminate();
  });

  test("can capture both stdout and stderr simultaneously", async () => {
    const worker = new Worker(
      `
      console.log("stdout output");
      console.error("stderr output");
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("done");
    `,
      { eval: true, stdout: true, stderr: true }
    );

    expect(worker.stdout).not.toBeNull();
    expect(worker.stderr).not.toBeNull();

    // Wait for worker to finish
    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    // Read stdout
    const stdoutReader = worker.stdout!.getReader();
    const stdoutChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      stdoutChunks.push(value);
    }
    const stdoutOutput = Buffer.concat(stdoutChunks).toString();

    // Read stderr
    const stderrReader = worker.stderr!.getReader();
    const stderrChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrChunks.push(value);
    }
    const stderrOutput = Buffer.concat(stderrChunks).toString();

    expect(stdoutOutput).toContain("stdout output");
    expect(stderrOutput).toContain("stderr output");

    await worker.terminate();
  });

  test("resourceLimits option is accepted without error", async () => {
    // resourceLimits is a no-op but should not throw
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      parentPort.postMessage("ready");
    `,
      {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          codeRangeSizeMb: 64,
          stackSizeMb: 4,
        },
      }
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    worker.on("message", resolve);
    await promise;

    await worker.terminate();
  });
});
