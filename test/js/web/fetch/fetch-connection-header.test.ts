import { serve } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { join } from "node:path";
import { proxyFreeEnv } from "../../bun/http/proxy-stress-helpers";

// Sends `sends` one after another and reports what the origin saw: for each
// request its path, whether it arrived on a "new" or a "reused" connection, and
// its Connection header, then how many connections bun closed.
//
// The origin answers every request on the connection it arrived on and never
// closes one, so every "new" is a dial by bun and every close is bun's.
// Subprocess so the pool starts empty.
type KeepAliveSend = [path: string, keepAlive: "off" | "on", connection: string | null];
type KeepAliveArrival = [path: string, connection: "new" | "reused", header: string | null];
async function keepAliveArrivals(
  way: "option" | "session",
  transport: "http" | "https" | "unix" | "connect",
  sends: KeepAliveSend[],
  dials: number,
) {
  using dir = tempDir("fetch-ka-off", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import net from "node:net";
      import tls from "node:tls";
      const way = ${JSON.stringify(way)};
      const transport = ${JSON.stringify(transport)};
      const unix = ${JSON.stringify(join(String(dir), "o.sock"))};
      const secure = transport === "https" || transport === "connect";

      const requests = [];
      let connections = 0;
      let closed = 0;
      const onConnection = sock => {
        connections++;
        let served = 0;
        sock.on("error", () => {});
        sock.on("close", () => closed++);
        let buf = "";
        sock.on("data", d => {
          buf += d.toString("latin1");
          let end;
          while ((end = buf.indexOf("\\r\\n\\r\\n")) >= 0) {
            const head = buf.slice(0, end);
            buf = buf.slice(end + 4);
            const path = head.split(" ")[1];
            requests.push([path, served++ ? "reused" : "new", /^connection: *(.*)$/im.exec(head)?.[1] ?? null]);
            sock.write(
              path === "/302"
                ? "HTTP/1.1 302 Found\\r\\nLocation: /hop\\r\\nContent-Length: 0\\r\\n\\r\\n"
                : "HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok",
            );
          }
        });
      };
      const server = secure ? tls.createServer(${JSON.stringify(tls)}, onConnection) : net.createServer(onConnection);
      server.listen(...(transport === "unix" ? [unix] : [0, "127.0.0.1"]));
      await new Promise(r => server.on("listening", r));
      const origin =
        transport === "unix" ? "http://localhost" : (secure ? "https" : "http") + "://127.0.0.1:" + server.address().port;
      const route = transport === "unix" ? { unix } : secure ? { tls: { rejectUnauthorized: false } } : {};

      if (transport === "connect") {
        // One tunnel to the origin per connection from bun. A close on either
        // side closes the other.
        const proxy = net.createServer(client => {
          client.on("error", () => {});
          let head = "";
          const onHead = chunk => {
            head += chunk.toString("latin1");
            if (!head.includes("\\r\\n\\r\\n")) return;
            client.off("data", onHead);
            const upstream = net.connect(server.address().port, "127.0.0.1", () => {
              client.write("HTTP/1.1 200 Connection established\\r\\n\\r\\n");
              client.pipe(upstream);
              upstream.pipe(client);
            });
            upstream.on("error", () => {});
            upstream.on("close", () => client.destroy());
            client.on("close", () => upstream.destroy());
          };
          client.on("data", onHead);
        });
        proxy.listen(0, "127.0.0.1");
        await new Promise(r => proxy.on("listening", r));
        route.proxy = "http://127.0.0.1:" + proxy.address().port;
      }

      // How a request goes out with keep-alive off, and with it on.
      const session = way === "session" ? new Bun.FetchSession({ keepAlive: false }) : null;
      const send = {
        option: {
          off: (url, headers) => fetch(url, { ...route, keepalive: false, headers }),
          on: (url, headers) => fetch(url, { ...route, headers }),
        },
        session: {
          off: (url, headers) => session.fetch(url, { headers }),
          on: (url, headers) => session.fetch(url, { keepalive: true, headers }),
        },
      }[way];
      for (const [path, keepAlive, connection] of ${JSON.stringify(sends)}) {
        const response = await send[keepAlive](origin + path, connection === null ? {} : { Connection: connection });
        await response.text();
      }

      // bun issued each close before the response it followed resolved. All
      // connections but the one in the pool end closed. Wait for the origin to
      // observe that, unless bun dialed fewer than it should: then a request
      // left its connection in the pool and those closes never come.
      if (connections === ${dials}) {
        while (closed < ${dials - 1}) await new Promise(r => setImmediate(r));
      }
      console.log(JSON.stringify({ requests, closed }));
      process.exit(0);
      `,
    ],
    env: { ...bunEnv, ...proxyFreeEnv },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
  return { result, exitCode };
}

describe("fetch Connection header", () => {
  // Helper function to capture headers from a request
  const captureHeadersFromRequest = async (fetchOptions: RequestInit): Promise<Record<string, string>> => {
    return new Promise((resolve, reject) => {
      // Create a temporary server to capture headers
      const tempServer = serve({
        port: 0,
        fetch(req) {
          const capturedHeaders: Record<string, string> = {};
          for (const [name, value] of req.headers.entries()) {
            capturedHeaders[name.toLowerCase()] = value;
          }
          tempServer.stop();
          resolve(capturedHeaders);
          return new Response("OK");
        },
      });

      const tempPort = tempServer.port;
      const url = `http://localhost:${tempPort}/test`;

      // Make the request to temp server
      fetch(url, fetchOptions)
        .then(response => {
          if (response.status !== 200) {
            tempServer.stop();
            reject(new Error(`Expected status 200, got ${response.status}`));
          }
        })
        .catch(error => {
          tempServer.stop();
          reject(error);
        });
    });
  };

  test.each([
    ["close", "close"],
    ["keep-alive", "keep-alive"],
    ["upgrade", "upgrade"],
    ["Upgrade", "Upgrade"], // Test case preservation
  ])("should respect Connection: %s header", async (inputValue, expectedValue) => {
    const headers = await captureHeadersFromRequest({
      headers: { Connection: inputValue },
    });

    expect(headers.connection).toBe(expectedValue);
  });

  test.each([
    ["connection", "close"],
    ["Connection", "close"],
    ["CONNECTION", "close"],
  ])("should respect case-insensitive header name: %s", async (headerName, expectedValue) => {
    const headers = await captureHeadersFromRequest({
      headers: { [headerName]: expectedValue },
    });

    expect(headers.connection).toBe(expectedValue);
  });

  it("should respect Connection header in Request object", async () => {
    const headers = await captureHeadersFromRequest({
      headers: { Connection: "close" },
    });
    expect(headers.connection).toBe("close");
  });

  it("should default to keep-alive when no Connection header provided", async () => {
    const headers = await captureHeadersFromRequest({});
    expect(headers.connection).toBe("keep-alive");
  });

  it("should handle multiple headers including Connection", async () => {
    const headers = await captureHeadersFromRequest({
      headers: {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate",
        "accept-language": "en-US",
        "connection": "close",
        "user-agent": "test-agent",
        "x-test-header": "test-value",
      },
    });

    expect(headers.connection).toBe("close");
    expect(headers.accept).toBe("application/json");
    expect(headers["x-test-header"]).toBe("test-value");
  });

  // On HTTP/1.1, `keepalive: false`, or a FetchSession with `keepAlive: false`,
  // keeps a request out of the keep-alive pool: each hop goes out on a
  // connection of its own, and bun closes that connection after the response.
  // A `Connection: keep-alive` request header is sent as written and changes
  // none of that. It used to turn pooling back on once the first hop was on the
  // wire, so each request left its connection idle in the pool and a redirect's
  // hop went out on a pooled one.
  //
  // The two `/pooled` requests have keep-alive on. The first would go out on a
  // connection that an earlier request left in the pool. They leave one idle
  // connection there, which the requests after them must not take.
  test.concurrent.each([
    ["fetch() with keepalive: false", "option", "http"],
    ["a FetchSession with keepAlive: false", "session", "http"],
    ["fetch() with keepalive: false over https", "option", "https"],
    // Not run on Windows, like the unix keep-alive tests of fetch.unix.test.ts.
    ...(isWindows ? [] : [["fetch() with keepalive: false over a unix socket", "option", "unix"]]),
    ["fetch() with keepalive: false through a CONNECT proxy", "option", "connect"],
  ] as [label: string, way: "option" | "session", transport: "http" | "https" | "unix" | "connect"][])(
    "%s closes each HTTP/1.1 connection after its response, whatever the header says",
    async (_, way, transport) => {
      // A redirect leaves the unix socket, so that transport has no hop.
      const redirect = transport !== "unix";
      const sends: KeepAliveSend[] = [
        ["/no-header", "off", null],
        ["/keep-alive", "off", "keep-alive"],
        ["/pooled", "on", null],
        ["/pooled-again", "on", "keep-alive"],
        ["/token-list", "off", "X-Hop, Keep-Alive"],
        ...(redirect ? ([["/302", "off", "keep-alive"]] as KeepAliveSend[]) : []),
      ];
      const arrivals: KeepAliveArrival[] = [
        ["/no-header", "new", null],
        ["/keep-alive", "new", "keep-alive"],
        ["/pooled", "new", "keep-alive"],
        ["/pooled-again", "reused", "keep-alive"],
        ["/token-list", "new", "X-Hop, Keep-Alive"],
        ...(redirect
          ? ([
              ["/302", "new", "keep-alive"],
              ["/hop", "new", "keep-alive"],
            ] as KeepAliveArrival[])
          : []),
      ];
      const dials = redirect ? 6 : 4;
      expect(await keepAliveArrivals(way, transport, sends, dials)).toEqual({
        result: { requests: arrivals, closed: dials - 1 },
        exitCode: 0,
      });
    },
    // Subprocess start plus six TLS handshakes through a proxy takes 3.5s on a
    // debug ASAN build here, and 9s when the binary is not in the page cache.
    20_000,
  );

  // A `close` token in the request's Connection header also makes bun close
  // the connection after the response, with keep-alive on and next to a
  // `keep-alive` token too. The hop of a redirect carries the same header.
  test.concurrent("a close token closes each HTTP/1.1 connection after its response, with keep-alive on", async () => {
    const outcome = await keepAliveArrivals(
      "option",
      "http",
      [
        ["/close", "on", "close"],
        ["/keep-alive-close", "on", "keep-alive, close"],
        ["/302", "on", "X-Hop, Keep-Alive, close"],
        ["/pooled", "on", null],
        ["/pooled-again", "on", "keep-alive"],
      ],
      5,
    );
    expect(outcome).toEqual({
      result: {
        requests: [
          ["/close", "new", "close"],
          ["/keep-alive-close", "new", "keep-alive, close"],
          ["/302", "new", "X-Hop, Keep-Alive, close"],
          ["/hop", "new", "X-Hop, Keep-Alive, close"],
          ["/pooled", "new", "keep-alive"],
          ["/pooled-again", "reused", "keep-alive"],
        ],
        closed: 4,
      },
      exitCode: 0,
    });
  });
});
