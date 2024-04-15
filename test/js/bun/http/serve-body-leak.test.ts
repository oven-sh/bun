import { join } from "path";
import { it, expect, beforeAll, afterAll } from "bun:test";
import { bunExe, bunEnv } from "harness";
import type { Subprocess } from "bun";

let url: URL;
let process: Subprocess<"ignore", "pipe", "inherit"> | null = null;
beforeAll(async () => {
  process = Bun.spawn([bunExe(), "--smol", join(import.meta.dirname, "body-leak-test-fixture.ts")], {
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const { value } = await process.stdout.getReader().read();
  url = new URL(new TextDecoder().decode(value));

  await warmup();
});
afterAll(() => {
  process?.kill();
});

async function getMemoryUsage(): Promise<number> {
  return await fetch(`${url.origin}/report`).then(res => res.json());
}
async function garbageCollect() {
  await Bun.sleep(100);
  await fetch(`${url.origin}/gc`);
}
const payload = "1".repeat(64 * 1024);

async function warmup() {
  for (let i = 0; i < 10_000; i++) {
    await fetch(url, {
      method: "POST",
      body: payload,
    });
  }
}

async function callBuffering() {
  await fetch(`${url.origin}/buffering`, {
    method: "POST",
    body: payload,
  });
}
async function callStreaming() {
  await fetch(`${url.origin}/streaming`, {
    method: "POST",
    body: payload,
  });
}
async function callIncompleteStreaming() {
  await fetch(`${url.origin}/incomplete-streaming`, {
    method: "POST",
    body: payload,
  });
}
async function callIgnore() {
  await fetch(url, {
    method: "POST",
    body: payload,
  });
}

async function memoryMemoryLeak(fn: () => Promise<void>) {
  const start_memory = await getMemoryUsage();
  const memory_examples: Array<number> = [];
  let peak_memory = start_memory;
  for (let i = 0; i < 10_000; i++) {
    await fn();
    // garbage collect and check memory usage every 1000 requests
    if (i > 0 && i % 1000 === 0) {
      const report = await getMemoryUsage();
      if (report > peak_memory) {
        peak_memory = report;
      }
      memory_examples.push(report);
    }
  }
  const end_memory = await getMemoryUsage();
  // use first example as a reference if is a memory leak this should keep increasing and not be stable
  const consumption = end_memory - memory_examples[0];
  const leak = Math.floor(consumption > 0 ? consumption / 1024 / 1024 : 0);
  return { leak, start_memory, peak_memory, end_memory, memory_examples };
}
it("should not leak memory when ignoring the body", async () => {
  const report = await memoryMemoryLeak(callIgnore);
  console.log(report);

  // peak memory is too high
  expect(report.peak_memory > report.start_memory * 2).toBe(false);
  // acceptable memory leak 2mbish
  expect(report.leak).toBeLessThanOrEqual(2);
});

it("should not leak memory when buffering the body", async () => {
  const report = await memoryMemoryLeak(callBuffering);
  console.log(report);
  // peak memory is too high
  expect(report.peak_memory > report.start_memory * 2).toBe(false);
  // acceptable memory leak 2mbish
  expect(report.leak).toBeLessThanOrEqual(2);
});

it("should not leak memory when streaming the body", async () => {
  const report = await memoryMemoryLeak(callStreaming);
  console.log(report);

  // peak memory is too high
  expect(report.peak_memory > report.start_memory * 2).toBe(false);
  // acceptable memory leak 2mbish
  expect(report.leak).toBeLessThanOrEqual(2);
});

it("should not leak memory when streaming the body incompletely", async () => {
  const report = await memoryMemoryLeak(callIncompleteStreaming);
  console.log(report);

  // peak memory is too high
  expect(report.peak_memory > report.start_memory * 2).toBe(false);
  // acceptable memory leak 2mbish
  expect(report.leak).toBeLessThanOrEqual(2);
});
