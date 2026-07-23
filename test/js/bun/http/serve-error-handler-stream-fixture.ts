// Fixture for serve-error-handler-stream.test.ts.
// Starts one server whose error() returns a streaming Response, exercises every
// (path × Connection header) combination against it, and prints the observed
// {status, len, pulls} for each case as a JSON array. Runs in a subprocess so
// an ASAN crash (the pre-fix UAF in uws_res_has_responded) is observed as a
// test failure instead of killing the parent test runner before junit is
// written.

const CHUNK = Buffer.alloc(64, "P").toString();
const CHUNKS = 12;
let pulls = 0;

// Bun.sleep(0) is setTimeout(fn, 0): it yields to the next macrotask, which is
// all that is needed for the sink's pump promise to be observed as Pending and
// reach do_render_stream's / handle_reject's Pending branch.
const tick = () => Bun.sleep(0);

function chunkedBody() {
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      pulls++;
      if (i++ < CHUNKS) {
        c.enqueue(CHUNK);
        await tick();
      } else {
        c.close();
      }
    },
  });
}

function lazyBody() {
  return new ReadableStream({
    async pull(c) {
      pulls++;
      await tick();
      c.enqueue(CHUNK);
      c.close();
    },
  });
}

function directBody() {
  return new ReadableStream({
    type: "direct",
    async pull(c: any) {
      for (let i = 0; i < CHUNKS; i++) {
        pulls++;
        c.write(CHUNK);
        await c.flush();
        await tick();
      }
      await c.end();
    },
  } as any);
}

async function* iteratorBody() {
  for (let i = 0; i < CHUNKS; i++) {
    pulls++;
    yield CHUNK;
    await tick();
  }
}

const server = Bun.serve({
  port: 0,
  development: false,
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/sync") throw new Error("boom");
    if (p === "/async")
      return (async () => {
        throw new Error("boom");
      })();
    if (p === "/reject") return Promise.reject(new Error("boom"));
    if (p === "/lazy")
      return (async () => {
        throw new Error("lazy");
      })();
    if (p === "/direct")
      return (async () => {
        throw new Error("direct");
      })();
    if (p === "/iter")
      return (async () => {
        throw new Error("iter");
      })();
    return new Response(chunkedBody(), { status: 200 });
  },
  error(e) {
    const msg = String((e as Error).message);
    if (msg === "lazy") return new Response(lazyBody(), { status: 597 });
    if (msg === "direct") return new Response(directBody(), { status: 597 });
    if (msg === "iter") return new Response(iteratorBody() as any, { status: 597 });
    return new Response(chunkedBody(), { status: 597 });
  },
});

const cases = [
  // Controls: neither path hits handle_reject()'s fallthrough.
  { path: "/plain", close: false },
  { path: "/sync", close: false },
  // The bug: async handler rejects, error() body is truncated to its
  // synchronous prefix. Run keep-alive before Connection: close so a UAF
  // on the close path doesn't mask earlier results.
  { path: "/async", close: false },
  { path: "/reject", close: false },
  { path: "/lazy", close: false },
  { path: "/direct", close: false },
  { path: "/iter", close: false },
  { path: "/async", close: true },
  { path: "/reject", close: true },
  { path: "/lazy", close: true },
  { path: "/direct", close: true },
  { path: "/iter", close: true },
];

const results: { path: string; close: boolean; status: number; len: number; pulls: number }[] = [];
for (const { path, close } of cases) {
  pulls = 0;
  const headers: Record<string, string> = close ? { Connection: "close" } : {};
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers });
  const body = await res.text();
  results.push({ path, close, status: res.status, len: body.length, pulls });
}
// Let any orphaned producer (pre-fix) write to the freed socket.
await Bun.sleep(20);
process.stdout.write(JSON.stringify(results));
server.stop(true);
