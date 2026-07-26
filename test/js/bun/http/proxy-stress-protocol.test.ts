/**
 * Protocol-level edge cases through the proxy: early server replies mid-
 * upload, multi-hop redirect chains, large header values, 1xx
 * informational responses, origin HTTP version quirks, and IPv6 literals
 * as origin hosts. These exercise code paths in the tunnel parser /
 * state machine that the plain matrix doesn't reach.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isIPv6 } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import {
  AdversarialProxy,
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  laxTls,
  makeBody,
  restoreProxyEnv,
  tlsCert,
} from "./proxy-stress-helpers";

// Concurrency note: 102 tests share one {http, https} proxy pair from
// beforeAll to avoid ephemeral-port reuse under test.concurrent's rolling
// listen(0) churn. Tests that inspect proxy.connections keep a dedicated
// proxy.
let savedEnv: Record<string, string | undefined>;
let sharedHttpProxy: AdversarialProxy;
let sharedHttpsProxy: AdversarialProxy;
const sharedProxy = (tls: boolean) => (tls ? sharedHttpsProxy : sharedHttpProxy);

beforeAll(async () => {
  savedEnv = clearProxyEnv();
  sharedHttpProxy = await createAdversarialProxy({ tls: false });
  sharedHttpsProxy = await createAdversarialProxy({ tls: true });
});
afterAll(async () => {
  await sharedHttpProxy?.close();
  await sharedHttpsProxy?.close();
  restoreProxyEnv(savedEnv);
});

// ─────────────────────────────────────────────────────────────────────────────
// Early server reply during upload: the origin responds before the
// request body is fully written. The client must stop uploading, surface
// the response, and NOT pool a tunnel that still has unflushed write_buffer
// bytes (the `tunnel_poolable` gate).
// ─────────────────────────────────────────────────────────────────────────────

describe("early reply during upload", () => {
  async function makeEarlyReplyOrigin(status: number, after: number, withTls: boolean) {
    const handler = (sock: net.Socket) => {
      sock.on("error", () => {});
      let got = 0;
      let replied = false;
      sock.on("data", chunk => {
        got += chunk.length;
        if (!replied && got >= after) {
          replied = true;
          const reply = `HTTP/1.1 ${status} Nope\r\nContent-Length: 5\r\nConnection: close\r\n\r\nearly`;
          sock.write(reply, () => sock.end());
        }
      });
    };
    const server = withTls
      ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handler)
      : net.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    return {
      url: `${withTls ? "https" : "http"}://localhost:${port}`,
      port,
      close: () => server.close(),
      [Symbol.asyncDispose]: async () => server.close(),
    };
  }

  for (const { proxyTls, originTls, status } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    status: [413, 400, 500] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${status} after 1KB of a 1MB upload`,
      async () => {
        await using origin = await makeEarlyReplyOrigin(status, 1024, originTls);
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, {
          method: "POST",
          body: Buffer.alloc(1024 * 1024, "u"),
          proxy: proxy.url,
          keepalive: true,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        expect(await res.text()).toBe("early");
        expect(res.status).toBe(status);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-hop redirect chains through proxy: up to 5 hops mixing http and
// https origins. Every hop goes through the proxy; the tunnel is torn
// down and re-CONNECTed on every scheme change.
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-hop redirect through proxy", () => {
  for (const { proxyTls, chain } of cartesian({
    proxyTls: [false, true] as const,
    chain: [
      [false, false, false],
      [true, true, true],
      [false, true, false, true],
      [true, false, true, false, true],
    ] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy, ${chain.length}-hop [${chain.map(t => (t ? "s" : "h")).join("→")}]`,
      async () => {
        const origins: Array<{ close: () => void; url: string }> = [];
        // Build chain back-to-front.
        let next: string | undefined;
        const finalBody = `final-${chain.length}`;
        for (let i = chain.length - 1; i >= 0; i--) {
          const o = await createAdversarialOrigin({
            tls: chain[i],
            ...(next ? { redirectTo: next } : { body: finalBody }),
          });
          origins.push({ close: () => o.close(), url: o.url });
          next = o.url;
        }
        // This test inspects proxy.connections, so it needs a dedicated proxy.
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        try {
          const res = await fetch(next!, { proxy: proxy.url, keepalive: false, tls: laxTls });
          expect(await res.text()).toBe(finalBody);
          expect(res.status).toBe(200);
          // Every hop went through the proxy.
          expect(proxy.connections.length).toBe(chain.length);
          // Each hop's method matches its scheme.
          for (let i = 0; i < chain.length; i++) {
            expect(proxy.connections[i].method).toBe(chain[i] ? "CONNECT" : "GET");
          }
        } finally {
          for (const o of origins) o.close();
        }
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Large response header values through the tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("large response headers through tunnel", () => {
  for (const { proxyTls, originTls, size } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    size: [512, 4096, 16 * 1024] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${size}B header value`,
      async () => {
        const bigValue = Buffer.alloc(size, "H").toString("latin1");
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          body: "big",
          headers: { "X-Big": bigValue },
        });
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(await res.text()).toBe("big");
        expect(res.headers.get("x-big")).toBe(bigValue);
        expect(res.status).toBe(200);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Large request header values through the tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("large request headers through tunnel", () => {
  for (const { proxyTls, originTls, size } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    size: [512, 4096] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, request header ${size}B`,
      async () => {
        const bigValue = Buffer.alloc(size, "Q").toString("latin1");
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          headers: { "X-Big-Req": bigValue },
        });
        expect(res.status).toBe(200);
        expect(origin.requests[0].headers["x-big-req"]).toBe(bigValue);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1xx informational responses through the tunnel: the client must consume
// them and keep waiting for the final response.
// ─────────────────────────────────────────────────────────────────────────────

describe("1xx through tunnel", () => {
  async function make1xxOrigin(withTls: boolean, informational: string) {
    const handler = (sock: net.Socket) => {
      sock.on("error", () => {});
      sock.once("data", () => {
        sock.write(`HTTP/1.1 ${informational}\r\n\r\n`);
        sock.write("HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndone");
        sock.end();
      });
    };
    const server = withTls
      ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handler)
      : net.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `${withTls ? "https" : "http"}://localhost:${(server.address() as net.AddressInfo).port}`,
      [Symbol.asyncDispose]: async () => server.close(),
    };
  }

  for (const { proxyTls, originTls, info } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    info: ["100 Continue", "102 Processing", "103 Early Hints"] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${info} then 200`,
      async () => {
        await using origin = await make1xxOrigin(originTls, info);
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, {
          method: "POST",
          body: "x",
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        expect(await res.text()).toBe("done");
        expect(res.status).toBe(200);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPv6 literal origin through proxy. Loopback `::1` must be accepted as a
// CONNECT target and in the absolute-form URL.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!isIPv6())("IPv6 literal origin through proxy", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}://[::1]`, async () => {
      await using origin = Bun.serve({
        port: 0,
        hostname: "::1",
        tls: originTls ? tlsCert : undefined,
        fetch: () => new Response("v6"),
      });
      // This test inspects proxy.connections, so it needs a dedicated proxy.
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const scheme = originTls ? "https" : "http";
      const res = await fetch(`${scheme}://[::1]:${origin.port}/`, {
        proxy: proxy.url,
        keepalive: false,
        tls: laxTls,
        signal: AbortSignal.timeout(10_000),
      });
      expect(await res.text()).toBe("v6");
      expect(res.status).toBe(200);
      // The CONNECT target (or absolute-form URL) the client sent
      // contained the bracketed IPv6 literal.
      expect(proxy.connections.length).toBe(1);
      expect(proxy.connections[0].target).toContain("[::1]");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Many proxy.headers entries: the CONNECT/absolute-form request carries
// every one of them.
// ─────────────────────────────────────────────────────────────────────────────

describe("many proxy.headers", () => {
  for (const { proxyTls, originTls, count } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    count: [1, 10, 50] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, ${count} proxy headers`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        // This test inspects proxy.connections, so it needs a dedicated proxy.
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const headers: Record<string, string> = {};
        for (let i = 0; i < count; i++) headers[`X-Proxy-${i}`] = `v${i}`;
        const res = await fetch(origin.url, {
          proxy: { url: proxy.url, headers },
          keepalive: false,
          tls: laxTls,
        });
        expect(res.status).toBe(200);
        const seen = proxy.connections[0].headers;
        for (let i = 0; i < count; i++) {
          expect(seen[`x-proxy-${i}`]).toBe(`v${i}`);
        }
        // For a CONNECT tunnel, proxy.headers go only in the CONNECT
        // envelope; the tunneled inner request does not carry them.
        // Absolute-form proxies forward the whole request head, so the
        // origin sees them there — that's the proxy's forwarding, not
        // the client's.
        if (originTls) {
          expect(origin.requests[0].headers[`x-proxy-0`]).toBeUndefined();
        }
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// `proxy: ""` is accepted and, with no ambient HTTP(S)_PROXY, goes direct.
// Note: FetchTasklet.rs documents `proxy: ""` as "explicitly no proxy",
// but the option parser (fetch.rs) treats an empty string the same as
// absent, so ambient env proxies are NOT overridden. That discrepancy is
// out of scope here; this test only covers the no-ambient case (env is
// cleared by the file-level beforeAll).
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy: "" with no ambient env', () => {
  for (const originTls of [false, true] as const) {
    test.concurrent(`${originTls ? "https" : "http"}-origin, proxy:"" goes direct`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "direct" });
      const res = await fetch(origin.url, {
        proxy: "",
        keepalive: false,
        tls: laxTls,
      });
      expect(await res.text()).toBe("direct");
      expect(res.status).toBe(200);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Origin responds with HTTP/1.0 (no keep-alive semantics). Through a
// tunnel, the client must still parse it correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP/1.0 origin through tunnel", () => {
  async function makeHttp10Origin(withTls: boolean) {
    const handler = (sock: net.Socket) => {
      sock.on("error", () => {});
      sock.once("data", () => {
        sock.write("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nold-school");
        sock.end();
      });
    };
    const server = withTls
      ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handler)
      : net.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `${withTls ? "https" : "http"}://localhost:${(server.address() as net.AddressInfo).port}`,
      [Symbol.asyncDispose]: async () => server.close(),
    };
  }

  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin HTTP/1.0`,
      async () => {
        await using origin = await makeHttp10Origin(originTls);
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(await res.text()).toBe("old-school");
        expect(res.status).toBe(200);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// redirect: "manual" through proxy: the 3xx is surfaced as-is; the proxy
// sees exactly one hop.
// ─────────────────────────────────────────────────────────────────────────────

describe('redirect: "manual" through proxy', () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin 302 manual`,
      async () => {
        await using target = await createAdversarialOrigin({ tls: originTls, body: "should-not-reach" });
        await using origin = await createAdversarialOrigin({ tls: originTls, redirectTo: target.url });
        // This test inspects proxy.connections, so it needs a dedicated proxy.
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          redirect: "manual",
        });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(target.url);
        expect(proxy.connections.length).toBe(1);
        expect(target.requests.length).toBe(0);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// redirect: "error" through proxy: the 3xx becomes a rejection.
// ─────────────────────────────────────────────────────────────────────────────

describe('redirect: "error" through proxy', () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin 302 error`,
      async () => {
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          redirectTo: "http://never-reached.invalid/",
        });
        // This test inspects proxy.connections, so it needs a dedicated proxy.
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        await expect(
          fetch(origin.url, {
            proxy: proxy.url,
            keepalive: false,
            tls: laxTls,
            redirect: "error",
          }),
        ).rejects.toThrow();
        expect(proxy.connections.length).toBe(1);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Response body consumed as .blob() / .json() / .bytes() through tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("response body consumers through tunnel", () => {
  for (const { proxyTls, originTls, consumer } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    consumer: ["text", "arrayBuffer", "bytes", "blob", "json"] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin .${consumer}()`,
      async () => {
        const payload = consumer === "json" ? '{"k":"v","n":42}' : makeBody(4096, "C");
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          body: payload,
          headers: consumer === "json" ? { "Content-Type": "application/json" } : {},
        });
        const proxy = sharedProxy(proxyTls);
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        switch (consumer) {
          case "text":
            expect(await res.text()).toBe(payload);
            break;
          case "arrayBuffer":
            expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(payload);
            break;
          case "bytes":
            expect(new TextDecoder().decode(await res.bytes())).toBe(payload);
            break;
          case "blob": {
            const b = await res.blob();
            expect(await b.text()).toBe(payload);
            break;
          }
          case "json":
            expect(await res.json()).toEqual({ k: "v", n: 42 });
            break;
        }
      },
    );
  }
});
