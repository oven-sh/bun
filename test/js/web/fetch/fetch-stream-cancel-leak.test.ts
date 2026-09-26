import type { Socket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// A fetch() body stream that is cancelled, abandoned, or handed to a Bun.serve response whose
// client leaves has to let go of the transfer behind it:
// - reader.cancel() / body.cancel() release the stream (the tasklet once held a Strong ref to it
//   that nothing cleared) and abort the connection, also when nothing ever read the body;
// - a stream nothing reads parks once it holds PARK_BYTES, so an abandoned one is collected and
//   its fetch is aborted (before, the fetch rooted its own stream and buffered the body without
//   bound);
// - a body proxied into a Bun.serve response is aborted once that response's client is gone.
// Every test owns its servers, so they all run concurrently. Each wait is on the event that proves
// the outcome (the origin saw its socket close, the stream was collected), with DEADLINE_MS as the
// ceiling for the failing case only.
const DEADLINE_MS = isASAN || isDebug ? 15_000 : 3000;

const CHUNK = 64 * 1024;
// What fetch buffers of a body nothing reads before it parks the stream (BODY_HIGH_WATER_MARK).
const PARK_BYTES = 256 * 1024;
const HEAD = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";
const FRAME = Buffer.concat([Buffer.from(`${CHUNK.toString(16)}\r\n`), Buffer.alloc(CHUNK, "x"), Buffer.from("\r\n")]);

type Conn = { started: boolean; frames: number; pending: Uint8Array | null; stalled: PromiseWithResolvers<void> };

// A raw HTTP/1.1 origin. Every response is a chunked body of `frames` chunks that never ends (no
// terminal chunk), so every close the origin sees is the client's. Frames go out one per turn of
// the event loop: the turn in between is when the client hands received bytes to its stream, and a
// tight loop would fill the socket before the stream could park.
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
    // The kernel did not take the whole write: the client stopped reading. Within the first
    // PARK_BYTES that cannot be the park, since the stream has to hold that much first; it is the
    // socket slow to take its first packets, and a drain follows.
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
    // The client of the latest connection stopped taking the body: it parked (the socket stopped
    // taking writes), the frames ran out, or it went away.
    stalled: () => conns[conns.length - 1].stalled.promise,
    // The same for every connection so far.
    allStalled: () => Promise.all(conns.map(conn => conn.stalled.promise)).then(() => {}),
    [Symbol.dispose]: () => server.stop(true),
  };
}

// Polls `condition` once per turn of the event loop until it holds or DEADLINE_MS pass. With `gc`,
// every poll starts with a full collection: what the condition waits for is several hops past it
// (the sweep runs the finalizer, the abort is a message to the HTTP thread, and the origin sees
// the close on its own socket). The caller asserts the condition's facts afterwards.
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
    // Its own frame, so that nothing on this one still refers to a response afterwards.
    async function cancelOne() {
      const response = await fetch(server.url);
      streams.push(new WeakRef(response.body!));
      const reader = response.body!.getReader();
      await reader.read();
      await cancel(reader, response.body!);
    }
    for (let i = 0; i < N; i++) await cancelOne();

    // Cancel aborts the transfer: the origin sees each connection close.
    await waitFor(() => server.closed() === N);
    // Nothing holds the streams any more, so a collection takes all of them. Before, the fetch kept
    // a Strong ref to each cancelled stream.
    await waitFor(() => alive(streams) === 0, { gc: true });
    expect({ closed: server.closed(), alive: alive(streams) }).toEqual({ closed: N, alive: 0 });
  });
}

test.concurrent("response.body.cancel() on a never-read body aborts the underlying fetch", async () => {
  // Cancelling an unread response body must abort the native transfer, not resolve while the client
  // keeps draining. Runs in a subprocess so the unbounded stream and RSS growth in the failing case
  // are contained and cleaned up on exit.
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
                    // 128 MiB past the cancel: the client is draining, stop before it eats the memory.
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

// Nothing holds the body any more, so it has to go away: once the unread bytes reach PARK_BYTES the
// fetch parks the stream (stops rooting it), the stream is collected, and the fetch behind it is
// aborted, in whatever state it was dropped. Before, the fetch rooted its own stream until the body
// ended and buffered the rest of it, so against a body that does not end, the stream, the
// connection, and the buffered bytes all lived until the process exited.
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
    // The read takes what the parked stream holds, which unparks it: the transfer resumes, the
    // stream fills up and parks again, and the drop has to collect it from there.
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
      // 4 MiB per body: more than loopback socket buffers take once the client stops reading, so
      // the origin stalls on backpressure. Finite, so a build that keeps draining stays bounded.
      using server = origin(64);
      const N = 20;
      // Its own frame, so that nothing on this one still refers to a response afterwards.
      async function abandonOne() {
        await shape(await fetch(server.url), server.stalled);
      }
      for (let i = 0; i < N; i++) await abandonOne();

      // Every body reached the client and stopped moving: the stream parked (or, on a build that
      // drains, the frames ran out). Only then collect, so that no collection competes with the
      // transfers for the event loop.
      await server.allStalled();
      // Unfixed, none of the connections close: the streams stay rooted.
      await waitFor(() => server.closed() === N, { gc: true });
      expect(server.closed()).toBe(N);
    });
  }
});

// A fetch body handed to something that takes it natively, here a `Bun.serve` response that
// proxies it. When that response's own client goes away, the fetch behind the body has to be
// aborted with it: the body is locked to the response, so nothing else can read the rest.
// Before, the response only let go of the body, and the fetch sat paused on its connection
// (one upstream connection leaked per proxy client that went away).
describe.concurrent("a proxied fetch body is aborted once the response's client is gone", () => {
  const shapes: [string, (upstream: Response) => Response][] = [
    // Goes through the JS pump; passes before and after, it is here so both spellings stay covered.
    ["new Response(upstream.body)", upstream => new Response(upstream.body)],
    // The native pipe.
    ["the upstream Response itself", upstream => upstream],
  ];

  function chain(proxyResponse: (upstream: Response) => Response) {
    // 32 MiB per body: finite, so a build that keeps draining runs out of data and stays bounded.
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

      // Unfixed, the upstream connection stays open, paused.
      await waitFor(() => servers.upstream.closed() === 1);
      expect(servers.upstream.closed()).toBe(1);
    });

    test(`${name}, client leaves without reading`, async () => {
      using servers = chain(proxyResponse);

      const client = new AbortController();
      const res = await fetch(servers.proxy.url, { signal: client.signal });
      expect(res.status).toBe(200);
      // Nothing reads: the chain backpressures end to end and the upstream's socket stops taking
      // writes (or, on a build that drains, the upstream runs out of data).
      await servers.upstream.stalled();
      client.abort();
      await servers.clientGone;

      await waitFor(() => servers.upstream.closed() === 1);
      expect(servers.upstream.closed()).toBe(1);
    });
  }
});
