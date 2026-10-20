// What a fetch() Response holds of a body nothing reads is native memory that stays until a
// collection finds the Response dead, and the collector paces itself by what it is told. So the
// Response answers for those bytes until a reader takes the body. (What the transport does about
// such a body is in fetch-backpressure.test.ts.)
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import { createSecureServer, type ServerHttp2Stream } from "node:http2";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { Worker } from "node:worker_threads";
import { brotliCompressSync, gzipSync } from "node:zlib";

// BODY_HIGH_WATER_MARK (src/http/Signals.rs): what a client stages of a body nothing reads.
const MARK = 256 * 1024;

// One event-loop turn: an fs round trip.
const turn = () => stat(import.meta.path);
// Turns until `done()`. The bound is there so that a failure says what it saw.
async function turnsUntil(done: () => boolean) {
  for (let turns = 0; turns < 2000 && !done(); turns++) await turn();
}
// Turns for something that must not happen: there is no event to wait on.
async function someTurns() {
  for (let turns = 0; turns < 64; turns++) await turn();
}

// The head of every response at once, then its body: "A" repeated, sent as `encoding`. With `hold`
// the body waits for release(). With `sends`, the origin goes quiet after that much of it.
async function h1Origin(length: number, { hold = false, encoding = "", sends = length } = {}) {
  const plain = Buffer.alloc(length, 65);
  const whole = encoding === "br" ? brotliCompressSync(plain) : plain;
  const body = whole.subarray(0, sends);
  const head =
    `HTTP/1.1 200 OK\r\nContent-Length: ${whole.length}\r\n` +
    (encoding ? `Content-Encoding: ${encoding}\r\n` : "") +
    "\r\n";
  const held: Socket[] = [];
  const sockets = new Set<Socket>();
  const srv = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      socket.write(head);
      if (hold) held.push(socket);
      else socket.write(body);
    });
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    release() {
      for (const socket of held.splice(0)) socket.write(body);
    },
    [Symbol.asyncDispose]: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => srv.close(resolve));
    },
  };
}

// The head of every response at once. The body comes in the pieces the test writes, all within the
// client's stream window, so each piece arrives whether or not anything reads.
async function h2Origin() {
  const streams: ServerHttp2Stream[] = [];
  const sockets = new Set<Socket>();
  const srv = createSecureServer({ ...tls, allowHTTP1: false });
  srv.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  srv.on("stream", (stream: ServerHttp2Stream) => {
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
    streams.push(stream);
  });
  srv.listen(0);
  await once(srv, "listening");
  const { port } = srv.address() as AddressInfo;
  return {
    url: `https://localhost:${port}/`,
    write(length: number) {
      for (const stream of streams) stream.write(Buffer.alloc(length, 65));
    },
    end() {
      for (const stream of streams.splice(0)) stream.end();
    },
    [Symbol.asyncDispose]: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => srv.close(resolve));
    },
  };
}

// estimateShallowMemoryUsageOf() reads what a Response tells the collector. `answersFor` is what
// that figure gained since the Response came back from fetch().
describe.concurrent("fetch(): a Response answers for the body bytes that wait unread", () => {
  // The transport stops at the mark, and the Response answers for what waits there.
  async function parked(res: Response, touched = false) {
    const untouched = estimateShallowMemoryUsageOf(res);
    const answersFor = () => estimateShallowMemoryUsageOf(res) - untouched;
    if (touched) void res.body;
    await turnsUntil(() => answersFor() >= MARK);
    expect(answersFor()).toBeGreaterThanOrEqual(MARK);
    return answersFor;
  }

  const takers: [string, (res: Response) => Promise<number>][] = [
    ["res.bytes()", res => res.bytes().then(bytes => bytes.length)],
    [
      "a reader of res.body",
      async res => {
        let received = 0;
        for await (const chunk of res.body!) received += chunk.length;
        return received;
      },
    ],
    [
      "HTMLRewriter.transform(res)",
      res =>
        new HTMLRewriter()
          .on("x", {})
          .transform(res)
          .bytes()
          .then(bytes => bytes.length),
    ],
  ];

  for (const touched of [false, true]) {
    const held = touched ? "behind a res.body nothing reads" : "Response held untouched";

    for (const [taker, take] of touched ? takers.slice(0, 1) : takers) {
      test(`a long body, ${held}: the Response answers for what waits, until ${taker} takes it`, async () => {
        const LENGTH = 8 * MARK;
        await using origin = await h1Origin(LENGTH);
        const res = await fetch(origin.url);
        const answersFor = await parked(res, touched);
        const taken = take(res);
        // The taker has the body from here on, before it has read any of it.
        const atTake = answersFor();
        expect({ atTake, received: await taken, answersFor: answersFor() }).toEqual({
          atTake: 0,
          received: LENGTH,
          answersFor: 0,
        });
      });
    }

    test(`a long body, ${held}: an abort ends what the Response answers for`, async () => {
      await using origin = await h1Origin(8 * MARK);
      const controller = new AbortController();
      const res = await fetch(origin.url, { signal: controller.signal });
      const answersFor = await parked(res, touched);
      controller.abort();
      await turnsUntil(() => answersFor() === 0);
      expect(answersFor()).toBe(0);
    });

    test(`an HTTP/1.1 body that ends after the head, ${held}: the Response answers for all of it`, async () => {
      const LENGTH = MARK / 2;
      await using origin = await h1Origin(LENGTH, { hold: true });
      const res = await fetch(origin.url);
      const untouched = estimateShallowMemoryUsageOf(res);
      const answersFor = () => estimateShallowMemoryUsageOf(res) - untouched;
      if (touched) void res.body;
      origin.release();
      await turnsUntil(() => answersFor() >= LENGTH);
      expect(answersFor()).toBe(LENGTH);
    });

    test(`an HTTP/2 body that comes in two parts, ${held}: the Response answers for each part, until res.bytes() takes it`, async () => {
      await using origin = await h2Origin();
      const res = await fetch(origin.url, { protocol: "http2", tls: { rejectUnauthorized: false } } as RequestInit);
      const untouched = estimateShallowMemoryUsageOf(res);
      const answersFor = () => estimateShallowMemoryUsageOf(res) - untouched;
      if (touched) void res.body;
      origin.write(2 * MARK);
      await turnsUntil(() => answersFor() >= 2 * MARK);
      const first = answersFor();
      // The body is still open: the figure has to grow with it.
      origin.write(2 * MARK);
      await turnsUntil(() => answersFor() >= 4 * MARK);
      const second = answersFor();
      origin.end();
      expect({ first, second, received: (await res.bytes()).length, answersFor: answersFor() }).toEqual({
        first: 2 * MARK,
        second: 4 * MARK,
        received: 4 * MARK,
        answersFor: 0,
      });
    });
  }

  test("a long body behind a res.body nothing reads: res.body.cancel() ends what the Response answers for", async () => {
    await using origin = await h1Origin(8 * MARK);
    const res = await fetch(origin.url);
    const answersFor = await parked(res, true);
    await res.body!.cancel();
    expect(answersFor()).toBe(0);
  });

  test("a long body behind a res.body nothing reads, from an origin that goes quiet: the Response answers for what came", async () => {
    const SENT = MARK + MARK / 4;
    await using origin = await h1Origin(8 * MARK, { sends: SENT });
    const res = await fetch(origin.url);
    const answersFor = await parked(res, true);
    expect(answersFor()).toBe(SENT);
  });

  test("a long body: a reader that comes late, takes one chunk and stalls is not charged for what parks behind it", async () => {
    await using origin = await h1Origin(8 * MARK);
    const res = await fetch(origin.url);
    const answersFor = await parked(res);
    const reader = res.body!.getReader();
    const first = await reader.read();
    const afterFirstRead = answersFor();
    await someTurns();
    expect({ first: first.value!.length > 0, afterFirstRead, later: answersFor() }).toEqual({
      first: true,
      afterFirstRead: 0,
      later: 0,
    });
    await reader.cancel();
  });

  test("a long body: a reader that waited for the body, takes one chunk and stalls is not charged", async () => {
    await using origin = await h1Origin(8 * MARK, { hold: true });
    const res = await fetch(origin.url);
    const untouched = estimateShallowMemoryUsageOf(res);
    const answersFor = () => estimateShallowMemoryUsageOf(res) - untouched;
    const reader = res.body!.getReader();
    const waiting = reader.read();
    origin.release();
    const first = await waiting;
    // What came with that chunk and did not fit it is in the stream, behind the reader.
    const afterFirstRead = answersFor();
    await someTurns();
    expect({ first: first.value!.length > 0, afterFirstRead, later: answersFor() }).toEqual({
      first: true,
      afterFirstRead: 0,
      later: 0,
    });
    await reader.cancel();
  });

  test("a br body: the Response answers for what is decoded and waits, until res.bytes() takes it", async () => {
    const LENGTH = 8 * MARK;
    await using origin = await h1Origin(LENGTH, { encoding: "br" });
    const res = await fetch(origin.url);
    const answersFor = await parked(res);
    expect({ received: (await res.bytes()).length, answersFor: answersFor() }).toEqual({
      received: LENGTH,
      answersFor: 0,
    });
  });
});

// A program that only looks at the status needs its Responses collected to get their bytes,
// connections and request slots back. These programs allocate next to nothing on the JS heap and
// run with the idle collection off, so a collection happens only when the collector has heard of
// the bytes each Response holds. One at a time: this process is the origin of each, and a debug
// build serves several of them at once too slowly.
describe.serial("fetch(): dropped Responses with unread bodies are collected", () => {
  // Longer than a client takes before it pauses (the mark, and the reads underway), so a body that
  // comes right behind its head is in flight, held back, by the time its Response exists.
  const LONG = Buffer.alloc(8 * MARK, 65);
  // A Response with a held-back body reports 256 KiB or more. In a heap this small a collection
  // starts once 8 MiB were reported (largeHeapSize, ZigGlobalObject.cpp): after 32 of them at most.
  const LIMIT = 96;

  // Runs `request` (the body of an async function: what holds the Response, and the status) up to
  // LIMIT times, until one of the holders is collected.
  async function dropper(request: string, origin: { url: URL }, env: Record<string, string> = {}) {
    const program = `
      const url = ${JSON.stringify(origin.url.href)};
      const dropped = [];
      async function request() {
        ${request}
      }
      // Its own frame, so that nothing here still refers to a Response once its status is read.
      async function statusOnly() {
        const [holder, status] = await request();
        dropped.push(new WeakRef(holder));
        return status;
      }
      const collected = () => dropped.some(ref => !ref.deref());
      for (let i = 0; i < ${LIMIT} && !collected(); i++) {
        if ((await statusOnly()) !== 200) throw new Error("not 200");
      }
      // A body can come in after its Response was dropped, and a collection takes a moment.
      // No more requests from here on.
      for (const deadline = performance.now() + 2000; !collected() && performance.now() < deadline; ) {
        await Bun.sleep(10);
      }
      console.log(collected() ? "collected" : "all ${LIMIT} are still alive");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const collected = { stdout: "collected\n", stderr: "", exitCode: 0 };
  const statusOnly = `const res = await fetch(url); return [res, res.status];`;

  // [what the program does, one request, environment]
  const droppers: [string, string, Record<string, string>][] = [
    ["res.status of a long body", statusOnly, {}],
    [
      "res.status of a long body behind a res.body nothing reads",
      `const res = await fetch(url); void res.body; return [res, res.status];`,
      {},
    ],
    // A collection then sweeps every dead Response before the report that started it returns.
    // By default that happens to a few of them.
    ["res.status of a long body, every collection sweeping at once", statusOnly, { BUN_JSC_sweepSynchronously: "1" }],
  ];
  for (const [name, request, env] of droppers) {
    test(`${name}: a dropped Response is collected within ${LIMIT} requests`, async () => {
      await using origin = Bun.serve({ port: 0, fetch: () => new Response(LONG) });
      expect(await dropper(request, origin, env)).toEqual(collected);
    });
  }

  // The client holds a gzip body that arrived whole undecoded until something reads it
  // (hold_for_consumer, src/http/lib.rs). Such a Response holds a connection and a request slot,
  // and next to no bytes that the collector could hear of.
  test.todo(
    `res.status of a gzip body that arrives whole: a dropped Response is collected within ${LIMIT} requests`,
    async () => {
      const gzip = gzipSync(LONG);
      await using origin = Bun.serve({
        port: 0,
        fetch: () => new Response(gzip, { headers: { "Content-Encoding": "gzip" } }),
      });
      expect(await dropper(statusOnly, origin)).toEqual(collected);
    },
  );
});

// The head of a long body finds the transport already held back when the thread was busy while
// the body came in. It then queues a task that counts the unread body after the caller's turn.
// Here the caller's turn ends the thread, with that task still queued. One at a time, as above.
describe.serial("fetch(): a thread that ends before its unread body is counted", () => {
  const LONG = Buffer.alloc(8 * MARK, 65);
  // `url` is the origin.
  const head = `
    const pending = fetch(url);
    Bun.sleepSync(100);
    const res = await pending;
    if (res.status !== 200) throw new Error("not 200");
  `;

  test("process.exit() in the continuation", async () => {
    await using origin = Bun.serve({ port: 0, fetch: () => new Response(LONG) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const url = process.argv.at(-1); ${head} console.log("head"); process.exit(0);`,
        origin.url.href,
      ],
      // Tears the thread's VM down at exit, as the end of a worker does.
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "head\n", stderr: "", exitCode: 0 });
  });

  // [how the worker ends, the end of its continuation, its exit code]
  const workers: [string, string, number][] = [
    ["process.exit() in a worker's continuation", `process.exit(0);`, 0],
    ["terminate() of a worker that is busy in the continuation", `parentPort.postMessage("head"); for (;;) {}`, 1],
  ];
  for (const [name, ending, exitCode] of workers) {
    test(name, async () => {
      await using origin = Bun.serve({ port: 0, fetch: () => new Response(LONG) });
      const worker = new Worker(
        `const { parentPort, workerData: url } = require("node:worker_threads"); (async () => { ${head} ${ending} })();`,
        { eval: true, workerData: origin.url.href },
      );
      worker.once("message", () => worker.terminate());
      expect(await once(worker, "exit")).toEqual([exitCode]);
    });
  }
});
