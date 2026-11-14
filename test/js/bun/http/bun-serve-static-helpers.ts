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

// toEqual doesn't read Blob contents, so expand a Blob into its size and bytes. Blob.type is left out
// because the buffered and the streamed body paths derive it differently.
async function comparable(body: ArrayBuffer | Blob | Uint8Array | string) {
  if (body instanceof Blob) {
    return { size: body.size, bytes: await body.bytes() };
  }
  return body;
}

// macOS limits the listen backlog to 128, so one batch is 64 concurrent requests.
const batchSize = isWindows ? 8 : 64;
// One leaked body per request on /big adds 64 * 4MB = 256MB of RSS per measured batch: 1GB on release,
// 512MB on ASAN/debug. The 8-wide Windows batches leak less than either bound, so the RSS check can't
// catch a leak there.
const measuredBatches = isASAN || isDebug ? 2 : 4;
const rssDeltaBoundMB = isASAN || isDebug ? 192 : 512;

export async function runStress(
  server: Server<undefined>,
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

  // A batch reports its first failure after all its requests finish. The other responses skip the
  // comparison: a failing toEqual on a 4MB body takes 16s under ASAN, so 63 more would time out.
  let failure: { error: unknown } | undefined;

  async function request() {
    try {
      const res = await fetch(url);
      if (accessBody) {
        // Creates the ReadableStream, so res[method]() drains it instead of taking the buffered fast path.
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
    // A static route releases its request before the last bytes reach the client.
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
