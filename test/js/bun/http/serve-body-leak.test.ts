import type { Subprocess } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";

const payload = Buffer.alloc(512 * 1024, "1").toString("utf-8"); // decent size payload to test memory leak
const zeroCopyPayload = new Blob([payload]);
const zeroCopyJSONPayload = new Blob([JSON.stringify({ bun: payload })]);

const concurrency = 40;
// Requests per scenario. The fixture reports RSS only after a full GC and a synchronous
// scavenge, so the samples sit within a few MB of each other when nothing leaks, and the
// signal of a leaked 512 KB body does not need thousands of requests to clear the noise:
// over the requests after the first checkpoint it is 0.75 * requestCount * 512 KB, i.e.
// 180 MB (release) or 120 MB (ASAN/debug, where each request is several times slower).
const requestCount = isASAN || isDebug ? 320 : 480;
const checkpoints = 4;
// Warmup requests per route: enough to JIT the handlers, grow the heap to its steady
// state and, under ASAN, fill the 256 MB free-memory quarantine before anything is measured.
const warmupCount = 80;
// ASAN's quarantine recycles in 256 MB FIFO order, so the per-scenario plateau shifts by
// more than the release allocator's does when the allocation pattern changes.
const maxGrowthMB = isASAN ? 48 : 32;
// Absolute bound on the settled RSS after a scenario: the release fixture sits near 40 MB,
// the ASAN one near 600 MB (340 MB baseline plus the quarantine).
const maxRssMB = isASAN || isDebug ? 768 : 256;

type Scenario = { name: string; path: string; body: Blob; expected: string };
const scenarios: Scenario[] = [
  { name: "#10265 should not leak memory when ignoring the body", path: "/", body: zeroCopyPayload, expected: "Ok" },
  { name: "should not leak memory when buffering the body", path: "/buffering", body: zeroCopyPayload, expected: "Ok" },
  {
    name: "should not leak memory when buffering a JSON body",
    path: "/json-buffering",
    body: zeroCopyJSONPayload,
    expected: "Ok",
  },
  {
    name: "should not leak memory when buffering the body and accessing req.body",
    path: "/buffering+body-getter",
    body: zeroCopyPayload,
    expected: "Ok",
  },
  { name: "should not leak memory when streaming the body", path: "/streaming", body: zeroCopyPayload, expected: "Ok" },
  {
    name: "should not leak memory when streaming the body incompletely",
    path: "/incomplete-streaming",
    body: zeroCopyPayload,
    expected: "Ok",
  },
  {
    name: "should not leak memory when streaming the body and echoing it back",
    path: "/streaming-echo",
    body: zeroCopyPayload,
    expected: payload,
  },
];

async function getMemoryUsage(url: URL): Promise<number> {
  const res = await fetch(new URL("/report", url));
  expect(res.status).toBe(200);
  return (await res.json()) as number;
}

async function sendRequests(url: URL, { path, body, expected }: Scenario, count: number) {
  for (let remaining = count; remaining > 0; remaining -= concurrency) {
    const batch = new Array(Math.min(concurrency, remaining));
    for (let i = 0; i < batch.length; i++) {
      batch[i] = fetch(new URL(path, url), { method: "POST", body }).then(async res => {
        const text = await res.text();
        expect(res.status).toBe(200);
        expect(text.length).toBe(expected.length);
        expect(text).toBe(expected);
      });
    }
    await Promise.all(batch);
  }
}

const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024);

async function measureMemoryGrowth(url: URL, scenario: Scenario) {
  const startMB = toMB(await getMemoryUsage(url));
  const samplesMB: number[] = [];
  for (let i = 0; i < checkpoints; i++) {
    await sendRequests(url, scenario, requestCount / checkpoints);
    samplesMB.push(toMB(await getMemoryUsage(url)));
  }
  // The first checkpoint is the baseline so that a one-time step (heap growth, allocator
  // arenas, the ASAN quarantine) while the scenario ramps up is not mistaken for a leak.
  // A per-request leak keeps every later checkpoint above it.
  const growthMB = Math.max(...samplesMB.slice(1)) - samplesMB[0];
  return { growthMB, startMB, endMB: samplesMB[samplesMB.length - 1], samplesMB };
}

// One fixture subprocess serves every scenario: a real body leak compounds across them
// instead of being hidden by a restart, and the warmup runs once.
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
    for (const scenario of scenarios) {
      await sendRequests(url, scenario, warmupCount);
    }
  }, 60_000);

  afterAll(async () => {
    fixture?.kill();
    await fixture?.exited;
  });

  for (const scenario of scenarios) {
    it(
      scenario.name,
      async () => {
        // fail fast with the exit code instead of a ConnectionRefused cascade if a prior scenario crashed the fixture
        expect(fixture.exitCode ?? fixture.signalCode).toBeNull();
        const report = await measureMemoryGrowth(url, scenario);
        console.log(scenario.path, report);
        expect(report.growthMB).toBeLessThanOrEqual(maxGrowthMB);
        expect(report.endMB).toBeLessThanOrEqual(maxRssMB);
      },
      isDebug || isASAN ? 60_000 : 30_000,
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
