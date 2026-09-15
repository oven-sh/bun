import type { Subprocess } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";

const payload = Buffer.alloc(512 * 1024, "1").toString("utf-8"); // decent size payload to test memory leak
const batchSize = 40;
// A leaked 512 KB body × totalCount would grow RSS by gigabytes; the assertions
// below compare against O(100 MB), so the slower ASAN/debug lanes keep the same
// margin with fewer iterations (each request is ~2-10× slower there).
const baseCount = isASAN || isDebug ? 3_000 : 10_000;
// The HTTP/2 pass repeats every scenario; 40% keeps the file inside its CI
// budget while a leaked 512 KB body per request would still be gigabytes.
let totalCount = baseCount;
const zeroCopyPayload = new Blob([payload]);
const zeroCopyJSONPayload = new Blob([JSON.stringify({ bun: payload })]);

let fetchOptions: { protocol?: "http2"; tls?: { rejectUnauthorized: boolean } } = {};
const fetch = (url: string | URL, init: RequestInit = {}) => globalThis.fetch(url, { ...fetchOptions, ...init });

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
  // use first example as a reference if is a memory leak this should keep increasing and not be stable
  const consumption = end_memory - memory_examples[0];
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
describe.each([false, true])("request body leak (http2: %p)", http2 => {
  let fixture: Subprocess;
  let url: URL;

  beforeAll(async () => {
    fetchOptions = http2 ? { protocol: "http2", tls: { rejectUnauthorized: false } } : {};
    totalCount = http2 ? baseCount * 0.4 : baseCount;
    const defer = Promise.withResolvers<string>();
    fixture = Bun.spawn(
      [bunExe(), "--smol", join(import.meta.dirname, "body-leak-test-fixture.ts"), ...(http2 ? ["--http2"] : [])],
      {
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
        ipc(message) {
          defer.resolve(message);
        },
      },
    );
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
        // Samples are taken between batches, so up to one batch of in-flight bodies plus
        // not-yet-purged garbage may be counted; a leaked 512 KB body per request would blow
        // past this by an order of magnitude.
        expect(report.peak_memory - report.start_memory).toBeLessThan(256 * 1024 * 1024);
        // acceptable memory leak
        expect(report.leak).toBeLessThanOrEqual(maxMemoryGrowth);
        // ASAN quarantine + debug-assertions instrumentation inflate RSS;
        // give the asan lane more headroom than a plain release build. The
        // http2 variant also runs TLS, which adds ~200 MB of baseline under ASAN.
        const ceilingMB = (isASAN ? 768 : 512) + (http2 ? 256 : 0);
        expect(report.end_memory).toBeLessThanOrEqual(ceilingMB * 1024 * 1024);
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

// The request context and the JS Request each hold a ref on the pooled slot that
// stores a buffered request body. The context used to drop its ref in deinit only.
// A promise that never settles (the handler's, or a response stream's pull())
// defers deinit until GC collects the promise, and VM teardown never runs it, so
// a complete body stored in the slot outlived the per-VM body pool. The context
// now drops its ref as soon as the body is complete, so only the Request keeps
// the bytes alive. The children below exit with such a request parked.
// BUN_DESTRUCT_VM_ON_EXIT frees the pool at exit, so LeakSanitizer reports the
// bytes if a parked context still pins them.
describe.concurrent("buffered request body of a request parked on a promise that never settles", () => {
  const leakCheckedEnv = {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
    LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
  };
  // A small POST body travels in the same packet as the headers, so the server
  // stores it in the same read that invoked fetch(), before it returns to the
  // event loop and can observe the abort or the termination below.
  const body = JSON.stringify("0123456789abcdef");

  async function expectCleanExit(options: { cmd: string[]; cwd?: string }) {
    await using proc = Bun.spawn({
      ...options,
      env: leakCheckedEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  }

  // LSan symbolizes through llvm-symbolizer on failure, which is slow against the
  // debug binary, and the Worker cell spends a few seconds in LSan's exit scan.
  const timeout = 30_000;

  it.skipIf(!isASAN || isWindows)(
    "is freed when the client aborts before the handler settles",
    async () => {
      await expectCleanExit({
        cmd: [
          bunExe(),
          "-e",
          `
            const gotRequest = Promise.withResolvers();
            const server = Bun.serve({
              port: 0,
              fetch() {
                gotRequest.resolve();
                return new Promise(() => {});
              },
            });
            const ac = new AbortController();
            const fetched = fetch(server.url, { method: "POST", body: ${body}, signal: ac.signal }).catch(() => {});
            await gotRequest.promise;
            ac.abort();
            await fetched;
            server.stop(true);
          `,
        ],
      });
    },
    timeout,
  );

  // The handler settles here. The abort reaches the context while it owns a
  // response stream, which is a different branch of the abort path than above.
  it.skipIf(!isASAN || isWindows)(
    "is freed when the client aborts a direct stream response parked in pull()",
    async () => {
      await expectCleanExit({
        cmd: [
          bunExe(),
          "-e",
          `
            const firstChunkSent = Promise.withResolvers();
            const server = Bun.serve({
              port: 0,
              idleTimeout: 0,
              fetch() {
                return new Response(
                  new ReadableStream({
                    type: "direct",
                    async pull(controller) {
                      controller.write("part1");
                      await controller.flush();
                      firstChunkSent.resolve();
                      await new Promise(() => {});
                    },
                  }),
                  { headers: { "Content-Length": "100000" } },
                );
              },
            });
            const ac = new AbortController();
            const fetched = fetch(server.url, { method: "POST", body: ${body}, signal: ac.signal }).catch(() => {});
            await firstChunkSent.promise;
            ac.abort();
            await fetched;
            server.stop(true);
          `,
        ],
      });
    },
    timeout,
  );

  it.skipIf(!isASAN || isWindows)(
    "is freed when the Worker that serves it is terminated",
    async () => {
      using dir = tempDir("serve-body-worker-teardown", {
        "worker.ts": `
          const server = Bun.serve({
            port: 0,
            fetch() {
              // Report from the next task: by then the server has subscribed to
              // the returned promise and stored the body. Reporting synchronously
              // can get the worker terminated before it subscribes, and such a
              // request is torn down on the spot instead of staying parked.
              setImmediate(() => postMessage("request"));
              return new Promise(() => {});
            },
          });
          postMessage(String(server.url));
        `,
        "main.ts": `
          const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
          const message = () => new Promise(resolve => worker.addEventListener("message", e => resolve(e.data), { once: true }));
          const url = await message();
          const requested = message();
          const ac = new AbortController();
          const fetched = fetch(url, { method: "POST", body: ${body}, signal: ac.signal }).catch(() => {});
          await requested;
          await worker.terminate();
          ac.abort();
          await fetched;
        `,
      });
      await expectCleanExit({ cmd: [bunExe(), "main.ts"], cwd: String(dir) });
    },
    timeout,
  );

  // In the cells above the Request is alive when the context drops its ref, so
  // the slot survives the drop. The two cells below collect the Request first, so
  // the context's drop at the last chunk is the one that frees the slot. The
  // first one leaks before this change. The second passes before it as well and
  // pins the order of that drop against the read it resolves from the slot: ASAN
  // reports the read if the drop ever moves ahead of it. The upload is sent by
  // hand so that the request can be held at 16 of 4096 body bytes while the
  // Request is collected.
  function collectedRequestScript({ inHandler, afterCollected }: { inHandler: string; afterCollected: string }) {
    return `
      const handlerRan = Promise.withResolvers();
      const requestCollected = Promise.withResolvers();
      const registry = new FinalizationRegistry(() => requestCollected.resolve());
      const aborted = Promise.withResolvers();
      let text;
      // Kept reachable: the collections below must not collect the handler's
      // promise too, which would unpark the context and let it deinit on abort.
      let parked;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          registry.register(req, "request");
          req.signal.addEventListener("abort", () => aborted.resolve());
          ${inHandler}
          req = undefined;
          handlerRan.resolve();
          return (parked = new Promise(() => {}));
        },
      });
      const body = Buffer.alloc(4096, "x");
      // A socket failure rejects the wait in progress instead of parking the
      // script. One after the last wait no longer matters.
      const socketFailed = Promise.withResolvers();
      socketFailed.promise.catch(() => {});
      const until = promise => Promise.race([promise, socketFailed.promise]);
      const write = (bytes) => {
        const written = socket.write(bytes);
        if (written !== bytes.length) throw new Error("wrote " + written + " of " + bytes.length + " bytes");
        socket.flush();
      };
      const socket = await Bun.connect({
        hostname: server.hostname,
        port: server.port,
        socket: { data() {}, error(_socket, error) { socketFailed.reject(error); } },
      });
      write(Buffer.from("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: " + body.length + "\\r\\n\\r\\n"));
      write(body.subarray(0, 16));
      await until(handlerRan.promise);
      let collected = false;
      requestCollected.promise.then(() => (collected = true));
      for (let i = 0; i < 200 && !collected; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      if (!collected) console.log("the Request was not collected");
      ${afterCollected}
      server.stop(true);
    `;
  }

  it.skipIf(!isASAN || isWindows)(
    "is freed by the last chunk when the Request was collected before it arrived",
    async () => {
      await expectCleanExit({
        cmd: [
          bunExe(),
          "-e",
          collectedRequestScript({
            inHandler: "",
            // The server stores the rest of the body, then sees the FIN behind it.
            afterCollected: `
              write(body.subarray(16));
              socket.end();
              await until(aborted.promise);
            `,
          }),
        ],
      });
    },
    timeout,
  );

  // on_buffered_body_chunk must resolve the pending read from the slot before
  // it drops the slot.
  it.skipIf(!isASAN || isWindows)(
    "resolves a pending read from the last chunk when the Request was collected",
    async () => {
      await expectCleanExit({
        cmd: [
          bunExe(),
          "-e",
          collectedRequestScript({
            inHandler: "text = req.text();",
            afterCollected: `
              write(body.subarray(16));
              const received = await until(text);
              if (received !== body.toString()) console.log("text() resolved with " + received.length + " bytes");
            `,
          }),
        ],
      });
    },
    timeout,
  );
});

// Once the whole body has been stored, the context has no further use for the
// slot, and anything the handler does with the body from then on is between the
// Request and its consumer. While the context still held its ref, finishing the
// response made it error a Locked value that request.body or request.text() had
// created over the complete bytes, as if the body had been cut off.
describe.concurrent("fully buffered request body after the response has been sent", () => {
  const body = "0123456789abcdef";

  // The body arrives in the same packet as the headers and is stored before the
  // server returns to the event loop, so one task hop is enough for it to be
  // complete without consuming it.
  const bodyStored = () => new Promise<void>(resolve => setImmediate(resolve));

  it("request.body taken before responding still yields the body", async () => {
    const captured = Promise.withResolvers<ReadableStream<Uint8Array>>();
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await bodyStored();
        captured.resolve(req.body!);
        return new Response("ack");
      },
    });
    const res = await fetch(server.url, { method: "POST", body });
    expect(await res.text()).toBe("ack");
    expect(await new Response(await captured.promise).text()).toBe(body);
  });

  it("request.text() after responding resolves with the body", async () => {
    const captured = Promise.withResolvers<Request>();
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await bodyStored();
        // The getter is what moves the stored bytes behind a stream.
        expect(req.body).not.toBeNull();
        captured.resolve(req);
        return new Response("ack");
      },
    });
    const res = await fetch(server.url, { method: "POST", body });
    expect(await res.text()).toBe("ack");
    expect(await (await captured.promise).text()).toBe(body);
  });
});
