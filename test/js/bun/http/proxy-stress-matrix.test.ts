/**
 * Protocol × framing × encoding × body-shape matrix through an HTTP proxy.
 *
 * Every cell here is a request that must round-trip a known payload through
 * a proxy; the assertion is on the decoded body, not just the status. This
 * exercises the full ProxyTunnel decode path (SSLWrapper decrypt → on_data →
 * handle_response_body / handle_response_body_chunked_encoding →
 * InternalState::decompress_bytes) across every supported combination.
 *
 * See proxy-stress-helpers.ts for the proxy/origin infrastructure.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AdversarialProxy,
  BodyEncoding,
  BodyFraming,
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  laxTls,
  makeBody,
  restoreProxyEnv,
} from "./proxy-stress-helpers";

// Concurrent stateless cases share one {http, https} proxy pair to avoid
// ephemeral-port churn under test.concurrent; cases that pass non-default
// proxy options or inspect proxy.connections still create a dedicated proxy.
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

// Find this test's entry in the shared proxy log: the origin port is unique
// while its `await using` scope holds it, so the single record in
// `connections.slice(before)` whose target is that exact port is ours.
function ownConnections(proxy: AdversarialProxy, before: number, originPort: number) {
  const p = `:${originPort}`;
  return proxy.connections.slice(before).filter(c => c.target.endsWith(p) || c.target.includes(p + "/"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Response-side matrix: every way the origin can frame/encode a body, through
// every proxy/origin TLS combination.
// ─────────────────────────────────────────────────────────────────────────────

// Two body sizes: one that fits a single TLS record, one that spans several.
const BODY_SIZES = [128, 64 * 1024] as const;

const RESPONSE_MATRIX = cartesian({
  proxyTls: [false, true] as const,
  originTls: [false, true] as const,
  framing: ["content-length", "chunked", "close-delimited"] as const satisfies readonly BodyFraming[],
  encoding: ["identity", "gzip", "deflate", "br", "zstd"] as const satisfies readonly BodyEncoding[],
  bodySize: BODY_SIZES,
  keepalive: [false, true] as const,
});

describe("response matrix", () => {
  for (const { proxyTls, originTls, framing, encoding, bodySize, keepalive } of RESPONSE_MATRIX) {
    const label =
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin ` +
      `${framing}/${encoding} ${bodySize}B keepalive=${keepalive}`;

    test.concurrent(label, async () => {
      const payload = makeBody(bodySize, "R");
      await using origin = await createAdversarialOrigin({
        tls: originTls,
        body: payload,
        framing,
        encoding,
      });
      const proxy = sharedProxy(proxyTls);
      const before = proxy.connections.length;

      const res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive,
        tls: laxTls,
      });
      const text = await res.text();
      expect({ status: res.status, len: text.length, head: text.slice(0, 8), tail: text.slice(-8) }).toEqual({
        status: 200,
        len: payload.length,
        head: payload.slice(0, 8),
        tail: payload.slice(-8),
      });

      // The request actually went through the proxy, with the right envelope.
      const mine = ownConnections(proxy, before, origin.port);
      expect(mine.length).toBe(1);
      if (originTls) {
        expect(mine[0].method).toBe("CONNECT");
      } else {
        expect(mine[0].method).toBe("GET");
        expect(mine[0].target).toStartWith("http://");
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Request-side matrix: every way the client can send a body through a proxy.
// ─────────────────────────────────────────────────────────────────────────────

type UploadShape = "string" | "Uint8Array" | "Blob" | "FormData" | "ReadableStream" | "async-iterator";

const UPLOAD_MATRIX = cartesian({
  proxyTls: [false, true] as const,
  originTls: [false, true] as const,
  shape: [
    "string",
    "Uint8Array",
    "Blob",
    "FormData",
    "ReadableStream",
    "async-iterator",
  ] as const satisfies readonly UploadShape[],
  bodySize: BODY_SIZES,
});

function makeUploadBody(
  shape: UploadShape,
  payload: string,
): { body: BodyInit; duplex?: "half"; verify: (echoed: Buffer) => void } {
  switch (shape) {
    case "string":
      return { body: payload, verify: b => expect(b.toString("latin1")).toBe(payload) };
    case "Uint8Array":
      return {
        body: new TextEncoder().encode(payload),
        verify: b => expect(b.toString("latin1")).toBe(payload),
      };
    case "Blob":
      return {
        body: new Blob([payload]),
        verify: b => expect(b.toString("latin1")).toBe(payload),
      };
    case "FormData": {
      const fd = new FormData();
      fd.set("field", payload);
      return {
        body: fd,
        // multipart encoding wraps the payload in boundaries; just assert the
        // payload bytes are present and the total is larger.
        verify: b => {
          expect(b.length).toBeGreaterThan(payload.length);
          expect(b.includes(payload)).toBe(true);
        },
      };
    }
    case "ReadableStream": {
      const chunks = [payload.slice(0, payload.length / 2), payload.slice(payload.length / 2)];
      const stream = new ReadableStream({
        start(ctrl) {
          for (const c of chunks) ctrl.enqueue(new TextEncoder().encode(c));
          ctrl.close();
        },
      });
      return {
        body: stream,
        duplex: "half",
        verify: b => expect(b.toString("latin1")).toBe(payload),
      };
    }
    case "async-iterator": {
      const chunks = [payload.slice(0, payload.length / 2), payload.slice(payload.length / 2)];
      async function* gen() {
        for (const c of chunks) yield new TextEncoder().encode(c);
      }
      return {
        body: gen() as unknown as BodyInit,
        duplex: "half",
        verify: b => expect(b.toString("latin1")).toBe(payload),
      };
    }
  }
}

describe("upload matrix", () => {
  for (const { proxyTls, originTls, shape, bodySize } of UPLOAD_MATRIX) {
    const label = `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin POST ${shape} ${bodySize}B`;
    test.concurrent(label, async () => {
      const payload = makeBody(bodySize, "U");
      await using origin = await createAdversarialOrigin({ tls: originTls, echo: true });
      const proxy = sharedProxy(proxyTls);

      const { body, duplex, verify } = makeUploadBody(shape, payload);
      const res = await fetch(origin.url, {
        method: "POST",
        body,
        ...(duplex ? { duplex } : {}),
        proxy: proxy.url,
        keepalive: false,
        tls: laxTls,
      });
      expect(res.status).toBe(200);
      // Origin echoed the exact uploaded bytes; verify shape-appropriately.
      verify(origin.requests[0].body);

      // And the client decoded the echoed response correctly.
      const echoed = Buffer.from(await res.arrayBuffer());
      verify(echoed);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Streaming-response consumption through a tunnel.
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_MATRIX = cartesian({
  proxyTls: [false, true] as const,
  originTls: [false, true] as const,
  framing: ["content-length", "chunked"] as const satisfies readonly BodyFraming[],
});

describe("streamed response via reader", () => {
  for (const { proxyTls, originTls, framing } of STREAM_MATRIX) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin ${framing} via getReader()`,
      async () => {
        const payload = makeBody(128 * 1024, "S");
        await using origin = await createAdversarialOrigin({ tls: originTls, body: payload, framing });
        const proxy = sharedProxy(proxyTls);

        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        const reader = res.body!.getReader();
        let got = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value!.length;
        }
        expect(got).toBe(payload.length);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Trickled downstream: the proxy delivers the inner TLS handshake + response
// one byte per tick. This puts the SSLWrapper state machine through hundreds
// of on_data calls per request.
// ─────────────────────────────────────────────────────────────────────────────

describe("trickled tunnel bytes", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, 1 byte/tick downstream`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "trickled", framing: "content-length" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls, trickleDownstream: true });

        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
        });
        expect(await res.text()).toBe("trickled");
        expect(res.status).toBe(200);
      },
      // The trickle is bounded (handshake ~4KB + tiny body), but one byte
      // per event-loop tick on a debug+ASAN build can take a few seconds.
      30_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Split CONNECT envelope: the `HTTP/1.1 200 ...\r\n\r\n` arrives across N
// separate reads. The client must assemble it before starting inner TLS.
// ─────────────────────────────────────────────────────────────────────────────

describe("split CONNECT reply", () => {
  for (const proxyTls of [false, true] as const) {
    for (const parts of [2, 5, 20] as const) {
      test.concurrent(`${proxyTls ? "https" : "http"}-proxy, CONNECT reply split into ${parts} writes`, async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "split-ok" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls, splitConnectReply: parts });

        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(await res.text()).toBe("split-ok");
        expect(res.status).toBe(200);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECT reply with headers the client must ignore (RFC 9110 §9.3.6):
// Content-Length / Transfer-Encoding on a 2xx CONNECT response.
// ─────────────────────────────────────────────────────────────────────────────

describe("CONNECT reply with ignored headers", () => {
  for (const extra of [
    { "Content-Length": "9999" },
    { "Transfer-Encoding": "chunked" },
    { "Content-Length": "0", "Transfer-Encoding": "chunked" },
  ]) {
    test.concurrent(`CONNECT 200 with ${Object.keys(extra).join("+")} is ignored`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "ignored-ok" });
      await using proxy = await createAdversarialProxy({ connectReplyHeaders: extra });

      const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(await res.text()).toBe("ignored-ok");
      expect(res.status).toBe(200);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Hop-by-hop header stripping: Proxy-Authorization and Proxy-Connection are
// sent to the proxy but must not reach the origin.
// ─────────────────────────────────────────────────────────────────────────────

describe("hop-by-hop headers", () => {
  for (const originTls of [false, true] as const) {
    test.concurrent(
      `Proxy-Authorization and Proxy-Connection do not reach ${originTls ? "https" : "http"} origin`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        await using proxy = await createAdversarialProxy({ auth: { user: "u", pass: "p" } });

        const res = await fetch(origin.url, {
          proxy: `http://u:p@127.0.0.1:${proxy.port}`,
          keepalive: false,
          tls: laxTls,
          headers: { "X-Reaches-Origin": "yes" },
        });
        expect(await res.text()).toBe("ok");
        expect(res.status).toBe(200);

        // Proxy saw the auth header.
        expect(proxy.connections[0].headers["proxy-authorization"]).toStartWith("Basic ");

        // Origin did not.
        const originHeaders = origin.requests[0].headers;
        expect(originHeaders["proxy-authorization"]).toBeUndefined();
        expect(originHeaders["proxy-connection"]).toBeUndefined();
        // But the user header passed through.
        expect(originHeaders["x-reaches-origin"]).toBe("yes");
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEAD / DELETE / PUT / PATCH / OPTIONS through every proxy combination.
// ─────────────────────────────────────────────────────────────────────────────

describe("method matrix", () => {
  const METHODS = ["HEAD", "DELETE", "PUT", "PATCH", "OPTIONS"] as const;
  for (const { proxyTls, originTls } of cartesian({ proxyTls: [false, true], originTls: [false, true] } as const)) {
    for (const method of METHODS) {
      test.concurrent(
        `${method} via ${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin`,
        async () => {
          await using origin = await createAdversarialOrigin({ tls: originTls, body: "m" });
          const proxy = sharedProxy(proxyTls);

          const res = await fetch(origin.url, {
            method,
            body: method === "PUT" || method === "PATCH" ? "body" : undefined,
            proxy: proxy.url,
            keepalive: false,
            tls: laxTls,
          });
          expect(res.status).toBe(200);
          // HEAD has no body.
          if (method !== "HEAD") {
            expect(await res.text()).toBe("m");
          }
          expect(origin.requests[0].method).toBe(method);
        },
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Redirect through proxy: same-origin path redirect, and cross-scheme
// http→https / https→http. Each hop must go through the proxy; the tunnel is
// torn down and re-CONNECTed on every https hop.
// ─────────────────────────────────────────────────────────────────────────────

describe("redirect through proxy", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy, http→https cross-scheme redirect`, async () => {
      await using finalOrigin = await createAdversarialOrigin({ tls: true, body: "final" });
      await using firstOrigin = await createAdversarialOrigin({ tls: false, redirectTo: finalOrigin.url });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const res = await fetch(firstOrigin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(await res.text()).toBe("final");
      expect(res.status).toBe(200);
      // First hop: absolute-form GET. Second hop: CONNECT. Both via proxy.
      expect(proxy.connections.map(c => c.method)).toEqual(["GET", "CONNECT"]);
    });

    test.concurrent(`${proxyTls ? "https" : "http"}-proxy, https→http cross-scheme redirect`, async () => {
      await using finalOrigin = await createAdversarialOrigin({ tls: false, body: "final" });
      await using firstOrigin = await createAdversarialOrigin({ tls: true, redirectTo: finalOrigin.url });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const res = await fetch(firstOrigin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(await res.text()).toBe("final");
      expect(res.status).toBe(200);
      expect(proxy.connections.map(c => c.method)).toEqual(["CONNECT", "GET"]);
    });

    test.concurrent(`${proxyTls ? "https" : "http"}-proxy, https→https cross-host redirect re-CONNECTs`, async () => {
      await using finalOrigin = await createAdversarialOrigin({ tls: true, body: "final" });
      await using firstOrigin = await createAdversarialOrigin({ tls: true, redirectTo: finalOrigin.url });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const res = await fetch(firstOrigin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(await res.text()).toBe("final");
      expect(res.status).toBe(200);
      // Two distinct https origins → two CONNECTs.
      expect(proxy.connectCount()).toBe(2);
      expect(proxy.connections[0].target).not.toBe(proxy.connections[1].target);
    });
  }
});
