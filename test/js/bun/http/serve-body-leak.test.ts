import { expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isFlaky, isLinux, isWindows } from "harness";
import { join } from "path";

const payload = Buffer.alloc(512 * 1024, "1").toString("utf-8"); // decent size payload to test memory leak
const batchSize = 40;
const totalCount = 10_000;
const zeroCopyPayload = new Blob([payload]);
const zeroCopyJSONPayload = new Blob([JSON.stringify({ bun: payload })]);

// let HARDCODED_URL = "http://localhost:52666/";
let HARDCODED_URL = null;

async function getURL() {
  if (HARDCODED_URL) {
    const url = new URL(HARDCODED_URL);
    await warmup(url);
    return {
      url,
      process: {
        [Symbol.asyncDispose]() {
          return Promise.resolve();
        },
      },
    };
  }
  let defer = Promise.withResolvers<string>();
  const process = Bun.spawn([bunExe(), "--smol", join(import.meta.dirname, "body-leak-test-fixture.ts")], {
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    ipc(message) {
      defer.resolve(message);
    },
  });
  const url: URL = new URL(await defer.promise);
  process.unref();
  await warmup(url);
  return { url, process };
}

async function getMemoryUsage(url: URL): Promise<number> {
  return (await fetch(`${url.origin}/report`).then(res => res.json())) as number;
}

async function warmup(url: URL) {
  var remaining = totalCount;

  while (remaining > 0) {
    const batch = new Array(batchSize);
    for (let j = 0; j < batchSize; j++) {
      // warmup the server with streaming requests, because is the most memory intensive
      batch[j] = fetch(`${url.origin}/streaming`, {
        method: "POST",
        body: zeroCopyPayload,
      });
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
  // use first example as a reference if is a memory leak this should keep increasing and not be stable
  const consumption = end_memory - memory_examples[0];
  // memory leak in MB
  const leak = Math.floor(consumption > 0 ? consumption / 1024 / 1024 : 0);
  return { leak, start_memory, peak_memory, end_memory, memory_examples };
}

// Since the payload size is 512 KB
// If it was leaking the body, the memory usage would be at least 512 KB * 10_000 = 5 GB
// If it ends up around 280 MB, it's probably not leaking the body.
for (const test_info of [
  ["#10265 should not leak memory when ignoring the body", callIgnore, false, 64],
  ["should not leak memory when buffering the body", callBuffering, false, 64],
  ["should not leak memory when buffering a JSON body", callJSONBuffering, false, 64],
  ["should not leak memory when buffering the body and accessing req.body", callBufferingBodyGetter, false, 64],
  ["should not leak memory when streaming the body", callStreaming, isFlaky && isLinux, 64],
  ["should not leak memory when streaming the body incompletely", callIncompleteStreaming, false, 64],
  ["should not leak memory when streaming the body and echoing it back", callStreamingEcho, false, 64],
] as const) {
  const [testName, fn, skip, maxMemoryGrowth] = test_info;
  it.todoIf(skip || (isFlaky && isWindows))(
    testName,
    async () => {
      const { url, process } = await getURL();
      try {
        const report = await calculateMemoryLeak(fn, url);
        console.log(report);
        // peak memory is too high
        expect(report.peak_memory).not.toBeGreaterThan(report.start_memory * 2.5);

        // acceptable memory leak
        expect(report.leak).toBeLessThanOrEqual(maxMemoryGrowth);

        // ASAN quarantine + debug-assertions instrumentation inflate RSS;
        // give the asan lane more headroom than a plain release build.
        expect(report.end_memory).toBeLessThanOrEqual((isASAN ? 768 : 512) * 1024 * 1024);
      } catch (e) {
        if (!isCI && process.platform !== "win32") {
          try {
            await fetch(`${url.origin}/heap-snapshot`);
            await Bun.sleep(10);
          } catch (e) {
            console.error(e);
          }
        }

        throw e;
      } finally {
        process.kill?.();
      }
    },
    // release-asan runs streaming-echo at ~31s median (27-39s over 35 CI runs),
    // so 40s leaves no margin on a slow runner; give ASAN the same 60s as debug.
    isDebug || isASAN ? 60_000 : 40_000,
  );
}

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
  const [small, large] = [await runAborts(2), await runAborts(22)];
  // 20 extra aborted requests leaked ~176 bytes each before the fix.
  expect(large - small).toBeLessThan(1000);
});
