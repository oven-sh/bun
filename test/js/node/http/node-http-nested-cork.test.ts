import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Security test: with two cork slots that can be stolen/evicted, a bug in slot
// bookkeeping could cause bytes meant for socket A to land in socket B's
// response. An attacker could receive another user's data.
//
// These tests are adversarial: they deliberately interleave writes across many
// concurrent requests using every yield primitive (microtask, macrotask, mixed)
// to maximize slot churn. Every chunk is tagged [reqId:chunkIdx] and responses
// are validated byte-for-byte so a single foreign byte fails the test.
//
// All cases run in-process and concurrently, so every server's sockets compete
// for the same two process-wide cork slots — strictly more contention than the
// original one-subprocess-per-case version.

const N = 32;
const CHUNKS = 8;

// Chain-await barrier: each incoming request resolves the previous request's
// promise, so handlers resume via microtask while a newer request holds a cork
// slot. Returns a fresh barrier per server so concurrent tests don't interfere.
function makeChainAwait() {
  let pending: PromiseWithResolvers<void> | undefined;
  let count = 0;
  return async function chainAwait() {
    count++;
    if (pending) {
      const p = pending;
      pending = Promise.withResolvers();
      p.resolve();
    } else {
      pending = Promise.withResolvers();
    }
    if (count === N) pending.resolve();
    await pending.promise;
  };
}

// Mixed yield: alternates microtask and macrotask to hit both the
// drainMicrotasks path and the event loop tick path. Awaiting a non-thenable
// is a pure microtask; Bun.sleep(0) is a macrotask; the third arm doubles the
// microtask to widen the resume window.
async function yieldMixed(c: number) {
  if (c % 3 === 0) return await 42;
  if (c % 3 === 1) return await Bun.sleep(0);
  await 42;
  await 42;
}

function expectedBody(i: number, pad = "") {
  let s = "";
  for (let c = 0; c < CHUNKS; c++) s += `[${i}:${c}]${pad}`;
  return s + `[${i}:end]`;
}

type Result = { i: number; header: string | null; body: string };

async function validate(makeUrl: (i: number) => string, pad = "") {
  const results: Result[] = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const r = await fetch(makeUrl(i));
      return { i, header: r.headers.get("x-id"), body: await r.text() };
    }),
  );
  // One structural assertion so a single foreign byte anywhere fails with a
  // diff that names the offending request.
  expect(results).toEqual(Array.from({ length: N }, (_, i) => ({ i, header: String(i), body: expectedBody(i, pad) })));
}

async function withNodeServer(
  handler: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void,
  fn: (port: number) => Promise<void>,
) {
  const server = createServer(handler);
  server.listen(0);
  await once(server, "listening");
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}

describe.concurrent("cork buffer: no cross-socket data bleed", () => {
  // Attack 1: write, yield, write — slot held with data across yield.
  // Another request resumes during the yield and tries to steal/use our slot.
  test("node:http — write then mixed yield then write (slot held with data)", async () => {
    const chainAwait = makeChainAwait();
    await withNodeServer(
      async (req, res) => {
        const id = req.url!.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write(`[${id}:${c}]`);
          await yieldMixed(c);
        }
        res.end(`[${id}:end]`);
      },
      port => validate(i => `http://localhost:${port}/${i}`),
    );
  });

  // Attack 2: yield BEFORE each write. Our slot is empty (stealable) at every
  // yield point, then we try to write after someone may have taken it.
  test("node:http — yield then write (empty slot stolen, must re-acquire)", async () => {
    const chainAwait = makeChainAwait();
    await withNodeServer(
      async (req, res) => {
        const id = req.url!.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          await yieldMixed(c);
          res.write(`[${id}:${c}]`);
        }
        res.end(`[${id}:end]`);
      },
      port => validate(i => `http://localhost:${port}/${i}`),
    );
  });

  // Attack 3: rapid microtask churn — every chunk yields twice via await 42.
  // Maximizes the number of slot-steal opportunities per request.
  test("node:http — double microtask between every chunk", async () => {
    const chainAwait = makeChainAwait();
    await withNodeServer(
      async (req, res) => {
        const id = req.url!.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write(`[${id}:${c}]`);
          await 42;
          await 42;
        }
        res.end(`[${id}:end]`);
      },
      port => validate(i => `http://localhost:${port}/${i}`),
    );
  });

  // Attack 4: write several chunks, yield, write more. Tests that partial
  // buffered data survives slot eviction and doesn't leak into the evictor.
  test("node:http — burst write, yield, burst write", async () => {
    const chainAwait = makeChainAwait();
    await withNodeServer(
      async (req, res) => {
        const id = req.url!.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        const half = CHUNKS >> 1;
        for (let c = 0; c < half; c++) res.write(`[${id}:${c}]`);
        await Bun.sleep(0);
        for (let c = half; c < CHUNKS; c++) res.write(`[${id}:${c}]`);
        res.end(`[${id}:end]`);
      },
      port => validate(i => `http://localhost:${port}/${i}`),
    );
  });

  // Attack 5: Bun.serve buffered Response — the whole body is one string,
  // but the interleaved awaits before returning stress slot allocation for
  // the headers + body write.
  test("Bun.serve — buffered Response with await before return", async () => {
    const chainAwait = makeChainAwait();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        await chainAwait();
        await 42;
        await Bun.sleep(0);
        return new Response(expectedBody(+id), { headers: { "x-id": id } });
      },
    });
    await validate(i => `http://localhost:${server.port}/${i}`);
  });

  // Attack 6: type:"direct" with write+yield per chunk. Direct streams write
  // straight to the socket via the cork path.
  test('Bun.serve — type:"direct" write then mixed yield', async () => {
    const chainAwait = makeChainAwait();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        await chainAwait();
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < CHUNKS; c++) {
                ctrl.write(`[${id}:${c}]`);
                await yieldMixed(c);
              }
              ctrl.write(`[${id}:end]`);
              await ctrl.end();
            },
          }),
          { headers: { "x-id": id } },
        );
      },
    });
    await validate(i => `http://localhost:${server.port}/${i}`);
  });

  // Attack 7: type:"direct" yield then write. Slot is empty at yield, we must
  // re-cork before each write.
  test('Bun.serve — type:"direct" yield then write', async () => {
    const chainAwait = makeChainAwait();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        await chainAwait();
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < CHUNKS; c++) {
                await yieldMixed(c);
                ctrl.write(`[${id}:${c}]`);
              }
              ctrl.write(`[${id}:end]`);
              await ctrl.end();
            },
          }),
          { headers: { "x-id": id } },
        );
      },
    });
    await validate(i => `http://localhost:${server.port}/${i}`);
  });

  // Attack 8: type:"direct" burst + flush + yield + burst. Explicit flush
  // mid-stream exercises the uncork/recork path.
  test('Bun.serve — type:"direct" burst, flush, yield, burst', async () => {
    const chainAwait = makeChainAwait();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        await chainAwait();
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              const half = CHUNKS >> 1;
              for (let c = 0; c < half; c++) ctrl.write(`[${id}:${c}]`);
              await ctrl.flush();
              await Bun.sleep(0);
              for (let c = half; c < CHUNKS; c++) ctrl.write(`[${id}:${c}]`);
              ctrl.write(`[${id}:end]`);
              await ctrl.end();
            },
          }),
          { headers: { "x-id": id } },
        );
      },
    });
    await validate(i => `http://localhost:${server.port}/${i}`);
  });

  // Attack 9: async generator with mixed yields — every other chunk uses a
  // different yield primitive.
  test("Bun.serve — async generator mixed yield per chunk", async () => {
    const chainAwait = makeChainAwait();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const id = new URL(req.url).pathname.slice(1);
        await chainAwait();
        async function* gen() {
          for (let c = 0; c < CHUNKS; c++) {
            yield `[${id}:${c}]`;
            await yieldMixed(c);
          }
          yield `[${id}:end]`;
        }
        return new Response(gen(), { headers: { "x-id": id } });
      },
    });
    await validate(i => `http://localhost:${server.port}/${i}`);
  });

  // Attack 10: node:http with large chunks near the 16KB cork buffer boundary.
  // If offset math is wrong, a large chunk could overflow into the adjacent
  // slot's buffer.
  test("node:http — large chunks near cork buffer boundary", async () => {
    // ~2KB per chunk * 8 chunks = ~16KB total, hovering at cork buffer size
    const pad = Buffer.alloc(2000, 0x2e).toString(); // "."
    const chainAwait = makeChainAwait();
    await withNodeServer(
      async (req, res) => {
        const id = req.url!.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write(`[${id}:${c}]${pad}`);
          await 42;
        }
        res.end(`[${id}:end]`);
      },
      port => validate(i => `http://localhost:${port}/${i}`, pad),
    );
  });
});
