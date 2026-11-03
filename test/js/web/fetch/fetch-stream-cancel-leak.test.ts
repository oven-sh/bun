import type { Socket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import type { ReadableStreamDefaultReader } from "node:stream/web";

// A fetch() body stream that is cancelled, abandoned, or proxied to a client that leaves has to
// release the transfer behind it. Every test owns its servers, so they all run concurrently.
// DEADLINE_MS only bounds the failing case.
const DEADLINE_MS = isASAN || isDebug ? 15_000 : 3000;

const CHUNK = 64 * 1024;
// What fetch buffers of a body nothing reads before it parks the stream (BODY_HIGH_WATER_MARK).
const PARK_BYTES = 256 * 1024;
const HEAD = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";
const FRAME = Buffer.concat([Buffer.from(`${CHUNK.toString(16)}\r\n`), Buffer.alloc(CHUNK, "x"), Buffer.from("\r\n")]);

type Conn = { started: boolean; frames: number; pending: Uint8Array | null; stalled: PromiseWithResolvers<void> };

// A raw HTTP/1.1 origin. Every response is a chunked body of `frames` chunks with no terminal
// chunk, so every close the origin sees came from the client. It writes one frame per event loop
// turn, because a tight loop would fill the socket before the client's stream could park.
function origin(frames: number) {
  let closed = 0;
  const conns: Conn[] = [];

  function pump(socket: Socket<Conn>) {
    const conn = socket.data;
    if (conn.frames === frames) return conn.stalled.resolve();
    const n = socket.write(FRAME);
    if (n < 0) return;
    conn.frames++;
    if (n === FRAME.length) return void setImmediate(pump, socket);
    conn.pending = FRAME.subarray(n);
    // A partial write means the client stopped reading. The stream can't park before it holds
    // PARK_BYTES, so an earlier partial write is just a slow start and a drain follows.
    if (conn.frames * CHUNK > PARK_BYTES) conn.stalled.resolve();
  }

  const server = Bun.listen<Conn>({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      open(socket) {
        socket.data = { started: false, frames: 0, pending: null, stalled: Promise.withResolvers<void>() };
        conns.push(socket.data);
      },
      data(socket) {
        if (socket.data.started) return;
        socket.data.started = true;
        socket.write(HEAD);
        pump(socket);
      },
      drain(socket) {
        const conn = socket.data;
        if (conn.pending) {
          const n = socket.write(conn.pending);
          if (n < conn.pending.length) {
            if (n > 0) conn.pending = conn.pending.subarray(n);
            return;
          }
          conn.pending = null;
        }
        pump(socket);
      },
      close(socket) {
        closed++;
        socket.data.stalled.resolve();
      },
      error() {},
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/`,
    closed: () => closed,
    // Resolves once the latest connection's client parked, left, or got every frame.
    stalled: () => conns[conns.length - 1].stalled.promise,
    allStalled: () => Promise.all(conns.map(conn => conn.stalled.promise)).then(() => {}),
    [Symbol.dispose]: () => server.stop(true),
  };
}

// Polls `condition` until it returns true or DEADLINE_MS pass. With `gc`, every poll starts with a
// full collection. The caller asserts the outcome afterwards.
async function waitFor(condition: () => boolean, { gc = false } = {}) {
  const deadline = performance.now() + DEADLINE_MS;
  while (true) {
    if (gc) Bun.gc(true);
    if (condition() || performance.now() >= deadline) return;
    await Bun.sleep(1);
  }
}

const alive = (refs: WeakRef<object>[]) => refs.filter(ref => ref.deref() !== undefined).length;

const cancels: [string, (reader: ReadableStreamDefaultReader, body: ReadableStream) => Promise<void>][] = [
  ["reader.cancel()", reader => reader.cancel()],
  [
    "body.cancel()",
    (reader, body) => {
      reader.releaseLock();
      return body.cancel();
    },
  ],
];
for (const [name, cancel] of cancels) {
  test.concurrent(`ReadableStream from fetch is collected after ${name}`, async () => {
    using server = origin(1);
    const N = 30;
    const streams: WeakRef<ReadableStream>[] = [];
    // Its own function, so the response goes out of scope after each iteration.
    async function cancelOne() {
      const response = await fetch(server.url);
      streams.push(new WeakRef(response.body!));
      const reader = response.body!.getReader();
      await reader.read();
      await cancel(reader, response.body!);
    }
    for (let i = 0; i < N; i++) await cancelOne();

    // Cancelling aborts the transfer, so the origin sees each connection close.
    await waitFor(() => server.closed() === N);
    await waitFor(() => alive(streams) === 0, { gc: true });
    expect({ closed: server.closed(), alive: alive(streams) }).toEqual({ closed: N, alive: 0 });
  });
}

test.concurrent("response.body.cancel() on a never-read body aborts the underlying fetch", async () => {
  // Runs in a subprocess to contain the unbounded stream and RSS growth of the failing case.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let pulls = 0;
        const firstPull = Promise.withResolvers();
        const aborted = Promise.withResolvers();
        const runaway = Promise.withResolvers();
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            req.signal.addEventListener("abort", () => aborted.resolve("aborted"));
            return new Response(
              new ReadableStream(
                {
                  pull(c) {
                    if (++pulls === 1) firstPull.resolve();
                    // 128 MiB in, the client is clearly still draining.
                    if (pulls === 2000) runaway.resolve("runaway");
                    c.enqueue(new Uint8Array(65536));
                  },
                },
                new CountQueuingStrategy({ highWaterMark: 1 }),
              ),
            );
          },
        });
        const res = await fetch(server.url);
        // Let the server start pushing so the client has buffered bytes it never asked for.
        await firstPull.promise;
        await res.body.cancel(new Error("nope"));
        // Once the cancel reaches the transport the server sees the abort.
        const outcome = await Promise.race([aborted.promise, runaway.promise, Bun.sleep(${DEADLINE_MS}).then(() => "timeout")]);
        console.log(JSON.stringify({ outcome }));
        server.stop(true);
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ outcome: "aborted" });
  expect(exitCode).toBe(0);
});

// Once the unread bytes reach PARK_BYTES the fetch parks the stream (stops rooting it), so an
// abandoned stream is collected and its fetch is aborted, in whatever state it was dropped.
describe.concurrent("an abandoned fetch body stream is collected and its fetch is aborted", () => {
  const shapes: [string, (res: Response, stalled: () => Promise<void>) => Promise<unknown>][] = [
    ["res.body touched", async res => res.body],
    [
      "one read(), then releaseLock()",
      async res => {
        const reader = res.body!.getReader();
        await reader.read();
        reader.releaseLock();
      },
    ],
    ["dropped while a reader holds the lock", res => res.body!.getReader().read()],
    // The read drains the parked stream and unparks it. The transfer resumes and it parks again.
    [
      "one read() after it parked",
      async (res, stalled) => {
        void res.body;
        await stalled();
        await res.body!.getReader().read();
      },
    ],
  ];

  for (const [name, shape] of shapes) {
    test(name, async () => {
      // 4 MiB per body is more than loopback socket buffers hold, so the origin stalls on backpressure.
      using server = origin(64);
      const N = 20;
      // Its own function, so the response goes out of scope after each iteration.
      async function abandonOne() {
        await shape(await fetch(server.url), server.stalled);
      }
      for (let i = 0; i < N; i++) await abandonOne();

      // Collect only after every stream parked.
      await server.allStalled();
      await waitFor(() => server.closed() === N, { gc: true });
      // A few can survive a collection through stale stack slots (conservative scanning);
      // the rest must go. Unfixed, none of them do.
      expect(N - server.closed()).toBeLessThan(N / 4);
    });
  }
});

// A `Bun.serve` response that proxies a fetch body locks it, so nothing else can read the rest.
// When that response's client leaves, the upstream fetch has to be aborted too.
describe.concurrent("a proxied fetch body is aborted once the response's client is gone", () => {
  const shapes: [string, (upstream: Response) => Response][] = [
    // The JS pump.
    ["new Response(upstream.body)", upstream => new Response(upstream.body)],
    // The native pipe.
    ["the upstream Response itself", upstream => upstream],
  ];

  function chain(proxyResponse: (upstream: Response) => Response) {
    const upstream = origin(512);
    const clientGone = Promise.withResolvers<void>();
    const proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        req.signal.addEventListener("abort", () => clientGone.resolve());
        return proxyResponse(await fetch(upstream.url));
      },
    });
    return {
      upstream,
      proxy,
      clientGone: clientGone.promise,
      [Symbol.dispose]() {
        proxy.stop(true);
        upstream[Symbol.dispose]();
      },
    };
  }

  for (const [name, proxyResponse] of shapes) {
    test(`${name}, client leaves while reading`, async () => {
      using servers = chain(proxyResponse);

      const client = new AbortController();
      const res = await fetch(servers.proxy.url, { signal: client.signal });
      const { value } = await res.body!.getReader().read();
      expect(value!.byteLength).toBeGreaterThan(0);
      client.abort();
      await servers.clientGone;

      await waitFor(() => servers.upstream.closed() === 1);
      expect(servers.upstream.closed()).toBe(1);
    });

    test(`${name}, client leaves without reading`, async () => {
      using servers = chain(proxyResponse);

      const client = new AbortController();
      const res = await fetch(servers.proxy.url, { signal: client.signal });
      expect(res.status).toBe(200);
      // Nothing reads, so backpressure reaches the upstream and its socket stops taking writes.
      await servers.upstream.stalled();
      client.abort();
      await servers.clientGone;

      await waitFor(() => servers.upstream.closed() === 1);
      expect(servers.upstream.closed()).toBe(1);
    });
  }
});
