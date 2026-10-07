// Fixture for serve-error-handler-stream.test.ts.
// Runs a server whose error() returns a streaming Response, issues one request
// to the given path, and prints {status, len, pulls} to stdout. The test
// asserts the full body was received. Runs in a subprocess so an ASAN crash
// (the pre-fix UAF in uws_res_has_responded) is observed as a test failure
// instead of killing the parent test runner before junit is written.

const [path, closeHeader] = process.argv.slice(2);

const CHUNK = Buffer.alloc(64, "P").toString();
const CHUNKS = 12;
let pulls = 0;

function chunkedBody() {
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      pulls++;
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
      pulls++;
      await Bun.sleep(10);
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
        await Bun.sleep(4);
      }
      await c.end();
    },
  } as any);
}

async function* iteratorBody() {
  for (let i = 0; i < CHUNKS; i++) {
    pulls++;
    yield CHUNK;
    await Bun.sleep(4);
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

const headers: Record<string, string> = {};
if (closeHeader === "close") headers.Connection = "close";

const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers });
const body = await res.text();
// Let any orphaned producer (pre-fix) write to the freed socket.
await Bun.sleep(100);
process.stdout.write(JSON.stringify({ status: res.status, len: body.length, pulls }));
server.stop(true);
