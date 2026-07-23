import { expect } from "bun:test";
import type { Server } from "bun";
import { fillRepeating, isASAN, isDebug, isWindows } from "harness";

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

export async function runStress(
  server: Server,
  path: (typeof stressPaths)[number],
  accessBody: boolean,
  method: (typeof stressMethods)[number],
) {
  const bytes = method === "blob" ? static_responses[path] : await static_responses[path][method]();
  const expectedLength = String(static_responses[path].size);

  // macOS limits backlog to 128.
  const batchSize = Math.ceil(64 / (isWindows ? 8 : 1));
  // Debug/ASAN builds run the fetch loop ~10x slower than release; one warmup +
  // measurement round at 64-wide still exercises the backpressure path on every
  // /big request, and the delta assertion below catches a per-request body leak
  // in a single measurement pass (64 * 4MB = 256MB >> threshold).
  const iterations = Math.ceil((isASAN || isDebug ? 4 : 12) / (isWindows ? 8 : 1));

  async function iterate() {
    let array = new Array(batchSize);
    const route = `${server.url}${path.substring(1)}`;
    for (let i = 0; i < batchSize; i++) {
      array[i] = fetch(route)
        .then(res => {
          expect(res.status).toBe(200);
          expect(res.url).toBe(route);
          expect(res.headers.get("Content-Length")).toBe(expectedLength);
          if (accessBody) {
            res.body;
          }
          return res[method]();
        })
        .then(output => {
          expect(output).toStrictEqual(bytes);
        });
    }

    await Promise.all(array);

    Bun.gc();
  }

  for (let i = 0; i < iterations; i++) {
    await iterate();
  }

  Bun.gc(true);
  const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  let lastRSS = baseline;
  console.log("Start RSS", baseline);
  for (let i = 0; i < iterations; i++) {
    await iterate();
    const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    if (lastRSS + 50 < rss) {
      console.log("RSS Growth", rss - lastRSS);
    }
    lastRSS = rss;
  }
  Bun.gc(true);

  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  const delta = rss - baseline;
  console.log("Final RSS", rss);
  console.log("Delta RSS", delta);
  // ASAN's shadow memory + quarantine raise the absolute RSS floor.
  expect(rss).toBeLessThan(isASAN ? 6144 : 4092);
  if (isASAN || isDebug) {
    // With the reduced iteration count the absolute ceiling alone would miss a
    // per-request body leak on the first /big case (4 iter * 64 * 4MB = 1GB is
    // well under 6GB). Under ASAN the post-gc delta is stable within tens of
    // MB, so bound it directly; release keeps 12 iterations where the ceiling
    // is sufficient and mimalloc jitter on /big makes a tight delta flaky.
    expect(delta).toBeLessThan(192);
  }
}
