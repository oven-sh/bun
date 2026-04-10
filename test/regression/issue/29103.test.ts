// https://github.com/oven-sh/bun/issues/29103
//
// `fetch()` must accept a WHATWG `URL` object for `proxy.url`, not just a
// string. `@npmcli/agent` (used by the entire npm registry ecosystem)
// constructs its proxy option as `{ url: new URL(process.env.HTTPS_PROXY) }`,
// so any npm operation run through an `HTTP(S)_PROXY` environment variable
// previously blew up with:
//
//     fetch() proxy.url must be a non-empty string
//
// The top-level `proxy: string | URL` path already went through
// `URL.hrefFromJS`, which happily normalizes a `URL` instance via its
// `toString()`. The object form was gratuitously stricter.
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";

async function createHttpProxy() {
  const log: string[] = [];
  const server = net.createServer(clientSocket => {
    clientSocket.once("data", data => {
      const request = data.toString();
      const firstLine = request.split("\r\n", 1)[0] ?? "";
      const [method, rawPath] = firstLine.split(" ");

      let host = "";
      let port: string | number = 0;
      let requestPath = "";
      if (rawPath && rawPath.indexOf("http") !== -1) {
        const parsed = new URL(rawPath);
        host = parsed.hostname;
        port = parsed.port;
        requestPath = parsed.pathname + (parsed.search || "");
      } else if (rawPath) {
        [host, port] = rawPath.split(":");
      }

      const destinationPort = Number.parseInt(
        (port || (method === "CONNECT" ? "443" : "80")).toString(),
        10,
      );
      log.push(`${method} ${host}:${port}${requestPath}`);

      const upstream = net.connect(destinationPort, host, () => {
        if (method === "CONNECT") {
          clientSocket.write("HTTP/1.1 200 OK\r\n\r\n");
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        } else {
          upstream.write(`${method} ${requestPath} HTTP/1.1\r\n`);
          upstream.write(data.slice(request.indexOf("\r\n") + 2));
          upstream.pipe(clientSocket);
        }
      });

      clientSocket.on("error", () => {});
      upstream.on("error", () => {
        clientSocket.end();
      });
    });
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return { server, url: `http://localhost:${port}`, log };
}

let originServer: Server;
let proxyServer: { server: net.Server; url: string; log: string[] };

beforeAll(async () => {
  originServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  proxyServer = await createHttpProxy();
});

afterAll(async () => {
  originServer?.stop(true);
  proxyServer?.server.close();
  if (proxyServer?.server) await once(proxyServer.server, "close");
});

describe.concurrent("fetch() proxy.url accepts a URL object (#29103)", () => {
  test("proxy: { url: new URL(...) } routes through the proxy", async () => {
    // This is exactly the shape `@npmcli/agent` produces for its proxy getter.
    const response = await fetch(originServer.url, {
      proxy: { url: new URL(proxyServer.url) },
      keepalive: false,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    // Confirm the request actually went through the proxy, not direct.
    expect(proxyServer.log.length).toBeGreaterThan(0);
  });

  test("proxy: { url: '' } still rejects with the legacy message", async () => {
    // Empty strings remain an error so users with broken env vars still
    // get a clear signal instead of silently bypassing the proxy.
    let err: unknown;
    try {
      await fetch(originServer.url, {
        proxy: { url: "" },
        keepalive: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as Error).message).toBe("fetch() proxy.url must be a non-empty string");
  });

  test("proxy: { url: 'not a valid url' } rejects with 'proxy URL is invalid'", async () => {
    // Matches the top-level `proxy: string` branch's error for garbage input.
    let err: unknown;
    try {
      await fetch(originServer.url, {
        proxy: { url: "not a valid url" },
        keepalive: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as Error).message).toBe("fetch() proxy URL is invalid");
  });
});
