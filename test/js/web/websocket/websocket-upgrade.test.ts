import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createHash } from "node:crypto";

// harness's isIPv6() looks for IPv6 interface addresses and is hardcoded false
// on BuildKite Linux; all the IPv6 test below needs is a loopback bind.
function hasIPv6Loopback() {
  try {
    Bun.listen({ hostname: "::1", port: 0, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

describe("WebSocket upgrade", () => {
  // https://github.com/oven-sh/bun/issues/2896
  // BUN_CONFIG_WS_HANDSHAKE_TIMEOUT=1: uSockets sweeps every 4 s, so the
  // effective delay is ~4-8 s, hence the 30 s test budget. The child uses
  // Bun.listen instead of node:net to avoid ~800 ms of module load in debug.
  test.concurrent(
    "fails the handshake when the server never responds",
    async () => {
      const script = `
      const srv = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/");
      const events = [];
      ws.onopen = () => events.push("open");
      ws.onerror = () => events.push("error");
      ws.onclose = (e) => {
        events.push("close:" + e.code);
        console.log(JSON.stringify(events));
        srv.stop(true);
      };
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual(["error", "close:1006"]);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent("sends the expected upgrade request headers", async () => {
    const received = Promise.withResolvers<{ upgraded: boolean; headers: Record<string, string> }>();
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        const headers = Object.fromEntries(request.headers);
        const upgraded = server.upgrade(request);
        received.resolve({ upgraded, headers });
        if (upgraded) return;
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });

    const opened = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    ws.addEventListener("open", () => opened.resolve());
    ws.addEventListener("error", opened.reject);
    await opened.promise;

    const { upgraded, headers } = await received.promise;
    expect(upgraded).toBe(true);
    expect(headers).toEqual({
      connection: "Upgrade",
      host: `127.0.0.1:${server.port}`,
      "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
      "sec-websocket-key": expect.stringMatching(/^[A-Za-z0-9+/]{22}==$/),
      "sec-websocket-version": "13",
      upgrade: "websocket",
    });

    ws.close();
  });

  // RFC 9110 §7.2: Host carries the port whenever it is not the scheme default,
  // for an IPv6 literal too. The Host writer used to take the colons inside the
  // brackets for a port and send `Host: [::1]`.
  test.concurrent.skipIf(!hasIPv6Loopback())("Host carries the port for an IPv6 literal", async () => {
    const received = Promise.withResolvers<string | null>();
    await using server = Bun.serve({
      hostname: "::1",
      port: 0,
      fetch(request, server) {
        const host = request.headers.get("host");
        if (server.upgrade(request)) {
          received.resolve(host);
          return;
        }
        received.reject(new Error("upgrade failed"));
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });

    const opened = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://[::1]:${server.port}/`);
    ws.addEventListener("open", () => opened.resolve());
    ws.addEventListener("error", opened.reject);
    await opened.promise;

    expect(await received.promise).toBe(`[::1]:${server.port}`);
    ws.close();
  });

  // RFC 6455 §4.1: Sec-WebSocket-Key "MUST be a nonce consisting of a randomly
  // selected 16-byte value". Sourcing it from a v4 UUID stamps 6 constant bits
  // (byte[6] high nibble = 4, byte[8] top two bits = 10) into every handshake,
  // which lets any peer fingerprint a Bun client.
  test.concurrent("Sec-WebSocket-Key is 16 uniformly random bytes, not a UUIDv4", async () => {
    const N = 64;
    const keys: string[] = [];
    using server = Bun.listen<{ buf: string }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { buf: "" };
        },
        data(socket, chunk) {
          socket.data.buf += chunk.toString("latin1");
          if (!socket.data.buf.includes("\r\n\r\n")) return;
          const m = socket.data.buf.match(/^Sec-WebSocket-Key:\s*(\S+)\s*$/im);
          const key = m?.[1] ?? "";
          keys.push(key);
          const accept = createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
          );
          socket.flush();
          socket.end();
        },
      },
    });

    let opened = 0;
    await Promise.all(
      Array.from({ length: N }, () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
        ws.onopen = () => opened++;
        ws.onerror = () => {};
        ws.onclose = () => resolve();
        return promise;
      }),
    );

    expect(opened).toBe(N);
    expect(keys).toHaveLength(N);
    const decoded = keys.map(k => Buffer.from(k, "base64"));
    for (const d of decoded) expect(d.length).toBe(16);

    const b6 = new Set(decoded.map(d => d[6] >> 4));
    const b8 = new Set(decoded.map(d => d[8] >> 6));
    const uuidShaped = decoded.filter(d => (d[6] & 0xf0) === 0x40 && (d[8] & 0xc0) === 0x80).length;

    // Uniform bytes: P(single-value set) is 16·16⁻ᴺ and 4·4⁻ᴺ respectively;
    // a UUIDv4 source yields {4} and {2} with certainty.
    expect(b6.size).toBeGreaterThan(1);
    expect(b8.size).toBeGreaterThan(1);
    // E[uuidShaped] = N/64 = 1 for uniform bytes; equals N under the bug.
    expect(uuidShaped).toBeLessThan(N);
  });
});
