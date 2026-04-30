import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Security test: with two cork slots that can be stolen/evicted, a bug in slot
// bookkeeping could cause bytes meant for socket A to land in socket B's
// response. An attacker could receive another user's data.
//
// These tests are adversarial: they deliberately interleave writes across many
// concurrent requests using every yield primitive (microtask, macrotask, mixed)
// to maximize slot churn. Every chunk is tagged [reqId:chunkIdx] and responses
// are validated byte-for-byte so a single foreign byte fails the test.

const N = 32;
const CHUNKS = 8;

const harness = `
  const N = ${N};
  const CHUNKS = ${CHUNKS};

  // Chain-await: each request resolves the previous one's promise, forcing
  // microtask resumption while a newer request holds a cork slot.
  let pending, count = 0;
  async function chainAwait() {
    count++;
    if (pending) { const p = pending; pending = Promise.withResolvers(); p.resolve(); }
    else pending = Promise.withResolvers();
    if (count === N) pending.resolve();
    await pending.promise;
  }

  // Mixed yield: alternates microtask and macrotask to hit both the
  // drainMicrotasks path and the event loop tick path.
  async function yieldMixed(c) {
    if (c % 3 === 0) await 42;              // microtask (awaiting non-thenable)
    else if (c % 3 === 1) await Bun.sleep(0); // macrotask
    else { await 42; await 42; }            // double microtask
  }

  async function validate(makeUrl) {
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const r = await fetch(makeUrl(i));
        const body = await r.text();
        const headerId = r.headers.get("x-id");
        let expected = "";
        for (let c = 0; c < CHUNKS; c++) expected += "[" + i + ":" + c + "]";
        expected += "[" + i + ":end]";
        if (body !== expected) return { i, ok: false, reason: "body", got: body, want: expected };
        if (headerId !== String(i)) return { i, ok: false, reason: "header", got: headerId };
        return { i, ok: true };
      })
    );
    const bad = results.filter(r => !r.ok);
    console.log(bad.length ? "FAIL " + JSON.stringify(bad.slice(0, 3)) : "PASS " + results.length);
  }
`;

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", harness + script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(`PASS ${N}`);
  expect(exitCode).toBe(0);
}

describe.concurrent("cork buffer: no cross-socket data bleed", () => {
  // Attack 1: write, yield, write — slot held with data across yield.
  // Another request resumes during the yield and tries to steal/use our slot.
  test("node:http — write then mixed yield then write (slot held with data)", async () => {
    await run(`
      import { createServer } from "node:http";
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write("[" + id + ":" + c + "]");
          await yieldMixed(c);
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  // Attack 2: yield BEFORE each write. Our slot is empty (stealable) at every
  // yield point, then we try to write after someone may have taken it.
  test("node:http — yield then write (empty slot stolen, must re-acquire)", async () => {
    await run(`
      import { createServer } from "node:http";
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          await yieldMixed(c);
          res.write("[" + id + ":" + c + "]");
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  // Attack 3: rapid microtask churn — every chunk yields twice via await 42.
  // Maximizes the number of slot-steal opportunities per request.
  test("node:http — double microtask between every chunk", async () => {
    await run(`
      import { createServer } from "node:http";
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write("[" + id + ":" + c + "]");
          await 42;
          await 42;
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  // Attack 4: write several chunks, yield, write more. Tests that partial
  // buffered data survives slot eviction and doesn't leak into the evictor.
  test("node:http — burst write, yield, burst write", async () => {
    await run(`
      import { createServer } from "node:http";
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        const half = CHUNKS >> 1;
        for (let c = 0; c < half; c++) res.write("[" + id + ":" + c + "]");
        await Bun.sleep(0);
        for (let c = half; c < CHUNKS; c++) res.write("[" + id + ":" + c + "]");
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  // Attack 5: Bun.serve buffered Response — the whole body is one string,
  // but the interleaved awaits before returning stress slot allocation for
  // the headers + body write.
  test("Bun.serve — buffered Response with await before return", async () => {
    await run(`
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          await 42;
          await Bun.sleep(0);
          let body = "";
          for (let c = 0; c < CHUNKS; c++) body += "[" + id + ":" + c + "]";
          body += "[" + id + ":end]";
          return new Response(body, { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  // Attack 6: type:"direct" with write+yield per chunk. Direct streams write
  // straight to the socket via the cork path.
  test('Bun.serve — type:"direct" write then mixed yield', async () => {
    await run(`
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          return new Response(new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < CHUNKS; c++) {
                ctrl.write("[" + id + ":" + c + "]");
                await yieldMixed(c);
              }
              ctrl.write("[" + id + ":end]");
              await ctrl.end();
            },
          }), { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  // Attack 7: type:"direct" yield then write. Slot is empty at yield, we must
  // re-cork before each write.
  test('Bun.serve — type:"direct" yield then write', async () => {
    await run(`
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          return new Response(new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < CHUNKS; c++) {
                await yieldMixed(c);
                ctrl.write("[" + id + ":" + c + "]");
              }
              ctrl.write("[" + id + ":end]");
              await ctrl.end();
            },
          }), { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  // Attack 8: type:"direct" burst + flush + yield + burst. Explicit flush
  // mid-stream exercises the uncork/recork path.
  test('Bun.serve — type:"direct" burst, flush, yield, burst', async () => {
    await run(`
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          return new Response(new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              const half = CHUNKS >> 1;
              for (let c = 0; c < half; c++) ctrl.write("[" + id + ":" + c + "]");
              await ctrl.flush();
              await Bun.sleep(0);
              for (let c = half; c < CHUNKS; c++) ctrl.write("[" + id + ":" + c + "]");
              ctrl.write("[" + id + ":end]");
              await ctrl.end();
            },
          }), { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  // Attack 9: async generator with mixed yields — every other chunk uses a
  // different yield primitive.
  test("Bun.serve — async generator mixed yield per chunk", async () => {
    await run(`
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          async function* gen() {
            for (let c = 0; c < CHUNKS; c++) {
              yield "[" + id + ":" + c + "]";
              await yieldMixed(c);
            }
            yield "[" + id + ":end]";
          }
          return new Response(gen(), { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  // Attack 10: node:http with large chunks near the 16KB cork buffer boundary.
  // If offset math is wrong, a large chunk could overflow into the adjacent
  // slot's buffer.
  test("node:http — large chunks near cork buffer boundary", async () => {
    await run(`
      import { createServer } from "node:http";
      // ~2KB per chunk * 8 chunks = ~16KB total, hovering at cork buffer size
      const pad = Buffer.alloc(2000, 0x2e).toString(); // "."
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < CHUNKS; c++) {
          res.write("[" + id + ":" + c + "]" + pad);
          await 42;
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        const results = await Promise.all(
          Array.from({ length: N }, async (_, i) => {
            const r = await fetch("http://localhost:" + server.address().port + "/" + i);
            const body = await r.text();
            let expected = "";
            for (let c = 0; c < CHUNKS; c++) expected += "[" + i + ":" + c + "]" + pad;
            expected += "[" + i + ":end]";
            return body === expected && r.headers.get("x-id") === String(i)
              ? { i, ok: true }
              : { i, ok: false, got: body.slice(0, 100), want: expected.slice(0, 100) };
          })
        );
        const bad = results.filter(r => !r.ok);
        console.log(bad.length ? "FAIL " + JSON.stringify(bad.slice(0, 3)) : "PASS " + results.length);
        server.close();
      });
    `);
  });
});
