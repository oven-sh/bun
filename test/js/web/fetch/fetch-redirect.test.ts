import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir, tls } from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

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

// https://fetch.spec.whatwg.org/#redirect-status
// A redirect status is 301, 302, 303, 307, or 308. Other 3xx statuses
// (300, 304, 305, 306) are not redirects: they are returned as-is under
// every redirect mode, including "error".
describe("fetch() only treats WHATWG redirect statuses as redirects", () => {
  async function serve(status: number, reason: string, extra = "") {
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.end(`HTTP/1.1 ${status} ${reason}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/` };
  }

  const nonRedirect3xx = [
    ["300 Multiple Choices", 300, "Multiple Choices", "Location: /elsewhere\r\n"],
    ["304 Not Modified", 304, "Not Modified", 'ETag: "v1"\r\n'],
    ["304 Not Modified with Location", 304, "Not Modified", 'ETag: "v1"\r\nLocation: /elsewhere\r\n'],
    ["305 Use Proxy", 305, "Use Proxy", "Location: /elsewhere\r\n"],
    ["306 unused", 306, "unused", ""],
  ] as const;

  describe.each(["error", "follow"] as const)("redirect: %p", redirect => {
    it.concurrent.each(nonRedirect3xx)("%s is returned as-is", async (_label, status, reason, extra) => {
      const { server, url } = await serve(status, reason, extra);
      try {
        const res = await fetch(url, { redirect, headers: { "if-none-match": '"v1"' } });
        expect({ status: res.status, redirected: res.redirected, body: await res.text() }).toEqual({
          status,
          redirected: false,
          body: "",
        });
      } finally {
        server.close();
      }
    });
  });

  it.concurrent.each([
    [301, "Moved Permanently"],
    [302, "Found"],
    [303, "See Other"],
    [307, "Temporary Redirect"],
    [308, "Permanent Redirect"],
  ])("redirect: 'error' rejects %d %s with UnexpectedRedirect", async (status, reason) => {
    const { server, url } = await serve(status, reason, "Location: /elsewhere\r\n");
    try {
      const outcome = await fetch(url, { redirect: "error" }).then(
        res => ({ rejected: false as const, status: res.status }),
        e => ({ rejected: true as const, code: e.code }),
      );
      expect(outcome).toEqual({ rejected: true, code: "UnexpectedRedirect" });
    } finally {
      server.close();
    }
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

// A Bun.file() body of 32 KiB or more isn't read into memory. It's sent straight
// from the file, so a redirect has to send it from the file again.
describe("fetch() re-sends a Bun.file() body when following a redirect", () => {
  const FILE = randomBytes(96 * 1024);

  type Hop = { method: string; path: string; contentLength: string | null; matches: boolean };

  // Paths listed in `redirects` answer with that redirect after reading the body. Anything else is the final 200.
  function serveHops(
    hops: Hop[],
    expectedBody: Uint8Array,
    redirects: Record<string, { status: number; location: string }>,
    tlsOptions?: typeof tls,
  ) {
    return Bun.serve({
      port: 0,
      tls: tlsOptions,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        hops.push({
          method: req.method,
          path: pathname,
          contentLength: req.headers.get("content-length"),
          matches: Buffer.from(await req.arrayBuffer()).equals(expectedBody),
        });
        const redirect = redirects[pathname];
        if (redirect) {
          return new Response(null, { status: redirect.status, headers: { Location: redirect.location } });
        }
        return new Response("final");
      },
    });
  }

  const received = (method: string, path: string, body: Uint8Array = FILE): Hop => ({
    method,
    path,
    contentLength: String(body.byteLength),
    matches: true,
  });

  it.concurrent.each([
    [307, "POST"],
    [308, "PATCH"],
    [301, "PUT"],
  ])("%d keeps the %s body", async (status, method) => {
    using dir = tempDir("fetch-redirect-file-body", { "body.bin": FILE });
    const hops: Hop[] = [];
    using server = serveHops(hops, FILE, { "/start": { status, location: "/final" } });

    const res = await fetch(new URL("/start", server.url), { method, body: Bun.file(join(String(dir), "body.bin")) });

    expect({ status: res.status, text: await res.text(), hops }).toEqual({
      status: 200,
      text: "final",
      hops: [received(method, "/start"), received(method, "/final")],
    });
  });

  it.concurrent("303 drops the body and switches to GET", async () => {
    using dir = tempDir("fetch-redirect-file-body", { "body.bin": FILE });
    const hops: Hop[] = [];
    using server = serveHops(hops, FILE, { "/start": { status: 303, location: "/final" } });

    const res = await fetch(new URL("/start", server.url), {
      method: "POST",
      body: Bun.file(join(String(dir), "body.bin")),
    });

    expect({ status: res.status, text: await res.text(), hops }).toEqual({
      status: 200,
      text: "final",
      hops: [received("POST", "/start"), { method: "GET", path: "/final", contentLength: null, matches: false }],
    });
  });

  it.concurrent("re-sends the same slice on every hop of a chain", async () => {
    const slice = FILE.subarray(4096, 4096 + 40 * 1024);
    using dir = tempDir("fetch-redirect-file-body", { "body.bin": FILE });
    const hops: Hop[] = [];
    using server = serveHops(hops, slice, {
      "/start": { status: 307, location: "/second" },
      "/second": { status: 308, location: "/final" },
    });

    const res = await fetch(new URL("/start", server.url), {
      method: "POST",
      body: Bun.file(join(String(dir), "body.bin")).slice(4096, 4096 + slice.byteLength),
    });

    expect({ status: res.status, text: await res.text(), hops }).toEqual({
      status: 200,
      text: "final",
      hops: [received("POST", "/start", slice), received("POST", "/second", slice), received("POST", "/final", slice)],
    });
  });

  // 4 MiB doesn't fit in the socket buffers, so the TLS hops resume from the file after a short write.
  it.concurrent("re-sends the body over TLS when the redirect goes to https", async () => {
    const whole = randomBytes(4 * 1024 * 1024);
    const BIG = whole.subarray(4097);
    using dir = tempDir("fetch-redirect-file-body", { "body.bin": whole });
    const secureHops: Hop[] = [];
    using secure = serveHops(secureHops, BIG, { "/secure": { status: 308, location: "/final" } }, tls);
    const plainHops: Hop[] = [];
    using plain = serveHops(plainHops, BIG, {
      "/start": { status: 307, location: `https://127.0.0.1:${secure.port}/secure` },
    });

    const res = await fetch(new URL("/start", plain.url), {
      method: "PUT",
      body: Bun.file(join(String(dir), "body.bin")).slice(4097),
      tls: { ca: tls.cert },
    });

    expect({ status: res.status, url: res.url, text: await res.text(), plainHops, secureHops }).toEqual({
      status: 200,
      url: `https://127.0.0.1:${secure.port}/final`,
      text: "final",
      plainHops: [received("PUT", "/start", BIG)],
      secureHops: [received("PUT", "/secure", BIG), received("PUT", "/final", BIG)],
    });
  });

  it.concurrent("re-sends the whole file after a redirect that interrupted the upload", async () => {
    const BIG = randomBytes(4 * 1024 * 1024);
    using dir = tempDir("fetch-redirect-file-body", { "body.bin": BIG });
    const hops: Hop[] = [];
    using final = serveHops(hops, BIG, {});

    const sockets = new Set<net.Socket>();
    const redirector = net.createServer(socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("data", () => {
        // Stop reading so the upload backs up, then redirect it mid-flight.
        socket.pause();
        socket.write(
          `HTTP/1.1 307 Temporary Redirect\r\nLocation: ${final.url.origin}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
    });
    await once(redirector.listen(0, "127.0.0.1"), "listening");
    const { port } = redirector.address() as net.AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/start`, {
        method: "POST",
        body: Bun.file(join(String(dir), "body.bin")),
      });
      expect({ status: res.status, text: await res.text(), hops }).toEqual({
        status: 200,
        text: "final",
        hops: [received("POST", "/final", BIG)],
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      redirector.close();
    }
  });
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
  // socket for every hop.
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
    const rss = process.memoryUsage.rss;
    const url = "${server.url.origin}/hop/0";
    async function once() {
      const res = await fetch(url, { redirect: "follow" });
      if (await res.text() !== "ok") throw new Error("unexpected body: " + res.status);
    }
    function sample() { Bun.gc(true); return rss(); }
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

// RFC 3986 §3.1: the URL scheme is case-insensitive.
describe("fetch() follows a redirect whose Location scheme is not lowercase", () => {
  it.concurrent.each(["HTTP", "Http", "hTtP"])("Location: %s://...", async scheme => {
    await using final = Bun.serve({
      port: 0,
      fetch: () => new Response("FINAL"),
    });

    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.end(
          `HTTP/1.1 302 Found\r\nLocation: ${scheme}://127.0.0.1:${final.port}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
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
      }).toEqual({
        status: 200,
        redirected: true,
        url: `http://127.0.0.1:${final.port}/final`,
        body: "FINAL",
      });
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
      await once(server, "close");
    }
  });
});

describe("fetch() resolves a relative Location that contains '://'", () => {
  it.concurrent.each([
    ["query", "/login?next=https://app.example.com", "/login", "?next=https://app.example.com"],
    ["fragment", "/cb#iss=https://issuer.example.com", "/cb", ""],
    ["query only", "?return_to=http://example.com/", "/start", "?return_to=http://example.com/"],
    ["path segment", "a/http://example.com", "/a/http://example.com", ""],
  ])("in the %s", async (_name, location, pathname, search) => {
    const seen: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        seen.push(url.pathname + url.search);
        if (seen.length === 1) return new Response(null, { status: 302, headers: { Location: location } });
        return new Response("ok");
      },
    });

    const res = await fetch(new URL("/start", server.url));
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual(["/start", pathname + search]);
    expect(res.redirected).toBe(true);
  });

  it.concurrent("still rejects a data: Location", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(null, { status: 302, headers: { Location: 'data:text/html,<a href="http://x">' } }),
    });
    await expect(fetch(server.url)).rejects.toMatchObject({ code: "UnsupportedRedirectProtocol" });
  });
});

// https://fetch.spec.whatwg.org/#concept-response-location-url
describe("fetch() resolves Location like new URL(location, currentURL)", () => {
  type Seen = { port: number; target: string; headers: string[] };

  /** Answers the first request with a 302 and `location(port)` as it is, and records the other requests. */
  async function listen(seen: Seen[], location?: () => string) {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", data => {
        const [requestLine, ...fields] = data.toString("latin1").split("\r\n\r\n")[0].split("\r\n");
        if (location) {
          socket.write(`HTTP/1.1 302 Found\r\nLocation: ${location()}\r\nContent-Length: 0\r\n\r\n`);
          location = undefined;
          return;
        }
        const names = fields.map(field => field.slice(0, field.indexOf(":")).toLowerCase());
        seen.push({
          port: (server.address() as net.AddressInfo).port,
          target: requestLine.split(" ")[1],
          headers: ["authorization", "cookie", "x-custom"].filter(name => names.includes(name)),
        });
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      host: `127.0.0.1:${(server.address() as net.AddressInfo).port}`,
      [Symbol.dispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
      },
    };
  }
  const headers = { authorization: "Basic c2VjcmV0", cookie: "a=1", "x-custom": "1" };

  // "other" stands for the host and port of a second server.
  it.concurrent.each([
    "://other/x",
    ":///other/x",
    "://user:pw@other/x",
    "1a://other/x",
    ":x",
    ":",
    "//other/x",
    "///other/x",
    "\\\\other\\x",
    "/\\other/x",
    "http:\\\\other\\x",
    "http:///other/x",
    "ht\ttp://other/x",
    "/\t/other/x",
    "HTTP://other/x",
    "http://user:pw@other/x",
    "http:/x",
    "http:x",
    "http:",
    "http:?y",
    "http:other/x",
    "?y",
    "#f",
    ".",
    "..",
    "../x",
    "x",
    "/a b",
  ])("%j", async template => {
    const seen: Seen[] = [];
    using other = await listen(seen);
    const location = template.replace("other", other.host);
    using first = await listen(seen, () => location);
    const start = `http://${first.host}/dir/start?q=1`;

    const expected = new URL(location, start);
    expected.hash = "";
    const res = await fetch(start, { headers });
    expect({ url: res.url, body: await res.text(), seen }).toEqual({
      url: expected.href,
      body: "ok",
      seen: [
        {
          port: Number(expected.port),
          target: expected.pathname + expected.search,
          headers: expected.host === first.host ? ["authorization", "cookie", "x-custom"] : ["x-custom"],
        },
      ],
    });
  });

  it.concurrent.each(["https:", "HTTPS:", "http://", "http:///", "http://other:x/", "//other:x/", "http://[::1/x"])(
    "%j is not a URL",
    async location => {
      using first = await listen([], () => location);
      await expect(fetch(`http://${first.host}/`)).rejects.toMatchObject({ code: "RedirectURLInvalid" });
    },
  );
});

it.concurrent.each([
  [301, "LIST /target payload"],
  [302, "LIST /target payload"],
  [303, "GET /target"],
  [307, "LIST /target payload"],
  [308, "LIST /target payload"],
])("fetch() follows a %i with a method outside the method table as %s", async (status, expected) => {
  const requests: string[] = [];
  const server = net.createServer(socket => {
    let received = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      const head = received.indexOf("\r\n\r\n");
      if (head === -1) return;
      const length = Number(/^content-length: (\d+)/im.exec(received.slice(0, head))?.[1] ?? 0);
      if (received.length < head + 4 + length) return;
      const [method, path] = received.split(" ", 2);
      requests.push(`${method} ${path} ${received.slice(head + 4)}`.trim());
      received = "";
      socket.end(
        path === "/target"
          ? "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
          : `HTTP/1.1 ${status} Redirect\r\nLocation: /target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      );
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const { port } = server.address() as net.AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/start`, { method: "LIST", body: "payload" });
    expect(response.status).toBe(200);
    expect(requests).toEqual(["LIST /start payload", expected]);
  } finally {
    server.close();
  }
});
