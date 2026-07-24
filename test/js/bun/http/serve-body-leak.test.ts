import type { Subprocess } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";

const payload = Buffer.alloc(512 * 1024, "1").toString("utf-8"); // decent size payload to test memory leak
const batchSize = 40;
// A leaked 512 KB body × totalCount would grow RSS by gigabytes; the assertions
// below compare against O(100 MB), so the slower ASAN/debug lanes keep the same
// margin with fewer iterations (each request is ~2-10× slower there).
const totalCount = isASAN || isDebug ? 3_000 : 10_000;
const zeroCopyPayload = new Blob([payload]);
const zeroCopyJSONPayload = new Blob([JSON.stringify({ bun: payload })]);

async function getMemoryUsage(url: URL): Promise<number> {
  return (await fetch(`${url.origin}/report`).then(res => res.json())) as number;
}

async function warmup(url: URL) {
  var remaining = totalCount;

  while (remaining > 0) {
    const batch = new Array(batchSize);
    for (let j = 0; j < batchSize; j++) {
      // Warm up with incomplete-streaming: it is the highest-RSS scenario (the
      // unread tail of each 512 KB body lingers until the request context is
      // recycled), so priming the allocator with it leaves every scenario's
      // start_memory at the shared server's steady-state plateau. Warming with
      // /streaming instead left incomplete-streaming to grow the heap by ~80 MB
      // mid-measurement on darwin aarch64 (build 78545), a false positive.
      batch[j] = fetch(`${url.origin}/incomplete-streaming`, {
        method: "POST",
        body: zeroCopyPayload,
      }).then(res => res.text());
    }
    await Promise.all(batch);
    remaining -= batchSize;
  }
  // clean up memory before first test
  await getMemoryUsage(url);
}

async function callBuffering(url: URL) {
  const result = await fetch(`${url.origin}/buffering`, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callJSONBuffering(url: URL) {
  const result = await fetch(`${url.origin}/json-buffering`, {
    method: "POST",
    body: zeroCopyJSONPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}

async function callBufferingBodyGetter(url: URL) {
  const result = await fetch(`${url.origin}/buffering+body-getter`, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callStreaming(url: URL) {
  const result = await fetch(`${url.origin}/streaming`, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callIncompleteStreaming(url: URL) {
  const result = await fetch(`${url.origin}/incomplete-streaming`, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}
async function callStreamingEcho(url: URL) {
  const result = await fetch(`${url.origin}/streaming-echo`, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe(payload);
}
async function callIgnore(url: URL) {
  const result = await fetch(url, {
    method: "POST",
    body: zeroCopyPayload,
  }).then(res => res.text());
  expect(result).toBe("Ok");
}

async function calculateMemoryLeak(fn: (url: URL) => Promise<void>, url: URL) {
  const start_memory = await getMemoryUsage(url);
  const memory_examples: Array<number> = [];
  let peak_memory = start_memory;

  var remaining = totalCount;
  while (remaining > 0) {
    const batch = new Array(batchSize);
    for (let j = 0; j < batchSize; j++) {
      batch[j] = fn(url);
    }
    await Promise.all(batch);
    remaining -= batchSize;

    // garbage collect and check memory usage every 1000 requests
    if (remaining > 0 && remaining % 1000 === 0) {
      const report = await getMemoryUsage(url);
      if (report > peak_memory) {
        peak_memory = report;
      }
      memory_examples.push(report);
    }
  }

  // wait for the last memory usage to be stable
  const end_memory = await getMemoryUsage(url);
  if (end_memory > peak_memory) {
    peak_memory = end_memory;
  }
  // A per-request leak grows RSS linearly across the samples; a one-time heap
  // expansion steps up and plateaus. Using the median sample as the baseline
  // (instead of the first) lets the first half of the run absorb allocator
  // growth while still flagging linear growth: a leaked 512 KB body produces
  // ~2.5 GB of growth over the second half, against a 64 MB threshold.
  const sorted = [...memory_examples].sort((a, b) => a - b);
  const baseline = sorted[sorted.length >> 1];
  const consumption = end_memory - baseline;
  // memory leak in MB
  const leak = Math.floor(consumption > 0 ? consumption / 1024 / 1024 : 0);
  return { leak, start_memory, peak_memory, end_memory, memory_examples };
}

// Since the payload size is 512 KB
// If it was leaking the body, the memory usage would be at least 512 KB * totalCount = multiple GB
// If it ends up around 280 MB, it's probably not leaking the body.
//
// One fixture subprocess serves every scenario below: spawning a fresh one per
// test (and re-running the 10k-request warmup each time) was the dominant cost
// on ASAN. Sequential reuse keeps the RSS assertions meaningful because a real
// body leak compounds across scenarios instead of being hidden by a restart.
describe("request body leak", () => {
  let fixture: Subprocess;
  let url: URL;

  beforeAll(async () => {
    const defer = Promise.withResolvers<string>();
    fixture = Bun.spawn([bunExe(), "--smol", join(import.meta.dirname, "body-leak-test-fixture.ts")], {
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      ipc(message) {
        defer.resolve(message);
      },
    });
    fixture.exited.then(code => defer.reject(new Error(`body-leak fixture exited (${code}) before sending its URL`)));
    url = new URL(await defer.promise);
    await warmup(url);
  }, 60_000);

  afterAll(async () => {
    fixture?.kill();
    await fixture?.exited;
  });

  for (const test_info of [
    ["#10265 should not leak memory when ignoring the body", callIgnore, 64],
    ["should not leak memory when buffering the body", callBuffering, 64],
    ["should not leak memory when buffering a JSON body", callJSONBuffering, 64],
    ["should not leak memory when buffering the body and accessing req.body", callBufferingBodyGetter, 64],
    ["should not leak memory when streaming the body", callStreaming, 64],
    ["should not leak memory when streaming the body incompletely", callIncompleteStreaming, 64],
    ["should not leak memory when streaming the body and echoing it back", callStreamingEcho, 64],
  ] as const) {
    const [testName, fn, maxMemoryGrowth] = test_info;
    it(
      testName,
      async () => {
        // fail fast with the exit code instead of a ConnectionRefused cascade if a prior scenario crashed the fixture
        expect(fixture.exitCode ?? fixture.signalCode).toBeNull();
        const report = await calculateMemoryLeak(fn, url);
        console.log(report);
        // Peak should stay within a small multiple of the post-GC baseline; a
        // leaked 512 KB body per request would blow past this by an order of
        // magnitude. 3x (was 2.5x) gives headroom for the incomplete-streaming
        // scenario on Windows, where 40 concurrent half-read uploads briefly
        // hold ~2.6x of a low shared-server baseline before dropping back.
        expect(report.peak_memory).not.toBeGreaterThan(report.start_memory * 3);
        // acceptable memory leak
        expect(report.leak).toBeLessThanOrEqual(maxMemoryGrowth);
        // ASAN quarantine + debug-assertions instrumentation inflate RSS;
        // give the asan lane more headroom than a plain release build.
        expect(report.end_memory).toBeLessThanOrEqual((isASAN ? 768 : 512) * 1024 * 1024);
      },
      isDebug || isASAN ? 60_000 : 40_000,
    );
  }
});

// A client disconnecting while a direct response stream is suspended inside pull() must not
// leak the native response sink (nothing else can ever free it once the request context is
// recycled). On ASAN builds LeakSanitizer reports it as a direct leak at exit; the assertion
// compares leaked bytes between a small and a large run so unrelated one-time at-exit
// allocations cannot mask or fake the signal. https://github.com/oven-sh/bun/pull/33193
it("aborting direct-stream responses parked in pull() does not leak the native sink", async () => {
  const runAborts = async (count: number) => {
    const script = `
      const parked = [];
      const server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        async fetch() {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write("part1");
                await c.flush();
                await new Promise(resolve => parked.push(resolve));
              },
            }),
            { headers: { "Content-Length": "100000" } },
          );
        },
      });
      for (let i = 0; i < ${count}; i++) {
        const ac = new AbortController();
        const res = await fetch(server.url, { signal: ac.signal });
        const reader = res.body.getReader();
        await reader.read();
        ac.abort();
        await reader.closed.catch(() => {});
      }
      // The aborted requests' pull() calls stay suspended: nothing may rely on them resuming.
      server.stop(true);
      Bun.gc(true);
      await Bun.sleep(20);
      Bun.gc(true);
      console.log("done");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        // On ASAN builds, make the subprocess report leaks at exit (inert elsewhere).
        ASAN_OPTIONS: "detect_leaks=1",
        LSAN_OPTIONS: `suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("done");
    const leaked = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr);
    return leaked ? Number(leaked[1]) : 0;
  };
  const [small, large] = await Promise.all([runAborts(2), runAborts(22)]);
  // 20 extra aborted requests leaked ~176 bytes each before the fix.
  expect(large - small).toBeLessThan(1000);
}, 30_000);
