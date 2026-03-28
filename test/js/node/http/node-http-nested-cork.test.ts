import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// With two cork slots that can be stolen/evicted under contention, a bug in
// slot bookkeeping could cause bytes meant for one socket to end up in another
// socket's response — an attacker could receive another user's data.
//
// These tests write multiple chunks of unique per-request data (tagged with
// request id + chunk index), yield between chunks to maximize interleaving,
// and verify each response contains ONLY its own bytes in exact order.

const N = 32;
const CHUNKS = 6;

// Shared validation: build expected body, compare exactly. Any foreign byte
// from another request will cause a mismatch.
const validate = `
  async function validate(makeUrl) {
    const results = await Promise.all(
      Array.from({ length: ${N} }, async (_, i) => {
        const r = await fetch(makeUrl(i));
        const body = await r.text();
        const headerId = r.headers.get("x-id");
        let expected = "";
        for (let c = 0; c < ${CHUNKS}; c++) expected += "[" + i + ":" + c + "]";
        expected += "[" + i + ":end]";
        if (body !== expected) return { i, ok: false, reason: "body", got: body, want: expected };
        if (headerId !== String(i)) return { i, ok: false, reason: "header", got: headerId };
        return { i, ok: true };
      })
    );
    const bad = results.filter(r => !r.ok);
    console.log(bad.length ? "FAIL " + JSON.stringify(bad) : "PASS " + results.length);
  }
`;

const chainAwait = `
  let pending, count = 0;
  async function chainAwait() {
    count++;
    if (pending) { const p = pending; pending = Promise.withResolvers(); p.resolve(); }
    else pending = Promise.withResolvers();
    if (count === ${N}) pending.resolve();
    await pending.promise;
  }
`;

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(`PASS ${N}`);
  expect(exitCode).toBe(0);
}

describe("cork buffer: no cross-socket data bleed", () => {
  test("node:http — chunks back-to-back", async () => {
    await run(`
      import { createServer } from "node:http";
      ${validate}
      ${chainAwait}
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < ${CHUNKS}; c++) res.write("[" + id + ":" + c + "]");
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  test("node:http — await sleep(0) between every chunk", async () => {
    await run(`
      import { createServer } from "node:http";
      ${validate}
      ${chainAwait}
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < ${CHUNKS}; c++) {
          res.write("[" + id + ":" + c + "]");
          await Bun.sleep(0);
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  test("node:http — write before AND after await (slot held with data across yield)", async () => {
    await run(`
      import { createServer } from "node:http";
      ${validate}
      ${chainAwait}
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        res.write("[" + id + ":0]");
        res.write("[" + id + ":1]");
        await Promise.resolve();
        res.write("[" + id + ":2]");
        await Bun.sleep(0);
        for (let c = 3; c < ${CHUNKS}; c++) res.write("[" + id + ":" + c + "]");
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  test("node:http — nested awaits at every chunk (max interleave)", async () => {
    await run(`
      import { createServer } from "node:http";
      ${validate}
      ${chainAwait}
      const server = createServer(async (req, res) => {
        const id = req.url.slice(1);
        await chainAwait();
        res.writeHead(200, { "x-id": id });
        for (let c = 0; c < ${CHUNKS}; c++) {
          res.write("[" + id + ":" + c + "]");
          await Promise.resolve();
          await Promise.resolve();
        }
        res.end("[" + id + ":end]");
      }).listen(0, async () => {
        await validate(i => "http://localhost:" + server.address().port + "/" + i);
        server.close();
      });
    `);
  });

  test("Bun.serve — buffered Response (single body string)", async () => {
    await run(`
      ${validate}
      ${chainAwait}
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          let body = "";
          for (let c = 0; c < ${CHUNKS}; c++) body += "[" + id + ":" + c + "]";
          body += "[" + id + ":end]";
          return new Response(body, { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  test("Bun.serve — ReadableStream pull source with sleep(0) between chunks", async () => {
    await run(`
      ${validate}
      ${chainAwait}
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          let c = 0;
          const stream = new ReadableStream({
            async pull(ctrl) {
              if (c < ${CHUNKS}) {
                ctrl.enqueue(new TextEncoder().encode("[" + id + ":" + c + "]"));
                c++;
                await Bun.sleep(0);
              } else {
                ctrl.enqueue(new TextEncoder().encode("[" + id + ":end]"));
                ctrl.close();
              }
            },
          });
          return new Response(stream, { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  test('Bun.serve — ReadableStream type: "direct" with sleep(0) between chunks', async () => {
    await run(`
      ${validate}
      ${chainAwait}
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          const stream = new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < ${CHUNKS}; c++) {
                ctrl.write("[" + id + ":" + c + "]");
                await Bun.sleep(0);
              }
              ctrl.write("[" + id + ":end]");
              ctrl.close();
            },
          });
          return new Response(stream, { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  test('Bun.serve — ReadableStream type: "direct" back-to-back writes then flush', async () => {
    await run(`
      ${validate}
      ${chainAwait}
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          const stream = new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              for (let c = 0; c < ${CHUNKS}; c++) ctrl.write("[" + id + ":" + c + "]");
              ctrl.write("[" + id + ":end]");
              await ctrl.flush();
              ctrl.close();
            },
          });
          return new Response(stream, { headers: { "x-id": id } });
        },
      });
      await validate(i => "http://localhost:" + server.port + "/" + i);
      server.stop(true);
    `);
  });

  test("Bun.serve — async generator with await between every yield", async () => {
    await run(`
      ${validate}
      ${chainAwait}
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const id = new URL(req.url).pathname.slice(1);
          await chainAwait();
          async function* gen() {
            for (let c = 0; c < ${CHUNKS}; c++) {
              yield "[" + id + ":" + c + "]";
              await Bun.sleep(0);
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
});
