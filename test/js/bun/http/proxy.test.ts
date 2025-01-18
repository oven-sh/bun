import axios from "axios";
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { HttpsProxyAgent } from "https-proxy-agent";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
async function createProxyServer(is_tls: boolean) {
  const serverArgs = [];
  if (is_tls) {
    serverArgs.push({
      ...tlsCert,
      rejectUnauthorized: false,
    });
  }
  const log: Array<string> = [];
  serverArgs.push((clientSocket: net.Socket | tls.TLSSocket) => {
    clientSocket.once("data", data => {
      const request = data.toString();
      const [method, path] = request.split(" ");
      let host: string;
      let port: number | string = 0;
      let request_path = "";
      if (path.indexOf("http") !== -1) {
        const url = new URL(path);
        host = url.hostname;
        port = url.port;
        request_path = url.pathname + (url.search || "");
      } else {
        // Extract the host and port from the CONNECT request
        [host, port] = path.split(":");
      }
      const destinationPort = Number.parseInt((port || (method === "CONNECT" ? "443" : "80")).toString(), 10);
      const destinationHost = host || "";
      log.push(`${method} ${host}:${port}${request_path}`);

      // Establish a connection to the destination server
      const serverSocket = net.connect(destinationPort, destinationHost, () => {
        if (method === "CONNECT") {
          // 220 OK with host so the client knows the connection was successful
          clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");

          // Pipe data between client and server
          clientSocket.pipe(serverSocket);
          serverSocket.pipe(clientSocket);
        } else {
          serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
          // Send the request to the destination server
          serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
          serverSocket.pipe(clientSocket);
        }
      });
      // ignore client errors (can happen because of happy eye balls and now we error on write when not connected for node.js compatibility)
      clientSocket.on("error", () => {});

      serverSocket.on("error", err => {
        clientSocket.end();
      });
    });
  });
  // Create a server to listen for incoming HTTPS connections
  //@ts-ignore
  const server = (is_tls ? tls : net).createServer(...serverArgs);

  server.listen(0);
  await once(server, "listening");
  const port = server.address().port;
  const url = `http${is_tls ? "s" : ""}://localhost:${port}`;
  return { server, url, log: log };
}

let httpServer: Server;
let httpsServer: Server;
let httpProxyServer: { server: net.Server; url: string; log: string[] };
let httpsProxyServer: { server: net.Server; url: string; log: string[] };

beforeAll(async () => {
  httpServer = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "POST") {
        const text = await req.text();
        return new Response(text, { status: 200 });
      }
      return new Response("", { status: 200 });
    },
  });

  httpsServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    async fetch(req) {
      if (req.method === "POST") {
        const text = await req.text();
        return new Response(text, { status: 200 });
      }
      return new Response("", { status: 200 });
    },
  });

  httpProxyServer = await createProxyServer(false);
  httpsProxyServer = await createProxyServer(true);
});

afterAll(() => {
  httpServer.stop();
  httpsServer.stop();
  httpProxyServer.server.close();
  httpsProxyServer.server.close();
});

for (const proxy_tls of [false, true]) {
  for (const target_tls of [false, true]) {
    for (const body of [undefined, "Hello, World"]) {
      test(`${body === undefined ? "GET" : "POST"} ${proxy_tls ? "TLS" : "non-TLS"} proxy -> ${target_tls ? "TLS" : "non-TLS"} body type ${typeof body}`, async () => {
        const response = await fetch(target_tls ? httpsServer.url : httpServer.url, {
          method: body === undefined ? "GET" : "POST",
          proxy: proxy_tls ? httpsProxyServer.url : httpProxyServer.url,
          headers: {
            "Content-Type": "plain/text",
          },
          keepalive: false,
          body: body,
          tls: {
            ca: tlsCert.cert,
            rejectUnauthorized: false,
          },
        });
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
        expect(response.statusText).toBe("OK");
        const result = await response.text();

        expect(result).toBe(body || "");
      });
    }
  }
}

for (const server_tls of [false, true]) {
  describe(`proxy can handle redirects with ${server_tls ? "TLS" : "non-TLS"} server`, () => {
    test("with empty body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          if (req.url.endsWith("/bunbun")) {
            return Response.redirect("/bun", 302);
          }
          if (req.url.endsWith("/bun")) {
            return Response.redirect("/", 302);
          }
          return new Response("", { status: 403 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      expect(response.statusText).toBe("Forbidden");
    });

    test("with body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          if (req.url.endsWith("/bunbun")) {
            return new Response("Hello, bunbun", { status: 302, headers: { Location: "/bun" } });
          }
          if (req.url.endsWith("/bun")) {
            return new Response("Hello, bun", { status: 302, headers: { Location: "/" } });
          }
          return new Response("BUN!", { status: 200 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe("OK");

      const result = await response.text();
      expect(result).toBe("BUN!");
    });

    test("with chunked body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          async function* body() {
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
          }
          if (req.url.endsWith("/bunbun")) {
            return new Response(body, { status: 302, headers: { Location: "/bun" } });
          }
          if (req.url.endsWith("/bun")) {
            return new Response(body, { status: 302, headers: { Location: "/" } });
          }
          return new Response(body, { status: 200 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe("OK");

      const result = await response.text();
      expect(result).toBe("bunbunbunbun");
    });
  });
}

test("unsupported protocol", async () => {
  expect(
    fetch("https://httpbin.org/get", {
      proxy: "ftp://asdf.com",
    }),
  ).rejects.toThrowError(
    expect.objectContaining({
      code: "UnsupportedProxyProtocol",
    }),
  );
});

test("axios with https-proxy-agent", async () => {
  httpProxyServer.log.length = 0;
  const httpsAgent = new HttpsProxyAgent(httpProxyServer.url, {
    rejectUnauthorized: false, // this should work with self-signed certs
  });

  const result = await axios.get(httpsServer.url.href, {
    httpsAgent,
  });
  expect(result.data).toBe("");
  // did we got proxied?
  expect(httpProxyServer.log).toEqual([`CONNECT localhost:${httpsServer.port}`]);
});
