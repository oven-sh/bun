import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as http from "node:http";

// Bun-specific divergence from https://fetch.spec.whatwg.org/#dom-request step 6:
// instead of rejecting a URL that includes credentials, derive an
// `Authorization: Basic` header and strip the userinfo from the stored URL.
// Redirects to a Location that includes credentials are still rejected per
// https://fetch.spec.whatwg.org/#http-redirect-fetch steps 10-11.

const basic = (userpass: string) => "Basic " + Buffer.from(userpass).toString("base64");

describe("URL credentials", () => {
  test.each([
    ["http://user:pass@example.com/", "http://example.com/", basic("user:pass")],
    ["http://user@example.com/", "http://example.com/", basic("user:")],
    ["http://:pass@example.com/", "http://example.com/", basic(":pass")],
    ["http://user%40x:p%40ss@example.com/", "http://example.com/", basic("user@x:p@ss")],
    ["https://user:pass@example.com/path?q=1#h", "https://example.com/path?q=1#h", basic("user:pass")],
  ])("new Request(%j) derives Authorization and strips userinfo", (input, expectedUrl, expectedAuth) => {
    const req = new Request(input);
    expect({ url: req.url, auth: req.headers.get("authorization") }).toEqual({
      url: expectedUrl,
      auth: expectedAuth,
    });

    // same behaviour when the input is a URL object
    const req2 = new Request(new URL(input));
    expect({ url: req2.url, auth: req2.headers.get("authorization") }).toEqual({
      url: expectedUrl,
      auth: expectedAuth,
    });
  });

  test("new Request() does not derive Authorization when the caller supplied one", () => {
    const req = new Request("http://user:pass@example.com/", {
      headers: { authorization: "Bearer TOKEN" },
    });
    expect({ url: req.url, auth: req.headers.get("authorization") }).toEqual({
      url: "http://example.com/",
      auth: "Bearer TOKEN",
    });
  });

  test("new Request() with a URL that has no credentials is unchanged", () => {
    const cases = ["http://example.com/", "http://example.com/user:pass@x", "http://example.com/?x=@y"];
    for (const url of cases) {
      const req = new Request(url);
      expect({ url: req.url, auth: req.headers.get("authorization") }).toEqual({
        url,
        auth: null,
      });
    }
    // empty user+password is serialized without the '@'
    expect(new Request("http://@example.com/").url).toBe("http://example.com/");
  });

  test("fetch() with a URL that includes credentials sends Authorization: Basic and strips userinfo", async () => {
    const seen: (string | undefined)[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("authorization") ?? undefined);
        return new Response("OK");
      },
    });
    const base = `${server.hostname}:${server.port}`;
    const res = await fetch(`http://user:pass@${base}/x`);
    expect({
      status: res.status,
      url: res.url,
      seen,
    }).toEqual({
      status: 200,
      url: `http://${base}/x`,
      seen: [basic("user:pass")],
    });
  });

  test("fetch() does not derive Authorization when the caller supplied one", async () => {
    const seen: (string | undefined)[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("authorization") ?? undefined);
        return new Response("OK");
      },
    });
    const res = await fetch(`http://user:pass@${server.hostname}:${server.port}/`, {
      headers: { authorization: "Bearer TOKEN" },
    });
    expect({ status: res.status, seen }).toEqual({ status: 200, seen: ["Bearer TOKEN"] });
  });

  test("fetch(new Request(url)) sends the Request's derived Authorization", async () => {
    const seen: (string | undefined)[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("authorization") ?? undefined);
        return new Response("OK");
      },
    });
    const res = await fetch(new Request(`http://user:pass@${server.hostname}:${server.port}/`));
    expect({ status: res.status, seen }).toEqual({ status: 200, seen: [basic("user:pass")] });
  });

  async function withRedirectServers(fn: (portA: number, portB: number, seen: string[]) => Promise<void>) {
    const seen: string[] = [];
    const mk = () =>
      http.createServer((req, res) => {
        seen.push(req.url!);
        const u = new URL(req.url!, "http://x");
        if (u.pathname === "/r") {
          res.writeHead(302, { location: u.searchParams.get("to")!, "content-length": 0 });
          res.end();
          return;
        }
        res.writeHead(200, { "content-length": 2 });
        res.end("OK");
      });
    const A = mk();
    const B = mk();
    try {
      A.listen(0, "127.0.0.1");
      B.listen(0, "127.0.0.1");
      await once(A, "listening");
      await once(B, "listening");
      await fn((A.address() as any).port, (B.address() as any).port, seen);
    } finally {
      A.close();
      B.close();
    }
  }

  test("fetch() rejects a cross-origin redirect to a URL that includes credentials", async () => {
    await withRedirectServers(async (PA, PB, seen) => {
      const target = `http://user:pass@127.0.0.1:${PA}/redirected`;
      const err = await fetch(`http://127.0.0.1:${PB}/r?to=${encodeURIComponent(target)}`, {
        headers: { authorization: "Bearer ORIG" },
      }).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toContain("includes credentials");
      expect(seen.some(u => u.startsWith("/redirected"))).toBe(false);
    });
  });

  test("fetch() rejects a same-origin redirect to a URL that includes credentials", async () => {
    await withRedirectServers(async (PA, _PB, seen) => {
      const target = `http://user:pass@127.0.0.1:${PA}/redirected`;
      const err = await fetch(`http://127.0.0.1:${PA}/r?to=${encodeURIComponent(target)}`).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(seen.some(u => u.startsWith("/redirected"))).toBe(false);
    });
  });

  test("fetch() rejects a protocol-relative redirect to a URL that includes credentials", async () => {
    await withRedirectServers(async (PA, PB, seen) => {
      const target = `//user:pass@127.0.0.1:${PA}/redirected`;
      const err = await fetch(`http://127.0.0.1:${PB}/r?to=${encodeURIComponent(target)}`).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(seen.some(u => u.startsWith("/redirected"))).toBe(false);
    });
  });

  test("fetch() follows a redirect to a URL with no credentials", async () => {
    await withRedirectServers(async (PA, PB, seen) => {
      const target = `http://127.0.0.1:${PA}/redirected`;
      const res = await fetch(`http://127.0.0.1:${PB}/r?to=${encodeURIComponent(target)}`);
      expect(res.status).toBe(200);
      expect(res.redirected).toBe(true);
      expect(res.url).toBe(target);
      expect(seen.some(u => u.startsWith("/redirected"))).toBe(true);
    });
  });
});
