import { jscDescribe } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
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

  // `ws://user:pass@host` sends the userinfo as Basic credentials. Each percent-escape decodes to
  // one raw byte, whether or not the result is valid UTF-8, same as fetch() and curl. The client
  // used to decode the userinfo as UTF-8 text, so `user:pa%ffss` sent `user:` and `us%ffer:pass`
  // sent no header.
  describe("Authorization from the URL userinfo", () => {
    /** `sent` is the decoded Basic credentials, one char per byte, or `null` if there was no Authorization header. */
    type Row = [userinfo: string, sent: string | string[] | null];
    type Connect = (url: string) => WebSocket;

    /**
     * Connects one client per row to a server that records the upgrade request and rejects it.
     * Returns the rows with `sent` set to what each client sent. Non-Basic values aren't decoded.
     */
    async function authorizationSent(rows: Row[], connect: Connect, secure = false): Promise<Row[]> {
      const requests = new Map<string, string[]>();
      using server = Bun.listen<{ head: string }>({
        hostname: "127.0.0.1",
        port: 0,
        tls: secure ? tls : undefined,
        socket: {
          open(socket) {
            socket.data = { head: "" };
          },
          data(socket, chunk) {
            socket.data.head += chunk.toString("latin1");
            const end = socket.data.head.indexOf("\r\n\r\n");
            if (end === -1) return;
            const [requestLine, ...headers] = socket.data.head.slice(0, end).split("\r\n");
            const values = headers.filter(line => /^authorization:/i.test(line)).map(line => line.split(": ")[1]);
            requests.set(requestLine.split(" ")[1], values);
            socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          },
        },
      });

      await Promise.all(
        rows.map(([userinfo], row) => {
          const closed = Promise.withResolvers<void>();
          const authority = `${userinfo}${userinfo ? "@" : ""}127.0.0.1:${server.port}`;
          const ws = connect(`${secure ? "wss" : "ws"}://${authority}/${row}`);
          ws.onerror = () => {};
          ws.onclose = () => closed.resolve();
          return closed.promise;
        }),
      );

      const decodeBasic = (value: string) =>
        value.startsWith("Basic ") ? Buffer.from(value.slice("Basic ".length), "base64").toString("latin1") : value;
      return rows.map(([userinfo], row) => {
        const values = (requests.get(`/${row}`) ?? ["(no request)"]).map(decodeBasic);
        return [userinfo, values.length > 1 ? values : (values[0] ?? null)];
      });
    }

    const user100 = Buffer.alloc(100, "u").toString();
    const rows: Row[] = [
      // Escapes that aren't valid UTF-8.
      ["user:pa%ffss", "user:pa\xffss"],
      ["us%ffer:pass", "us\xffer:pass"],
      ["%ff:%ff", "\xff:\xff"],
      ["user:p%E9ss", "user:p\xe9ss"],
      ["user:p%C3ss", "user:p\xc3ss"],
      // A password without a username (RFC 7617 allows an empty user-id).
      [":pass", ":pass"],
      [":pa%ffss", ":pa\xffss"],
      // Plain text, and escapes that are valid UTF-8.
      ["user:pass", "user:pass"],
      ["user", "user:"],
      ["user:", "user:"],
      ["user:p%C3%A9ss", "user:p\xc3\xa9ss"],
      ["us\u00e9r:p\u2603ss", "us\xc3\xa9r:p\xe2\x98\x83ss"],
      ["us%3Aer:pass", "us:er:pass"],
      ["user:pa%25ss", "user:pa%ss"],
      ["user:pa%00ss", "user:pa\x00ss"],
      ["user%40example.com:p%40ss%3Aword", "user@example.com:p@ss:word"],
      // A `%` that doesn't start a valid escape is kept as is, and so are hex digits without a `%`.
      ["user:pa%zzss", "user:pa%zzss"],
      ["user:pa%fzss", "user:pa%fzss"],
      ["user:pa%zfss", "user:pa%zfss"],
      ["user:pa%f", "user:pa%f"],
      ["user:pa%", "user:pa%"],
      ["cafe12:beef34", "cafe12:beef34"],
      // Longer than the decoder's 128-byte inline buffer.
      [
        `${user100}:${Buffer.alloc(360, "%C3%A9").toString()}`,
        `${user100}:${Buffer.alloc(120, "\xc3\xa9", "latin1").toString("latin1")}`,
      ],
      ["", null],
    ];

    test.concurrent("percent-decodes the userinfo to raw bytes", async () => {
      expect(await authorizationSent(rows, url => new WebSocket(url))).toEqual(rows);
    });

    // Covers every constructor overload, and both the plain and TLS upgrade clients.
    const sampleRows: Row[] = [
      ["user:pa%ffss", "user:pa\xffss"],
      ["us%ffer:pass", "us\xffer:pass"],
      [":pass", ":pass"],
      ["user:pass", "user:pass"],
    ];
    // The URL parser reuses an input string that's already canonical, so the userinfo stays 16-bit.
    const to16BitString = (text: string) => {
      const wide = new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le"));
      expect(jscDescribe(wide)).toContain("8Bit:(0)");
      return wide;
    };
    const overloads: [name: string, connect: Connect, secure: boolean][] = [
      ["a URL object", url => new WebSocket(new URL(url)), false],
      ["a URL in a 16-bit string", url => new WebSocket(to16BitString(url)), false],
      ["a protocol string", url => new WebSocket(url, "chat"), false],
      ["a protocol list", url => new WebSocket(url, ["chat"]), false],
      ["an options object", url => new WebSocket(url, { headers: { "X-Other": "1" } }), false],
      ["a wss:// URL", url => new WebSocket(url, { tls: { rejectUnauthorized: false } }), true],
    ];
    test.concurrent.each(overloads)("sends the credentials with %s", async (_, connect, secure) => {
      expect(await authorizationSent(sampleRows, connect, secure)).toEqual(sampleRows);
    });

    test.concurrent("an explicit Authorization header overrides the userinfo", async () => {
      const header = { Authorization: "Bearer from-headers" };
      expect({
        headers: await authorizationSent(sampleRows, url => new WebSocket(url, { headers: header })),
        noHeader: await authorizationSent(sampleRows, url => new WebSocket(url, { headers: {} })),
      }).toEqual({
        headers: sampleRows.map(([userinfo]) => [userinfo, header.Authorization]),
        noHeader: sampleRows,
      });
    });
  });
});
