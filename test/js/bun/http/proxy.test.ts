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

/**
 * Creates an HTTP proxy server that captures Proxy-Authorization headers.
 * The server forwards requests to their destination and pipes responses back.
 */
async function createAuthCapturingProxy() {
  const capturedAuths: string[] = [];
  const server = net.createServer((clientSocket: net.Socket) => {
    clientSocket.once("data", data => {
      const request = data.toString();
      const lines = request.split("\r\n");
      for (const line of lines) {
        if (line.toLowerCase().startsWith("proxy-authorization:")) {
          capturedAuths.push(line.substring("proxy-authorization:".length).trim());
        }
      }

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
        [host, port] = path.split(":");
      }
      const destinationPort = Number.parseInt((port || "80").toString(), 10);
      const destinationHost = host || "";

      const serverSocket = net.connect(destinationPort, destinationHost, () => {
        serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
        serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
        serverSocket.pipe(clientSocket);
      });
      clientSocket.on("error", () => {});
      serverSocket.on("error", () => {
        clientSocket.end();
      });
    });
  });

  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  return {
    server,
    port,
    capturedAuths,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("proxy with long password (> 4096 chars) sends correct authorization", async () => {
  const proxy = await createAuthCapturingProxy();

  // Create a password longer than 4096 chars (e.g., simulating a JWT token)
  // Use Buffer.alloc which is faster in debug JavaScriptCore builds
  const longPassword = Buffer.alloc(5000, "a").toString();
  const username = "testuser";
  const proxyUrl = `http://${username}:${longPassword}@localhost:${proxy.port}`;

  try {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: proxyUrl,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    // Verify the auth header was sent and contains both username and password
    expect(proxy.capturedAuths.length).toBeGreaterThanOrEqual(1);
    const capturedAuth = proxy.capturedAuths[0];
    expect(capturedAuth.startsWith("Basic ")).toBe(true);

    // Decode and verify
    const encoded = capturedAuth.substring("Basic ".length);
    const decoded = Buffer.from(encoded, "base64url").toString();
    expect(decoded).toBe(`${username}:${longPassword}`);
  } finally {
    await proxy.close();
  }
});

test("proxy with long password (> 4096 chars) works correctly after redirect", async () => {
  // This test verifies that the reset() code path (used during redirects)
  // also handles long passwords correctly
  const proxy = await createAuthCapturingProxy();

  // Create a server that issues a redirect
  using redirectServer = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith("/redirect")) {
        return Response.redirect("/final", 302);
      }
      return new Response("OK", { status: 200 });
    },
  });

  // Use Buffer.alloc which is faster in debug JavaScriptCore builds
  const longPassword = Buffer.alloc(5000, "a").toString();
  const username = "testuser";
  const proxyUrl = `http://${username}:${longPassword}@localhost:${proxy.port}`;

  try {
    const response = await fetch(`${redirectServer.url.origin}/redirect`, {
      method: "GET",
      proxy: proxyUrl,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("OK");

    // Verify auth was sent on requests. Due to connection reuse, the proxy may
    // only see one request even though a redirect occurred (the redirected
    // request reuses the same connection). We verify at least one auth was sent
    // and that all captured auths are correct.
    expect(proxy.capturedAuths.length).toBeGreaterThanOrEqual(1);
    for (const capturedAuth of proxy.capturedAuths) {
      expect(capturedAuth.startsWith("Basic ")).toBe(true);
      const encoded = capturedAuth.substring("Basic ".length);
      const decoded = Buffer.from(encoded, "base64url").toString();
      expect(decoded).toBe(`${username}:${longPassword}`);
    }
  } finally {
    await proxy.close();
  }
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

test("HTTPS over HTTP proxy preserves TLS record order with large bodies", async () => {
  // Create a custom HTTPS server that returns body size for this test
  using customServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    async fetch(req) {
      // return the body size
      const buf = await req.arrayBuffer();
      return new Response(String(buf.byteLength), { status: 200 });
    },
  });

  // Test with multiple body sizes to ensure TLS record ordering is preserved
  // also testing several times because it's flaky otherwise
  const testCases = [
    16 * 1024 * 1024, // 16MB
    32 * 1024 * 1024, // 32MB
  ];

  for (const size of testCases) {
    const body = new Uint8Array(size).fill(0x61); // 'a'

    const response = await fetch(customServer.url, {
      method: "POST",
      proxy: httpProxyServer.url,
      headers: { "Content-Type": "application/octet-stream" },
      body,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    const result = await response.text();

    // recvd body size should exactly match the sent body size
    expect(result).toBe(String(size));
  }
});

test("HTTPS origin close-delimited body via HTTP proxy does not ECONNRESET", async () => {
  // Inline raw HTTPS origin: 200 + no Content-Length then close
  const originServer = tls.createServer(
    { ...tlsCert, rejectUnauthorized: false },
    (clientSocket: net.Socket | tls.TLSSocket) => {
      clientSocket.once("data", () => {
        const body = "ok";
        // ! Notice we are not using a Content-Length header here, this is what is causing the issue
        const resp = "HTTP/1.1 200 OK\r\n" + "content-type: text/plain\r\n" + "connection: close\r\n" + "\r\n" + body;
        clientSocket.write(resp);
        clientSocket.end();
      });
      clientSocket.on("error", () => {});
    },
  );
  originServer.listen(0);
  await once(originServer, "listening");
  const originURL = `https://localhost:${(originServer.address() as net.AddressInfo).port}`;
  try {
    const res = await fetch(originURL, {
      method: "POST",
      body: "x",
      proxy: httpProxyServer.url,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("ok");
  } finally {
    originServer.close();
    await once(originServer, "close");
  }
});

describe("proxy object format with headers", () => {
  test("proxy object with url string works same as string proxy", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with url and headers sends headers to proxy (HTTP proxy)", async () => {
    // Create a proxy server that captures headers
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        // Capture headers
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-proxy-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

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
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || (method === "CONNECT" ? "443" : "80")).toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          if (method === "CONNECT") {
            clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");
            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
          } else {
            serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
            serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
            serverSocket.pipe(clientSocket);
          }
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: {
            "X-Proxy-Custom-Header": "custom-value",
            "X-Proxy-Another": "another-value",
          },
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Verify the custom headers were sent to the proxy (case-insensitive check)
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-custom-header: custom-value"));
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-another: another-value"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("proxy object with url and headers sends headers in CONNECT request (HTTPS target)", async () => {
    // Create a proxy server that captures headers
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        // Capture headers
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-proxy-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

        const [method, path] = request.split(" ");
        let host: string;
        let port: number | string = 0;
        if (path.indexOf("http") !== -1) {
          const url = new URL(path);
          host = url.hostname;
          port = url.port;
        } else {
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || (method === "CONNECT" ? "443" : "80")).toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          if (method === "CONNECT") {
            clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");
            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
          } else {
            clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            clientSocket.end();
          }
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const response = await fetch(httpsServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: new Headers({
            "X-Proxy-Auth-Token": "secret-token-123",
          }),
        },
        keepalive: false,
        tls: {
          ca: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Verify the custom headers were sent in the CONNECT request (case-insensitive check)
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-auth-token: secret-token-123"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("proxy object without url is ignored (regression #25413)", async () => {
    // When proxy object doesn't have a 'url' property, it should be ignored
    // This ensures compatibility with libraries that pass URL objects as proxy
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        headers: { "X-Test": "value" },
      } as any,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with null url is ignored (regression #25413)", async () => {
    // When proxy.url is null, the proxy object should be ignored
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: null,
        headers: { "X-Test": "value" },
      } as any,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with empty string url throws error", async () => {
    await expect(
      fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: "",
          headers: { "X-Test": "value" },
        } as any,
        keepalive: false,
      }),
    ).rejects.toThrow("fetch() proxy.url must be a non-empty string");
  });

  test("proxy object with empty headers object works", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
        headers: {},
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with undefined headers works", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
        headers: undefined,
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with headers as Headers instance", async () => {
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-custom-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

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
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || "80").toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
          serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
          serverSocket.pipe(clientSocket);
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const headers = new Headers();
      headers.set("X-Custom-Header-1", "value1");
      headers.set("X-Custom-Header-2", "value2");

      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: headers,
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Case-insensitive check
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-custom-header-1: value1"));
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-custom-header-2: value2"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("user-provided Proxy-Authorization header overrides URL credentials", async () => {
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("proxy-authorization:")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

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
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || "80").toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
          serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
          serverSocket.pipe(clientSocket);
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    // Proxy URL with credentials that would generate Basic auth
    const proxyUrl = `http://urluser:urlpass@localhost:${proxyPort}`;

    try {
      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: {
            // User-provided Proxy-Authorization should override the URL-based one
            "Proxy-Authorization": "Bearer custom-token-12345",
          },
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Should only have one Proxy-Authorization header (the user-provided one)
      expect(capturedHeaders.length).toBe(1);
      expect(capturedHeaders[0]).toBe("proxy-authorization: bearer custom-token-12345");
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("proxy as URL object should be ignored (no url property)", async () => {
    // This tests the regression from #25413
    // When a URL object is passed as proxy, it should be ignored (no error)
    // because URL objects don't have a "url" property - they have "href"
    const proxyUrl = new URL(httpProxyServer.url);

    // Passing a URL object as proxy should NOT throw an error
    // It should just be ignored since there's no "url" string property
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: proxyUrl as any,
      keepalive: false,
    });
    // The request should succeed (without proxy, since URL object is ignored)
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });
});
