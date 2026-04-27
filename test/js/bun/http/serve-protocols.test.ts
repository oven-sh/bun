/**
 * Protocol-agnostic Bun.serve coverage. Each block is written once and run
 * for every entry in `httpProtocols()` — currently HTTP/1.1 (native fetch)
 * and HTTP/3 (curl --http3-only via fetchH3). The H3 row only appears when
 * an H3-capable curl is on PATH, so the file passes everywhere.
 *
 * Shape borrowed from h2o's t/40http3/test.pl: hello-world, large file
 * round-trip with checksum, POST echoes at several sizes, headers, status.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { fetchH3, hasFetchH3 } from "./fetch-h3";

type Proto = "http/1.1" | "http/3";

const cases: Array<{
  protocol: Proto;
  fetch: (url: string | URL, init?: any) => Promise<Response>;
  scheme: "https" | "http";
  serve: { tls?: typeof tls; h3?: boolean };
}> = [{ protocol: "http/1.1", fetch, scheme: "http", serve: {} }];

if (hasFetchH3()) {
  cases.push({ protocol: "http/3", fetch: fetchH3, scheme: "https", serve: { tls, h3: true } });
} else {
  console.warn("[serve-protocols] no HTTP/3-capable curl; H3 cases will be skipped");
}

const md5 = (b: ArrayBuffer | Uint8Array) => createHash("md5").update(Buffer.from(b)).digest("hex");

/** Each test spawns its own server so failures don't cascade and concurrency
 * is safe; the H3 row only runs when an HTTP/3-capable curl is available. */
function fixtureFor(serve: object) {
  return `
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...${JSON.stringify(serve)},
      async fetch(req) {
        const url = new URL(req.url);
        switch (url.pathname) {
          case "/hello":
            return new Response("hello world", { headers: { "content-type": "text/plain" } });
          case "/echo": {
            const body = await req.arrayBuffer();
            return new Response(body, {
              status: 200,
              headers: {
                "x-method": req.method,
                "x-echo": req.headers.get("x-echo") ?? "",
                "x-len": String(body.byteLength),
              },
            });
          }
          case "/status":
            return new Response(null, { status: Number(url.searchParams.get("c") ?? "204") });
          case "/headers": {
            const out = {};
            for (const [k, v] of req.headers) out[k] = v;
            return Response.json(out);
          }
          case "/large":
            return new Response(Buffer.alloc(512 * 1024, "abcdefghijklmnop"));
          case "/stream":
            return new Response(
              new ReadableStream({
                start(c) {
                  for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode("chunk" + i + ";"));
                  c.close();
                },
              }),
            );
          default:
            return new Response("not found", { status: 404 });
        }
      },
    });
    console.error("PORT=" + server.port);
    process.stdin.on("data", () => {});
  `;
}

async function withServer(serve: object, fn: (origin: string) => Promise<void>) {
  using dir = tempDir("serve-protocols", { "server.mjs": fixtureFor(serve) });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "inherit",
    stderr: "pipe",
    stdin: "pipe",
  });
  let port = 0;
  let buf = "";
  for await (const chunk of proc.stderr) {
    buf += new TextDecoder().decode(chunk);
    const m = buf.match(/PORT=(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
    if (buf.length > 4096) break;
  }
  expect(port).toBeGreaterThan(0);
  // drain remaining stderr so the pipe doesn't backpressure the child
  (async () => {
    for await (const _ of proc.stderr) {
    }
  })();
  try {
    await fn(`127.0.0.1:${port}`);
  } finally {
    proc.stdin?.end();
    proc.kill();
    await proc.exited;
  }
}

for (const { protocol, fetch: doFetch, scheme, serve } of cases) {
  describe(`Bun.serve over ${protocol}`, () => {
    test.concurrent("hello world", async () => {
      await withServer(serve, async origin => {
        const res = await doFetch(`${scheme}://${origin}/hello`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/plain");
        expect(await res.text()).toBe("hello world");
      });
    });

    // h2o's matrix: 1, 100, 10_000, 1_000_000 byte POST bodies echoed back.
    for (const size of [1, 100, 10_000, 1_000_000]) {
      test.concurrent(`POST echo ${size} bytes`, async () => {
        await withServer(serve, async origin => {
          const body = Buffer.alloc(size, 0x61 + (size % 26));
          const res = await doFetch(`${scheme}://${origin}/echo`, {
            method: "POST",
            headers: { "x-echo": String(size) },
            body,
          });
          expect(res.status).toBe(200);
          expect(res.headers.get("x-len")).toBe(String(size));
          expect(res.headers.get("x-echo")).toBe(String(size));
          const out = new Uint8Array(await res.arrayBuffer());
          expect(out.length).toBe(size);
          expect(md5(out)).toBe(md5(body));
        });
      });
    }

    test.concurrent("large response checksum (512 KB)", async () => {
      await withServer(serve, async origin => {
        const res = await doFetch(`${scheme}://${origin}/large`);
        expect(res.status).toBe(200);
        const buf = new Uint8Array(await res.arrayBuffer());
        expect(buf.length).toBe(512 * 1024);
        expect(md5(buf)).toBe(md5(Buffer.alloc(512 * 1024, "abcdefghijklmnop")));
      });
    });

    test.concurrent("status codes round-trip", async () => {
      await withServer(serve, async origin => {
        for (const code of [200, 201, 204, 301, 400, 404, 418, 500, 503]) {
          const res = await doFetch(`${scheme}://${origin}/status?c=${code}`, { redirect: "manual" });
          expect(res.status).toBe(code);
        }
      });
    });

    test.concurrent("request headers reach handler", async () => {
      await withServer(serve, async origin => {
        const res = await doFetch(`${scheme}://${origin}/headers`, {
          headers: {
            "x-a": "1",
            "x-b": "two words",
            "x-long": Buffer.alloc(2000, "h").toString(),
          },
        });
        expect(res.status).toBe(200);
        const seen = (await res.json()) as Record<string, string>;
        expect(seen["x-a"]).toBe("1");
        expect(seen["x-b"]).toBe("two words");
        expect(seen["x-long"]?.length).toBe(2000);
      });
    });

    test.concurrent("ReadableStream response body", async () => {
      await withServer(serve, async origin => {
        const res = await doFetch(`${scheme}://${origin}/stream`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(Array.from({ length: 8 }, (_, i) => `chunk${i};`).join(""));
      });
    });

    test.concurrent("16 concurrent GETs", async () => {
      await withServer(serve, async origin => {
        const all = await Promise.all(
          Array.from({ length: 16 }, () => doFetch(`${scheme}://${origin}/hello`).then(r => r.text())),
        );
        expect(all.every(t => t === "hello world")).toBe(true);
      });
    });
  });
}
