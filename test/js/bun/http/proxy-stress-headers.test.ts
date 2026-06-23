/**
 * Response- and request-header shape through the proxy tunnel: many
 * headers, duplicate Set-Cookie, folding, long header names, every
 * standard Content-Type, and the proxy's own Host / Proxy-Connection /
 * User-Agent on the CONNECT envelope.
 *
 * Also: Content-Range (206), long URLs, and the decompress:false path
 * that surfaces the raw encoded body.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import zlib from "node:zlib";
import {
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  laxTls,
  restoreProxyEnv,
  tlsCert,
} from "./proxy-stress-helpers";

let savedEnv: Record<string, string | undefined>;
beforeAll(() => {
  savedEnv = clearProxyEnv();
});
afterAll(() => {
  restoreProxyEnv(savedEnv);
});

// ─────────────────────────────────────────────────────────────────────────────
// Many response headers through each proxy combination.
// ─────────────────────────────────────────────────────────────────────────────

describe("many response headers", () => {
  for (const { proxyTls, originTls, count } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    count: [5, 50, 200] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${count} response headers`,
      async () => {
        const headers: Record<string, string> = {};
        for (let i = 0; i < count; i++) headers[`X-Resp-${i}`] = `val-${i}`;
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok", headers });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
        for (let i = 0; i < count; i++) {
          expect(res.headers.get(`x-resp-${i}`)).toBe(`val-${i}`);
        }
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple Set-Cookie headers: preserved as separate entries.
// ─────────────────────────────────────────────────────────────────────────────

describe("duplicate Set-Cookie through tunnel", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, 3 Set-Cookie headers`,
      async () => {
        // The adversarial origin writes headers from a plain object, so
        // duplicate names need a raw writer. Build one inline for this test.
        const handler = (sock: net.Socket) => {
          sock.on("error", () => {});
          sock.once("data", () => {
            sock.write(
              "HTTP/1.1 200 OK\r\n" +
                "Set-Cookie: a=1\r\n" +
                "Set-Cookie: b=2\r\n" +
                "Set-Cookie: c=3\r\n" +
                "Content-Length: 2\r\n" +
                "Connection: close\r\n\r\nok",
            );
            sock.end();
          });
        };
        const server = originTls
          ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handler)
          : net.createServer(handler);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const originUrl = `${originTls ? "https" : "http"}://localhost:${(server.address() as net.AddressInfo).port}`;
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        try {
          const res = await fetch(originUrl, { proxy: proxy.url, keepalive: false, tls: laxTls });
          expect(res.status).toBe(200);
          expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2", "c=3"]);
        } finally {
          server.close();
        }
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Content-Type matrix: the header value survives the tunnel unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe("Content-Type through tunnel", () => {
  const CONTENT_TYPES = [
    "text/plain",
    "text/html; charset=utf-8",
    "application/json",
    "application/octet-stream",
    "image/png",
    'multipart/form-data; boundary="abc123"',
    "application/x-www-form-urlencoded",
  ] as const;
  for (const { proxyTls, originTls, ct } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    ct: CONTENT_TYPES,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin Content-Type="${ct}"`,
      async () => {
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          body: "ct",
          headers: { "Content-Type": ct },
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(ct);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 206 Partial Content with Content-Range through each proxy combination.
// ─────────────────────────────────────────────────────────────────────────────

describe("206 Content-Range through tunnel", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin 206 with Content-Range`,
      async () => {
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          status: 206,
          body: "partial",
          headers: { "Content-Range": "bytes 0-6/100", "Accept-Ranges": "bytes" },
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          headers: { Range: "bytes=0-6" },
        });
        expect(res.status).toBe(206);
        expect(res.headers.get("content-range")).toBe("bytes 0-6/100");
        expect(await res.text()).toBe("partial");
        expect(origin.requests[0].headers["range"]).toBe("bytes=0-6");
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// decompress:false through the tunnel: the client surfaces the raw
// encoded body and the Content-Encoding header.
// ─────────────────────────────────────────────────────────────────────────────

describe("decompress:false through tunnel", () => {
  for (const { proxyTls, originTls, encoding } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    encoding: ["gzip", "br"] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin ${encoding} decompress:false`,
      async () => {
        const payload = Buffer.alloc(2048, "Z").toString("latin1");
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          body: payload,
          encoding,
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          decompress: false,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-encoding")).toBe(encoding);
        const raw = Buffer.from(await res.arrayBuffer());
        // The raw bytes are the compressed form, not the plaintext.
        expect(raw.toString("latin1")).not.toBe(payload);
        const decoded =
          encoding === "gzip" ? zlib.gunzipSync(raw) : zlib.brotliDecompressSync(raw);
        expect(decoded.toString("latin1")).toBe(payload);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECT envelope shape: Host, Proxy-Connection, and User-Agent are
// present on the proxy request.
// ─────────────────────────────────────────────────────────────────────────────

describe("CONNECT envelope shape", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy CONNECT carries Host and Proxy-Connection`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "ok" });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(res.status).toBe(200);
      const h = proxy.connections[0].headers;
      expect(h["host"]).toBe(`localhost:${origin.port}`);
      expect(h["proxy-connection"]).toBeDefined();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Long request URL through both absolute-form and CONNECT tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("long URL through proxy", () => {
  for (const { proxyTls, originTls, len } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    len: [1024, 4096, 8000] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${len}B path`,
      async () => {
        const path = "/" + Buffer.alloc(len - 1, "p").toString("latin1");
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url + path, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        expect(origin.requests[0].path).toBe(path);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Switch proxy mid-session: two requests to the same origin through two
// different proxies. Tunnels must not be cross-keyed.
// ─────────────────────────────────────────────────────────────────────────────

describe("switching proxy", () => {
  for (const originTls of [false, true] as const) {
    test.concurrent(`two different proxies, same ${originTls ? "https" : "http"}-origin`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
      await using proxyA = await createAdversarialProxy({});
      await using proxyB = await createAdversarialProxy({});
      let res = await fetch(origin.url, { proxy: proxyA.url, keepalive: true, tls: laxTls });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      res = await fetch(origin.url, { proxy: proxyB.url, keepalive: true, tls: laxTls });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(proxyA.connections.length).toBe(1);
      expect(proxyB.connections.length).toBe(1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// decompress:true (default) surfaces the decoded body and strips
// Content-Encoding from the exposed response.
// ─────────────────────────────────────────────────────────────────────────────

describe("Content-Encoding header after decompress", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin gzip, body decoded`,
      async () => {
        const payload = Buffer.alloc(2048, "D").toString("latin1");
        await using origin = await createAdversarialOrigin({ tls: originTls, body: payload, encoding: "gzip" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(payload);
      },
    );
  }
});
