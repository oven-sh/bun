// Regression test for WebSocket upgrade request crash on non-ASCII inputs.
//
// The HTTP upgrade request is built in Zig. Before the fix, header values,
// host, path, client protocol and proxy parameters were passed from C++ as
// `ZigString` wrappers over the underlying `WTF::StringImpl`. When a
// WTFStringImpl was not 8-bit ASCII (either Latin1 with high bytes, or UTF-16),
// calling `.slice()` on the ZigString returned raw Latin1 / UTF-16 code units.
// Those bytes were then substituted into a printf-like format string and the
// resulting garbage length could cause heap corruption in mimalloc
// (`_mi_heap_realloc_zero`) during `std.fmt.allocPrint`.
//
// The fix migrates the WebSocket upgrade client FFI from ZigString to
// BunString and decodes host, path and protocol to UTF-8. Header values are
// ByteStrings (https://fetch.spec.whatwg.org/#concept-header-value) and are
// isomorphic-encoded: one byte per code unit, the same as `fetch()`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";
import { basename } from "node:path";

// "path-\u{1F525}" forces JSC to materialize the backing StringImpl as
// 16-bit UTF-16, which is the other half of the regression path.
const UTF16_PATH_SEGMENT = "path-\u{1F525}";
const UTF16_SUBPROTOCOL_SENTINEL = "proto-\u{1F525}";

// Track every server we spin up so afterEach cleans them up even if a test
// throws before closing its own fixtures.
const servers: net.Server[] = [];

function track(server: net.Server) {
  servers.push(server);
  return server;
}

async function listenEphemeral(
  onConnection?: (socket: net.Socket) => void,
): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer(onConnection);
  track(server);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return { port: (server.address() as net.AddressInfo).port, server };
}

// Returns an ephemeral port whose server stays bound for the duration of the
// test and immediately destroys any incoming connection. This avoids the
// TOCTOU race of "bind → close → hope nothing else grabs the port" — the port
// is held until afterEach() tears the server down.
async function deadPort(): Promise<number> {
  const { port } = await listenEphemeral(socket => socket.destroy());
  return port;
}

beforeEach(() => {
  servers.length = 0;
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    try {
      if (server.listening) await new Promise<void>(r => server.close(() => r()));
    } catch {}
  }
});

describe("WebSocket upgrade with non-ASCII inputs", () => {
  test("Latin1 header value with high bytes is isomorphic-encoded on the wire, like fetch()", async () => {
    // Spin up a trivial TCP listener that captures the raw upgrade request
    // bytes. We only need to inspect what the client *sent*; we don't need
    // the WebSocket handshake to complete, so the server destroys the socket
    // as soon as it has the full request headers.
    const gotRequest = Promise.withResolvers<Buffer>();
    const { port } = await listenEphemeral(socket => {
      const chunks: Buffer[] = [];
      socket.on("data", chunk => {
        chunks.push(chunk);
        const joined = Buffer.concat(chunks);
        if (joined.includes("\r\n\r\n")) {
          gotRequest.resolve(joined);
          socket.destroy();
        }
      });
      socket.once("error", gotRequest.reject);
    });

    // "vàlüé-ñ" contains U+00E0, U+00FC, U+00E9, U+00F1 — all in Latin1
    // range, so the underlying WTFStringImpl stays 8-bit.
    const latin1Value = "vàlüé-ñ";
    // path.basename returns a 16-bit-backed string whose code units are all
    // <= 0xFF. It passes ByteString validation but is not 8-bit in memory.
    const utf16BackedValue = basename("café.txt");
    const wsDone = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
      headers: {
        "X-Latin1": latin1Value,
        "X-Utf16": utf16BackedValue,
      },
    });
    ws.onerror = () => wsDone.resolve();
    ws.onclose = () => wsDone.resolve();

    const request = await gotRequest.promise;
    await wsDone.promise;

    // Header values are ByteStrings: U+00E0 goes out as the single byte 0xE0,
    // not the UTF-8 pair 0xC3 0xA0. This matches fetch(), Node and Deno.
    const lines = request.toString("latin1").split("\r\n");
    const wire = (name: string) => {
      const line = lines.find(l => l.startsWith(name + ":"));
      expect(line).toBeDefined();
      return Buffer.from(line!, "latin1").subarray(name.length + 2);
    };
    expect(wire("X-Latin1")).toEqual(Buffer.from(latin1Value, "latin1"));
    expect(wire("X-Latin1").toString("latin1")).toBe(latin1Value);
    expect(wire("X-Utf16")).toEqual(Buffer.from(utf16BackedValue, "latin1"));
  });

  test("Latin1 header value round-trips through a Bun.serve upgrade handler", async () => {
    const latin1Value = "café-ñ";
    const gotHeader = Promise.withResolvers<string | null>();
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        gotHeader.resolve(req.headers.get("x-latin1"));
        if (server.upgrade(req)) return;
        return new Response("not upgraded", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });

    const wsDone = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: { "X-Latin1": latin1Value },
    });
    ws.onerror = () => wsDone.resolve();
    ws.onclose = () => wsDone.resolve();

    expect(await gotHeader.promise).toBe(latin1Value);
    await wsDone.promise;
  });

  test("UTF-16 URL path is decoded to UTF-8 without crashing", async () => {
    // `new URL(...)` with a non-Latin1 path produces a 16-bit-backed
    // WTFStringImpl for the parsed URL. Before the fix, the Zig side called
    // `.slice()` on that and wrote raw UTF-16 bytes into the upgrade request.
    // The target port immediately destroys any connection so the WebSocket
    // fails quickly — we only care that the upgrade request build doesn't
    // crash.
    const port = await deadPort();
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${UTF16_PATH_SEGMENT}`);
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("UTF-16 subprotocol is rejected by the spec validator without crashing", async () => {
    // A subprotocol containing codepoints > U+00FF is rejected by the
    // WebSocket spec validator (which only allows HTTP tokens), so the
    // constructor throws a SyntaxError. The important thing is that the
    // validator runs before the Zig side sees the string and crashes.
    const port = await deadPort();
    expect(
      () =>
        new WebSocket(`ws://127.0.0.1:${port}/`, {
          protocols: [UTF16_SUBPROTOCOL_SENTINEL],
        }),
    ).toThrow();
  });

  test("does not crash when target URL path contains non-ASCII Latin1 characters", async () => {
    const port = await deadPort();
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/pâth/ünîcôdé`);
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash when proxy target with Latin1 header + tls is unreachable", async () => {
    // Proxy + custom TLS config + non-ASCII headers — this is the combination
    // that matched the original crash backtrace. Construct, let it fail to
    // connect, and make sure nothing heap-corrupts along the way.
    const [targetPort, proxyPort] = await Promise.all([deadPort(), deadPort()]);
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(`wss://127.0.0.1:${targetPort}/`, {
      headers: {
        "X-Latin1": "vàlüé-ñ",
        Authorization: "Bearer tökën",
      },
      proxy: `http://127.0.0.1:${proxyPort}`,
      tls: {
        cert: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        key: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
        rejectUnauthorized: false,
      },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash with many Latin1 headers through proxy", async () => {
    const [targetPort, proxyPort] = await Promise.all([deadPort(), deadPort()]);
    const { promise, resolve } = Promise.withResolvers<void>();
    const headers: Record<string, string> = {};
    for (let i = 0; i < 16; i++) {
      headers[`X-Hdr-${i}`] = `vàlüé-${i}-ñ`.repeat(4);
    }
    const ws = new WebSocket(`wss://127.0.0.1:${targetPort}/`, {
      headers,
      proxy: `http://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });

  test("does not crash with Latin1 proxy header values", async () => {
    const [targetPort, proxyPort] = await Promise.all([deadPort(), deadPort()]);
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${targetPort}/`, {
      proxy: {
        url: `http://127.0.0.1:${proxyPort}`,
        headers: {
          "X-Proxy": "prôxy-vàlüé",
        },
      },
    });
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    expect(true).toBe(true);
  });
});
