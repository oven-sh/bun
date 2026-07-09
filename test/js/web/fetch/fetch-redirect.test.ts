import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import net from "node:net";

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
  // `bun bd` debug builds also enable ASAN but the binary is named
  // `bun-debug`, so `isASAN` (which keys off the exe basename) is false there.
  expect(secondHalfMiB).toBeLessThan(isASAN || isDebug ? 400 : 12);
}, 60_000);

// The redirect handler used to scan the whole Location header for "://" to
// decide whether it was an absolute URL. A relative Location whose query or
// fragment happened to contain an absolute URL (common in OAuth/SSO flows,
// e.g. ?next=https://app.example.com) was misclassified as absolute with a
// scheme of "/login?next=https" and rejected as UnsupportedRedirectProtocol
// instead of being resolved against the request URL.
describe("fetch() follows relative redirect whose Location contains '://'", () => {
  it.each([
    ["in query", "/login?next=https://app.example.com", "/login", "?next=https://app.example.com"],
    ["in fragment", "/cb#token=abc&iss=https://issuer.example.com", "/cb", ""],
    ["query-only", "?return_to=http://example.com/", "/start", "?return_to=http://example.com/"],
    ["in path segment", "a/http://example.com", "/a/http://example.com", ""],
  ])("%s", async (_name, location, expectedPathname, expectedSearch) => {
    const seen: { pathname: string; search: string }[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname, search } = new URL(req.url);
        seen.push({ pathname, search });
        if (pathname === "/start" && search === "") {
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        return new Response("ok", { status: 200 });
      },
    });

    const res = await fetch(new URL("/start", server.url));
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);

    const final = new URL(res.url);
    expect({ pathname: final.pathname, search: final.search }).toEqual({
      pathname: expectedPathname,
      search: expectedSearch,
    });
    expect(seen).toEqual([
      { pathname: "/start", search: "" },
      { pathname: expectedPathname, search: expectedSearch },
    ]);
  });

  // Regression guard: absolute Location headers must still be treated as
  // absolute, and a second "://" appearing later in the URL must not confuse
  // the classifier.
  it("absolute Location with '://' later in the URL still works", async () => {
    let target: URL;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/start") {
          return new Response(null, { status: 302, headers: { Location: target.href } });
        }
        return new Response("ok", { status: 200 });
      },
    });
    target = new URL("/done?u=https://example.com", server.url);

    const res = await fetch(new URL("/start", server.url));
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
    expect(res.url).toBe(target.href);
  });

  // RFC 3986 section 3.1: scheme comparison is case-insensitive, so an
  // absolute Location with an uppercase scheme must be followed, not
  // rejected as UnsupportedRedirectProtocol.
  it("absolute Location with uppercase scheme still works", async () => {
    let target: string;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/start") {
          return new Response(null, { status: 302, headers: { Location: target } });
        }
        return new Response("ok", { status: 200 });
      },
    });
    const done = new URL("/done", server.url);
    target = done.href.replace(/^http/, "HTTP");

    const res = await fetch(new URL("/start", server.url));
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
    expect(res.url).toBe(done.href);
  });

  // A non-HTTP(S) scheme without "://" (javascript:, data:, mailto:) resolves
  // to an opaque absolute URL and must be rejected; so must a data: Location
  // that embeds "://" in its body (it no longer matches the absolute-URL
  // heuristic after the scheme_end filter above, but still falls through to
  // the existing has_http_like_protocol() gate in the relative branch).
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data: with embedded ://", 'data:text/html,<a href="http://x">'],
    ["mailto:", "mailto:user@example.com"],
  ])("rejects redirect to non-HTTP(S) scheme (%s)", async (_name, location) => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/start") {
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        return new Response("ok", { status: 200 });
      },
    });

    await expect(fetch(new URL("/start", server.url))).rejects.toMatchObject({
      code: "UnsupportedRedirectProtocol",
    });
  });
});
