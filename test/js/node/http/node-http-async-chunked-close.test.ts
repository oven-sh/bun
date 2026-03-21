import { test, expect } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";

test("http.Server closes connection after async chunked response with Connection: close", async () => {
  // Server that responds asynchronously with chunked encoding
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk1");
      res.write("chunk2");
      res.write("chunk3");
      res.end();
    }, 10);
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const result = await new Promise<{ pass: boolean; body: string }>(resolve => {
    const socket = net.createConnection(port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
    });

    const chunks: Buffer[] = [];
    socket.on("data", c => chunks.push(c));
    socket.on("end", () => {
      resolve({ pass: true, body: Buffer.concat(chunks).toString() });
    });
    socket.setTimeout(3000, () => {
      resolve({ pass: false, body: Buffer.concat(chunks).toString() });
      socket.destroy();
    });
  });

  server.close();

  expect(result.body).toContain("chunk1");
  expect(result.body).toContain("chunk2");
  expect(result.body).toContain("chunk3");
  expect(result.pass).toBe(true);
});

test("proxy with createConnection closes socket after chunked upstream response", async () => {
  // Backend responds with chunked transfer encoding
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    });
    res.write("chunk1");
    res.write("chunk2");
    res.write("chunk3");
    res.end();
  });

  // Proxy forwards via createConnection to backend
  const proxy = http.createServer((req, res) => {
    const sock = net.createConnection((backend.address() as net.AddressInfo).port, "127.0.0.1");

    const proxyReq = http.request({
      method: req.method,
      path: req.url,
      headers: { ...req.headers, connection: "close" },
      createConnection: () => sock as net.Socket,
    });

    proxyReq.on("response", proxyRes => {
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (k.toLowerCase() === "transfer-encoding") continue;
        headers[k] = v;
      }
      headers["connection"] = "close";
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", err => {
      console.error("proxyReq error:", err.message);
      res.writeHead(502);
      res.end("Bad Gateway");
    });

    req.pipe(proxyReq);
  });

  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));

  const proxyPort = (proxy.address() as net.AddressInfo).port;

  const result = await new Promise<{ pass: boolean; body: string }>(resolve => {
    const socket = net.createConnection(proxyPort, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
    });

    const chunks: Buffer[] = [];
    socket.on("data", c => chunks.push(c));
    socket.on("end", () => {
      resolve({ pass: true, body: Buffer.concat(chunks).toString() });
    });
    socket.setTimeout(3000, () => {
      resolve({ pass: false, body: Buffer.concat(chunks).toString() });
      socket.destroy();
    });
  });

  backend.close();
  proxy.close();

  expect(result.body).toContain("chunk1");
  expect(result.body).toContain("chunk2");
  expect(result.body).toContain("chunk3");
  expect(result.pass).toBe(true);
});
