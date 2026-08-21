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

const fallbackBody = "fallback";
const fallbackBlob = new Blob([fallbackBody]);

// One instance per stress file. Every request for a path without a static
// route lands in the fetch handler, which counts it.
export class StressServer {
  fallbackCalls = 0;
  readonly server = Bun.serve({
    static: routes,
    port: 0,
    fetch: () => {
      this.fallbackCalls++;
      return new Response(fallbackBody, { status: 404 });
    },
  });

  constructor() {
    this.server.unref();
  }

  stop() {
    this.server.stop(true);
  }
}

// "/missing" has no static route: it proves that the static matcher does not
// capture other paths under load, and that the handler count below is exact.
export const stressPaths = ["/foo", "/big", "/foo/bar", "/missing"] as const;
export const stressMethods = ["arrayBuffer", "blob", "bytes", "text"] as const;

type StressPath = (typeof stressPaths)[number];
type StressMethod = (typeof stressMethods)[number];

interface PathExpectation {
  status: number;
  blob: Blob;
  servedByFallback: boolean;
  headers: Record<string, string | null>;
}

function expectationFor(path: StressPath): PathExpectation {
  const route = (routes as Record<string, Response>)[path];
  if (route) {
    const blob = static_responses[path];
    return {
      status: 200,
      blob,
      servedByFallback: false,
      headers: {
        "content-type": route.headers.get("Content-Type"),
        "x-foo": route.headers.get("X-Foo"),
        "content-length": String(blob.size),
        "transfer-encoding": null,
        "etag": expect.stringMatching(/^"[0-9a-f]+"$/),
      },
    };
  }

  return {
    status: 404,
    blob: fallbackBlob,
    servedByFallback: true,
    headers: {
      "content-type": "text/plain;charset=utf-8",
      "x-foo": null,
      "content-length": String(fallbackBlob.size),
      "transfer-encoding": null,
      "etag": null,
    },
  };
}

function pickHeaders(headers: Headers, names: string[]): Record<string, string | null> {
  return Object.fromEntries(names.map(name => [name, headers.get(name)] as const));
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
// +-215MB in release (leak signal 1GB at 4 batches), -49MB to +29MB under ASAN,
// whose allocator has no purge delay (leak signal 512MB at 2 batches).
const measuredBatches = isASAN || isDebug ? 2 : 4;
const rssDeltaBoundMB = isASAN || isDebug ? 192 : 512;

export async function runStress(stress: StressServer, path: StressPath, accessBody: boolean, method: StressMethod) {
  const expected = expectationFor(path);
  const url = new URL(path, stress.server.url).href;
  const headerNames = Object.keys(expected.headers);
  const expectedResponse = {
    status: expected.status,
    url,
    redirected: false,
    headers: expected.headers,
    bodyUsed: true,
    body: await comparable(method === "blob" ? expected.blob : await expected.blob[method]()),
  };

  // The first mismatch rejects the batch. The responses still in flight then
  // skip their comparison: diffing a 4MB body costs hundreds of ms per response,
  // and 63 of them would run on into the next test.
  let failed = false;

  async function request() {
    const res = await fetch(url);
    if (accessBody) {
      // Materialize the ReadableStream first; res[method]() then has to drain
      // the stream instead of taking the buffered-body fast path.
      expect(res.body).toBeInstanceOf(ReadableStream);
    }
    const body = await comparable(await res[method]());
    if (failed) return;
    try {
      expect({
        status: res.status,
        url: res.url,
        redirected: res.redirected,
        headers: pickHeaders(res.headers, headerNames),
        bodyUsed: res.bodyUsed,
        body,
      }).toEqual(expectedResponse);
    } catch (error) {
      failed = true;
      throw error;
    }
  }

  async function batch() {
    await Promise.all(Array.from({ length: batchSize }, request));
    Bun.gc(true);
  }

  const fallbackCallsBefore = stress.fallbackCalls;

  await batch();
  const baselineMB = rss() / 1024 / 1024;
  for (let i = 0; i < measuredBatches; i++) {
    await batch();
  }
  const deltaMB = Math.round(rss() / 1024 / 1024 - baselineMB);
  console.log(`${path} ${method} RSS delta: ${deltaMB}MB`);

  const requests = batchSize * (1 + measuredBatches);
  expect(stress.fallbackCalls - fallbackCallsBefore).toBe(expected.servedByFallback ? requests : 0);
  expect(deltaMB).toBeLessThan(rssDeltaBoundMB);
}
