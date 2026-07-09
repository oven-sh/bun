// When an async fetch handler rejects and error() returns a Response whose
// body is a ReadableStream, the stream must be allowed to finish.
// Previously handle_reject() fell through to render_missing() while the sink
// was still pumping, which force-ended the exchange after the first
// synchronous chunk (or with an empty Content-Length: 0 body if the stream's
// first pull awaited before enqueuing).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const CHUNK = Buffer.alloc(64, "P").toString();
const CHUNKS = 12;
const FULL = Buffer.alloc(64 * CHUNKS, "P").toString();

function chunkedBody() {
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i++ < CHUNKS) {
        c.enqueue(CHUNK);
        await Bun.sleep(4);
      } else {
        c.close();
      }
    },
  });
}

function lazyBody() {
  return new ReadableStream({
    async pull(c) {
      await Bun.sleep(10);
      c.enqueue(CHUNK);
      c.close();
    },
  });
}

function directBody() {
  return new ReadableStream({
    type: "direct",
    async pull(c) {
      for (let i = 0; i < CHUNKS; i++) {
        c.write(CHUNK);
        await c.flush();
        await Bun.sleep(4);
      }
      await c.end();
    },
  } as any);
}

async function* iteratorBody() {
  for (let i = 0; i < CHUNKS; i++) {
    yield CHUNK;
    await Bun.sleep(4);
  }
}

describe("Bun.serve error() returning a streaming Response", () => {
  const routes: Record<string, (req: Request) => Response | Promise<Response>> = {
    // Control: sync throw from the handler (was already correct).
    "/sync": () => {
      throw new Error("boom");
    },
    // The bug: async handler rejects.
    "/async": () =>
      (async () => {
        throw new Error("boom");
      })(),
    "/reject": () => Promise.reject(new Error("boom")),
    // A stream whose first pull awaits before its first enqueue. Without the
    // fix the client received `Content-Length: 0` and an empty body.
    "/lazy": () =>
      (async () => {
        throw new Error("lazy");
      })(),
    "/direct": () =>
      (async () => {
        throw new Error("direct");
      })(),
    "/iter": () =>
      (async () => {
        throw new Error("iter");
      })(),
  };

  async function run(path: string) {
    await using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const u = new URL(req.url);
        const handler = routes[u.pathname];
        if (handler) return handler(req);
        return new Response(chunkedBody(), { status: 200 });
      },
      error(e) {
        const msg = String((e as Error).message);
        if (msg === "lazy") return new Response(lazyBody(), { status: 597 });
        if (msg === "direct") return new Response(directBody(), { status: 597 });
        if (msg === "iter") return new Response(iteratorBody() as any, { status: 597 });
        return new Response(chunkedBody(), {
          status: 597,
          headers: { "x-err": msg },
        });
      },
    });

    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    const body = await res.text();
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }

  test.concurrent("control: plain streaming response completes", async () => {
    const r = await run("/plain");
    expect({ status: r.status, body: r.body }).toEqual({ status: 200, body: FULL });
  });

  test.concurrent("control: sync throw -> error() stream completes", async () => {
    const r = await run("/sync");
    expect({ status: r.status, body: r.body, xerr: r.headers["x-err"] }).toEqual({
      status: 597,
      body: FULL,
      xerr: "boom",
    });
  });

  test.concurrent("async reject -> error() stream completes (pull ReadableStream)", async () => {
    const r = await run("/async");
    expect({ status: r.status, body: r.body, xerr: r.headers["x-err"] }).toEqual({
      status: 597,
      body: FULL,
      xerr: "boom",
    });
  });

  test.concurrent("Promise.reject -> error() stream completes", async () => {
    const r = await run("/reject");
    expect({ status: r.status, body: r.body, xerr: r.headers["x-err"] }).toEqual({
      status: 597,
      body: FULL,
      xerr: "boom",
    });
  });

  test.concurrent("async reject -> error() stream whose first pull awaits is not emptied", async () => {
    const r = await run("/lazy");
    expect({ status: r.status, body: r.body }).toEqual({ status: 597, body: CHUNK });
  });

  test.concurrent("async reject -> error() direct stream completes", async () => {
    const r = await run("/direct");
    expect({ status: r.status, body: r.body }).toEqual({ status: 597, body: FULL });
  });

  test.concurrent("async reject -> error() async-iterator body completes", async () => {
    const r = await run("/iter");
    expect({ status: r.status, body: r.body }).toEqual({ status: 597, body: FULL });
  });

  // With Connection: close the premature end frees the socket while the
  // orphaned stream keeps writing. Under ASAN this is a heap-use-after-free in
  // uws_res_has_responded. Run in a subprocess so a crash is observable.
  test.concurrent("async reject + Connection: close does not crash the server", async () => {
    const src = /* js */ `
      const CHUNK = Buffer.alloc(64, "P").toString();
      const CHUNKS = 12;
      function body() {
        let i = 0;
        return new ReadableStream({
          async pull(c) { if (i++ < CHUNKS) { c.enqueue(CHUNK); await Bun.sleep(4); } else c.close(); },
        });
      }
      const server = Bun.serve({
        port: 0,
        development: false,
        fetch: async () => { throw new Error("boom"); },
        error: () => new Response(body(), { status: 597 }),
      });
      const res = await fetch("http://127.0.0.1:" + server.port + "/x", {
        headers: { Connection: "close" },
      });
      const text = await res.text();
      process.stdout.write(JSON.stringify({ status: res.status, len: text.length }));
      // Give the orphaned producer (pre-fix) time to write to the freed socket.
      await Bun.sleep(100);
      server.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, Malloc: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: stdout, exitCode, stderr }).toEqual({
      out: JSON.stringify({ status: 597, len: 64 * CHUNKS }),
      exitCode: 0,
      stderr: "",
    });
  });
});
