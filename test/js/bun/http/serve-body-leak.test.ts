import { join } from "path";
import { it, expect, beforeAll, afterAll } from "bun:test";
import { bunExe, bunEnv } from "harness";
import type { Subprocess } from "bun";

const ACCEPTABLE_MEMORY_LEAK = 2; //MB for acceptable memory leak variance
const payload = "1".repeat(64 * 1024); // decent size payload to test memory leak

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
  return (await fetch(`${url.origin}/report`).then(res => res.json())) as number;
}

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
  const result = await fetch(`${url.origin}/streaming`, {
    method: "POST",
    body: payload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callIncompleteStreaming() {
  const result = await fetch(`${url.origin}/incomplete-streaming`, {
    method: "POST",
    body: payload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callStreamingEcho() {
  const result = await fetch(`${url.origin}/streaming-echo`, {
    method: "POST",
    body: payload,
  }).then(res => res.text());
  expect(result).toBe(payload);
}
async function callIgnore() {
  const result = await fetch(url, {
    method: "POST",
    body: payload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}

async function calculateMemoryLeak(fn: () => Promise<void>) {
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
  // wait for the last memory usage to be stable
  const end_memory = await getMemoryUsage();
  if (end_memory > peak_memory) {
    peak_memory = end_memory;
  }
  // use first example as a reference if is a memory leak this should keep increasing and not be stable
  const consumption = end_memory - memory_examples[0];
  // memory leak in MB
  const leak = Math.floor(consumption > 0 ? consumption / 1024 / 1024 : 0);
  return { leak, start_memory, peak_memory, end_memory, memory_examples };
}

for (const test of [
  ["#10265 should not leak memory when ignoring the body", callIgnore],
  ["should not leak memory when buffering the body", callBuffering],
  ["should not leak memory when streaming the body", callStreaming],
  ["should not leak memory when streaming the body incompletely", callIncompleteStreaming],
  ["should not leak memory when streaming the body and echoing it back", callStreamingEcho],
]) {
  const [testName, fn] = test as [string, () => Promise<void>];
  it(
    testName,
    async () => {
      const report = await calculateMemoryLeak(fn);
      console.log(report);

      // peak memory is too high
      expect(report.peak_memory > report.start_memory * 2).toBe(false);
      // acceptable memory leak
      expect(report.leak).toBeLessThanOrEqual(ACCEPTABLE_MEMORY_LEAK);
    },
    20_000,
  );
}
