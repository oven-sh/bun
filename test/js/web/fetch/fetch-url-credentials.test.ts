import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as http from "node:http";

// https://fetch.spec.whatwg.org/#dom-request step 6:
//   "If parsedURL includes credentials, then throw a TypeError."
// https://fetch.spec.whatwg.org/#http-redirect-fetch steps 10-11:
//   "If locationURL includes credentials, then return a network error."

describe("URL credentials", () => {
  test.each([
    "http://user:pass@example.com/",
    "http://user@example.com/",
    "http://:pass@example.com/",
    "https://user:pass@example.com/path?query#hash",
  ])("new Request(%j) throws a TypeError", url => {
    expect(() => new Request(url)).toThrow(TypeError);
    expect(() => new Request(url)).toThrow("includes credentials");
    expect(() => new Request(new URL(url))).toThrow(TypeError);
  });

  test("new Request() with a URL that has no credentials does not throw", () => {
    expect(() => new Request("http://example.com/")).not.toThrow();
    // serialized credentials get percent-encoded into the path, which is fine
    expect(() => new Request("http://example.com/user:pass@x")).not.toThrow();
    // '@' in the query string is fine
    expect(() => new Request("http://example.com/?x=@y")).not.toThrow();
    // empty user+password is serialized without the '@'
    expect(new Request("http://@example.com/").url).toBe("http://example.com/");
  });

  test("fetch() with a URL that includes credentials rejects with a TypeError and never connects", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        hits++;
        return new Response("OK");
      },
    });
    const url = `http://user:pass@${server.hostname}:${server.port}/`;

    const err = await fetch(url).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toContain("includes credentials");
    // the server must not have been contacted
    expect(hits).toBe(0);

    // same thing via a URL object
    const err2 = await fetch(new URL(url)).then(
      () => null,
      e => e,
    );
    expect(err2).toBeInstanceOf(TypeError);
    expect(hits).toBe(0);
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
      // only the redirect endpoint on B was contacted, never the credentialed target on A
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
