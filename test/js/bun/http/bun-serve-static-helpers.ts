import type { Server } from "bun";
import { expect } from "bun:test";
import { fillRepeating, isASAN, isDebug, isWindows, rss } from "harness";

// /big is 4MB so that the first send() cannot drain the body in one write: the
// static-route sender has to take the to_async + on_writable backpressure loop
// (see StaticRoute::do_render_blob). Smaller payloads can complete synchronously
// on loopback and would skip that path.
export const routes = {
  "/foo": new Response("foo", {
    headers: {
      "Content-Type": "text/plain",
      "X-Foo": "bar",
    },
  }),
  "/big": new Response(
    (() => {
      const buf = Buffer.alloc(1024 * 1024 * 4);
      const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_*^!@#$%^&*()+=?><:;{}[]|\\ \n";

      function randomAnyCaseLetter() {
        return alphabet.charCodeAt((Math.random() * alphabet.length) | 0);
      }

      for (let i = 0; i < 1024; i++) {
        buf[i] = randomAnyCaseLetter();
      }
      fillRepeating(buf, 0, 1024);
      return buf;
    })(),
  ),
  "/redirect": Response.redirect("/foo/bar", 302),
  "/foo/bar": new Response("/foo/bar", {
    headers: {
      "Content-Type": "text/plain",
      "X-Foo": "bar",
    },
  }),
  "/redirect/fallback": Response.redirect("/foo/bar/fallback", 302),
};

export const static_responses: Record<string, Blob> = {};
for (const [path, response] of Object.entries(routes)) {
  static_responses[path] = await response.clone().blob();
}

export const stressPaths = ["/foo", "/big", "/foo/bar"] as const;
export const stressMethods = ["arrayBuffer", "blob", "bytes", "text"] as const;

const checkedHeaders = ["content-type", "content-length", "transfer-encoding", "x-foo", "etag"];

function pickHeaders(headers: Headers): Record<string, string | null> {
  return Object.fromEntries(checkedHeaders.map(name => [name, headers.get(name)] as const));
}

// toEqual does not read Blob contents: two Blobs of different bytes (or sizes)
// compare equal. Expand a Blob so that the comparison covers its bytes. Blob.type
// is left out: the buffered and the streamed body paths derive it differently.
async function comparable(body: ArrayBuffer | Blob | Uint8Array | string) {
  if (body instanceof Blob) {
    return { size: body.size, bytes: await body.bytes() };
  }
  return body;
}

// macOS limits the listen backlog to 128, so one batch is 64 concurrent requests.
const batchSize = isWindows ? 8 : 64;
// The warm-up batch opens fetch's keep-alive connections; the measured batches
// reuse them. A leak of one body per request on /big adds 64 * 4MB = 256MB of
// RSS per measured batch. The bound sits between that signal and the noise of
// rss(): mimalloc returns freed memory to the OS about 100ms after the free
// (purge_delay), so one release reading can still include a batch of buffers
// that the other reading does not. Observed post-GC deltas on /big: within
// +-270MB on the release lanes (leak signal 1GB at 4 batches), within +-55MB
// under ASAN, whose allocator has no purge delay (leak signal 512MB at 2
// batches). The 8-wide Windows batches put the signal (128MB, 64MB) under
// either bound, so this check is only a sanity bound there, as it was before.
const measuredBatches = isASAN || isDebug ? 2 : 4;
const rssDeltaBoundMB = isASAN || isDebug ? 192 : 512;

export async function runStress(
  server: Server,
  path: (typeof stressPaths)[number],
  accessBody: boolean,
  method: (typeof stressMethods)[number],
) {
  const route = routes[path];
  const blob = static_responses[path];
  const url = new URL(path, server.url).href;
  const expectedResponse = {
    status: 200,
    url,
    headers: {
      "content-type": route.headers.get("Content-Type"),
      "content-length": String(blob.size),
      "transfer-encoding": null,
      "x-foo": route.headers.get("X-Foo"),
      "etag": expect.stringMatching(/^"[0-9a-f]+"$/),
    },
    bodyUsed: true,
    body: await comparable(method === "blob" ? blob : await blob[method]()),
  };

  // A batch reports its first failure once every request in it has finished.
  // After that failure the other responses only drain their bodies: a failing
  // toEqual on a 4MB body takes about 0.3s in release and 16s under ASAN, so 63
  // more of them would turn the failure into a timeout.
  let failure: { error: unknown } | undefined;

  async function request() {
    try {
      const res = await fetch(url);
      if (accessBody) {
        // Materialize the ReadableStream first; res[method]() then has to drain
        // the stream instead of taking the buffered-body fast path.
        expect(res.body).toBeInstanceOf(ReadableStream);
      }
      const body = await comparable(await res[method]());
      if (failure) return;
      expect({
        status: res.status,
        url: res.url,
        headers: pickHeaders(res.headers),
        bodyUsed: res.bodyUsed,
        body,
      }).toEqual(expectedResponse);
    } catch (error) {
      failure ??= { error };
    }
  }

  async function batch() {
    await Promise.all(Array.from({ length: batchSize }, request));
    if (failure) throw failure.error;
    // A static route releases its request before the last bytes reach the
    // client (StaticRoute::on_response_complete), so nothing is pending here.
    expect(server.pendingRequests).toBe(0);
    Bun.gc(true);
  }

  await batch();
  const baselineMB = rss() / 1024 / 1024;
  for (let i = 0; i < measuredBatches; i++) {
    await batch();
  }
  const deltaMB = Math.round(rss() / 1024 / 1024 - baselineMB);
  console.log(`${path} ${method} RSS delta: ${deltaMB}MB`);
  expect(deltaMB).toBeLessThan(rssDeltaBoundMB);
}
