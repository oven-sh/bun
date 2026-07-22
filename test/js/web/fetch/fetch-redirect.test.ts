import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { once } from "node:events";
import net from "node:net";

// WHATWG HTTP-redirect fetch runs on the response head (status line + Location);
// the 3xx body is discarded, not awaited. A redirecting server that never finishes
// its own body must not be able to stall the follow-up request.
describe("fetch() follows a redirect on headers without waiting for the 3xx body", () => {
  async function run(responseHead: (location: string) => string) {
    let finalRequests = 0;
    await using final = Bun.serve({
      port: 0,
      fetch() {
        finalRequests++;
        return new Response("FINAL");
      },
    });
    const location = `${final.url.origin}/final`;

    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.once("data", () => {
        // Write the 302 head (and part of its body) immediately; never send the
        // rest. The socket stays open until the test tears it down.
        socket.write(responseHead(location));
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/start`);
      expect({
        status: res.status,
        redirected: res.redirected,
        url: res.url,
        body: await res.text(),
        finalRequests,
      }).toEqual({
        status: 200,
        redirected: true,
        url: location,
        body: "FINAL",
        finalRequests: 1,
      });
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  }

  it("chunked body with no terminating chunk", async () => {
    await run(loc => `HTTP/1.1 302 Found\r\nLocation: ${loc}\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n`);
  });

  it("Content-Length body that is never completed", async () => {
    await run(loc => `HTTP/1.1 302 Found\r\nLocation: ${loc}\r\nContent-Length: 50\r\n\r\n0123456789`);
  });

  it("close-delimited body on a connection that stays open", async () => {
    await run(loc => `HTTP/1.1 302 Found\r\nLocation: ${loc}\r\nConnection: close\r\n\r\npartial`);
  });
});

it("fetch() with redirect: 'manual' still exposes the 3xx response body", async () => {
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.once("data", () => {
      socket.end("HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nContent-Length: 7\r\n\r\nignored");
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
    expect({ status: res.status, redirected: res.redirected, body: await res.text() }).toEqual({
      status: 302,
      redirected: false,
      body: "ignored",
    });
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/12701
it("fetch() preserves body on redirect", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/redirect") {
        return new Response(null, {
          status: 308,
          headers: {
            Location: "/redirect2",
          },
        });
      }
      if (pathname === "/redirect2") {
        return new Response(req.body, { status: 200 });
      }
      return new Response("you shouldnt see this?", { status: 200 });
    },
  });

  const res = await fetch(new URL("/redirect", server.url), {
    method: "POST",
    body: "hello",
  });

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
});

it.each(["file:/etc/hosts", "file:hosts"])(
  "fetch() rejects following a redirect to a Location with a non-HTTP scheme (%s)",
  async location => {
    let requestsAfterRedirect = 0;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/start") {
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        requestsAfterRedirect++;
        return new Response("unexpected", { status: 200 });
      },
    });

    const outcome = await fetch(new URL("/start", server.url)).then(
      () => ({ rejected: false as const }),
      e => ({ rejected: true as const, code: e.code }),
    );
    expect(outcome).toEqual({ rejected: true, code: "UnsupportedRedirectProtocol" });
    expect(requestsAfterRedirect).toBe(0);
  },
);

// The followed request target must never contain a raw control byte: TAB is
// the only control byte accepted in a header value, and resolving the
// Location against the original URL strips it.
it.each([["tab", "\t", "/ab"]])(
  "fetch() normalizes a redirect Location containing a raw %s character before re-requesting",
  async (_name, char, expectedTarget) => {
    const requests: string[] = [];
    const server = net.createServer(socket => {
      let data = "";
      socket.on("data", chunk => {
        data += chunk.toString("latin1");
        if (data.includes("\r\n\r\n")) {
          requests.push(data);
          data = "";
          socket.end(
            requests.length === 1
              ? `HTTP/1.1 302 Found\r\nLocation: /a${char}b\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
              : `HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok`,
          );
        }
      });
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as net.AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/start`);
      expect(await response.text()).toBe("ok");
      expect(response.status).toBe(200);
      expect(requests).toHaveLength(2);
      const requestLine = requests[1].split("\r\n")[0];
      expect(requestLine).toBe(`GET ${expectedTarget} HTTP/1.1`);
      // No byte of the emitted request target is a control character.
      for (const byte of Buffer.from(requestLine.split(" ")[1], "latin1")) {
        expect(byte).toBeGreaterThan(0x20);
        expect(byte).not.toBe(0x7f);
      }
    } finally {
      server.close();
    }
  },
);

it.each([
  ["vertical tab", "\x0b"],
  ["SOH", "\x01"],
  ["DEL", "\x7f"],
])("fetch() rejects a redirect response whose Location contains a raw %s character", async (_name, char) => {
  const requests: string[] = [];
  const server = net.createServer(socket => {
    socket.on("data", chunk => {
      requests.push(chunk.toString("latin1"));
      socket.end(`HTTP/1.1 302 Found\r\nLocation: /a${char}b\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const outcome = await fetch(`http://127.0.0.1:${port}/start`).then(
      () => ({ rejected: false as const, code: undefined }),
      e => ({ rejected: true as const, code: e.code }),
    );
    expect(outcome).toEqual({ rejected: true, code: "Malformed_HTTP_Response" });
    expect(requests).toHaveLength(1);
  } finally {
    server.close();
  }
});

// The HTTP client allocates a new URL buffer for every Location hop and stores
// it in HTTPClient.redirect so HTTPClient.url can borrow slices from it. Prior
// to the fix, assigning the new buffer did not free the previous one, so only
// the final hop was released in deinit() and every intermediate URL leaked.
it("fetch() does not leak intermediate redirect URLs in multi-hop chains", async () => {
  const HOPS = 10;
  // Pad the redirect URL so each leaked intermediate buffer is large enough
  // to move RSS measurably. The padding goes in the fragment so the client
  // allocates the full URL into HTTPClient.redirect while the request sent
  // on the wire stays tiny (fragments are never transmitted), which keeps
  // the server under its request-line limit and lets keep-alive reuse one
  // socket for every hop. Stays under MAX_REDIRECT_URL_LENGTH (128 KiB).
  const PAD = Buffer.alloc(96 * 1024, "a").toString();

  // Server runs in the parent so its allocations are excluded from the
  // child's RSS measurement.
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const m = pathname.match(/^\/hop\/(\d+)/);
      const hop = m ? Number(m[1]) : 0;
      if (hop < HOPS) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${server.url.origin}/hop/${hop + 1}#${PAD}` },
        });
      }
      return new Response("ok");
    },
  });

  // Run the fetch loop in a child process so server-side buffers don't
  // pollute the RSS we measure. The child samples RSS after warmup and
  // again after two equal batches so we can assert on steady-state growth.
  const script = `
    const url = "${server.url.origin}/hop/0";
    async function once() {
      const res = await fetch(url, { redirect: "follow" });
      if (await res.text() !== "ok") throw new Error("unexpected body: " + res.status);
    }
    function sample() { Bun.gc(true); return process.memoryUsage.rss(); }
    for (let i = 0; i < 15; i++) await once();
    const rss0 = sample();
    for (let i = 0; i < 25; i++) await once();
    const rss1 = sample();
    for (let i = 0; i < 25; i++) await once();
    const rss2 = sample();
    console.log(JSON.stringify({ rss0, rss1, rss2 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const { rss0, rss1, rss2 } = JSON.parse(stdout.trim());
  const secondHalfMiB = (rss2 - rss1) / 1024 / 1024;
  // With the bug, (HOPS - 1) intermediate ~96 KiB URL buffers leak per fetch:
  // roughly 864 KiB * 50 ≈ 42 MiB total, split evenly across both halves
  // (~21 MiB each). Without it, allocator growth plateaus after warmup so
  // the second half stays near zero. Asserting on the second half avoids
  // counting one-off arena growth that can still occur shortly after warmup.
  // Under ASAN the free quarantine (default 256 MB) plus redzones and glibc
  // page retention inflate RSS even with no leak, so widen the threshold.
  expect(secondHalfMiB).toBeLessThan(isASAN ? 400 : 12);
}, 60_000);

// https://fetch.spec.whatwg.org/#http-redirect-fetch step 5: "If request's
// redirect count is 20, then return a network error." A network error rejects
// the fetch() promise with a TypeError.
describe("fetch() redirect limit", () => {
  // `/0 -> /1 -> ... -> /hops` via 302, then a 200. `requests.count` is the
  // number of round trips the client actually made.
  function redirectChain(hops: number) {
    const requests = { count: 0 };
    const server = Bun.serve({
      port: 0,
      fetch(request: Request) {
        requests.count++;
        const n = Number(new URL(request.url).pathname.slice("/".length));
        if (n >= hops) return new Response("done");
        return new Response(null, { status: 302, headers: { Location: `/${n + 1}` } });
      },
    });
    return { server, requests, [Symbol.dispose]: () => server.stop(true) };
  }

  async function rejection(promise: Promise<unknown>): Promise<any> {
    return await promise.then(
      () => {
        throw new Error("expected the fetch promise to reject");
      },
      (e: unknown) => e,
    );
  }

  it.concurrent("follows exactly 20 redirects by default", async () => {
    using chain = redirectChain(20);
    const resp = await fetch(`${chain.server.url}0`);
    expect(await resp.text()).toBe("done");
    expect(resp.status).toBe(200);
    expect(chain.requests.count).toBe(21);
  });

  it.concurrent("rejects the 21st redirect with a TypeError", async () => {
    using chain = redirectChain(21);
    const err = await rejection(fetch(`${chain.server.url}0`));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("TooManyRedirects");
    expect(err.message).toContain("redirected too many times");
    // 20 redirects were followed; the 21st redirect response is the error.
    expect(chain.requests.count).toBe(21);
  });

  it.concurrent("a self-redirect loop makes exactly 21 requests before rejecting", async () => {
    let requests = 0;
    using server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return new Response(null, { status: 302, headers: { Location: "/" } });
      },
    });
    const err = await rejection(fetch(server.url));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("TooManyRedirects");
    expect(requests).toBe(21);
  });

  it.concurrent("exceeding an explicit maxRedirects rejects with a TypeError", async () => {
    using chain = redirectChain(3);
    const err = await rejection(fetch(`${chain.server.url}0`, { maxRedirects: 2 }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("TooManyRedirects");
    expect(chain.requests.count).toBe(3);
  });

  it.concurrent('redirect: "error" rejects with a TypeError', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { Location: "/elsewhere" } }),
    });
    const err = await rejection(fetch(server.url, { redirect: "error" }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("UnexpectedRedirect");
  });

  it.concurrent("a redirect to a non-HTTP(S) scheme rejects with a TypeError", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { Location: "ftp://example.com/" } }),
    });
    const err = await rejection(fetch(server.url));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("UnsupportedRedirectProtocol");
  });

  it.concurrent("a redirect to an unparseable URL rejects with a TypeError", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { Location: "http://[/" } }),
    });
    const err = await rejection(fetch(server.url));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("RedirectURLInvalid");
  });
});
