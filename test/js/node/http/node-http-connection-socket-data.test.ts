import { test, expect } from "bun:test";
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { AddressInfo } from "node:net";
import { tls as tlsCerts } from "harness";

// https://github.com/oven-sh/bun/issues/11924
// Node's http.Server feeds its parser from the connection socket's 'data'
// event, so a user 'data' listener on that socket sees the raw request bytes.
test("http.Server 'connection' socket emits 'data' with the raw request bytes", async () => {
  let resolveData!: (b: Buffer) => void;
  const firstData = new Promise<Buffer>(r => (resolveData = r));
  let bytesReadAtData = -1;

  const server = createServer((req, res) => {
    res.end("ok");
  });
  server.on("connection", socket => {
    socket.on("data", chunk => {
      bytesReadAtData = socket.bytesRead;
      resolveData(chunk);
    });
  });
  await once(server.listen(0), "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const req = request({ port, path: "/hello-path", headers: { "x-probe": "yes" } });
    req.end();
    const [res] = await once(req, "response");
    res.resume();
    await once(res, "end");

    const chunk = await firstData;
    const text = chunk.toString("latin1");
    expect(text.startsWith("GET /hello-path HTTP/1.1\r\n")).toBe(true);
    expect(text).toContain("\r\nx-probe: yes\r\n");
    expect(bytesReadAtData).toBe(chunk.length);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("http.Server 'connection' socket 'data' covers the body and every keep-alive request", async () => {
  const received: Buffer[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  server.on("connection", socket => {
    socket.on("data", chunk => received.push(chunk));
  });
  await once(server.listen(0), "listening");
  const { port } = server.address() as AddressInfo;

  const client = connect(port);
  await once(client, "connect");
  let replies = "";
  client.on("data", d => (replies += d.toString("latin1")));

  // Two body-bearing requests over one keep-alive connection; the second is
  // chunked so the raw bytes include the chunk framing, like Node.
  client.write("POST /one HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nHELLO");
  while ((replies.match(/HTTP\/1\.1 200/g) ?? []).length < 1) await once(client, "data");
  client.write("POST /two HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nWORLD\r\n0\r\n\r\n");
  while ((replies.match(/HTTP\/1\.1 200/g) ?? []).length < 2) await once(client, "data");
  client.end();
  await once(client, "close");

  const raw = Buffer.concat(received).toString("latin1");
  expect(raw).toContain("POST /one HTTP/1.1\r\n");
  expect(raw).toContain("\r\n\r\nHELLO");
  expect(raw).toContain("POST /two HTTP/1.1\r\n");
  expect(raw).toContain("5\r\nWORLD\r\n0\r\n\r\n");

  server.closeAllConnections();
  server.close();
});

test("http.Server 'connection' socket 'readable' + read() yields the raw request bytes", async () => {
  let resolveData!: (b: Buffer) => void;
  const firstData = new Promise<Buffer>(r => (resolveData = r));

  const server = createServer((req, res) => {
    res.end("ok");
  });
  server.on("connection", socket => {
    socket.on("readable", () => {
      const chunk = socket.read();
      if (chunk) resolveData(chunk);
    });
  });
  await once(server.listen(0), "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const req = request({ port, path: "/via-readable" });
    req.end();
    const [res] = await once(req, "response");
    res.resume();
    await once(res, "end");

    const chunk = await firstData;
    expect(chunk.toString("latin1").startsWith("GET /via-readable HTTP/1.1\r\n")).toBe(true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("https.Server 'connection' socket 'data' carries the decrypted request bytes", async () => {
  let resolveData!: (b: Buffer) => void;
  const firstData = new Promise<Buffer>(r => (resolveData = r));

  const server = createHttpsServer({ key: tlsCerts.key, cert: tlsCerts.cert }, (req, res) => {
    res.end("ok");
  });
  server.on("connection", socket => {
    socket.on("data", chunk => resolveData(chunk));
  });
  await once(server.listen(0), "listening");
  const { port } = server.address() as AddressInfo;

  const client = tlsConnect({ port, rejectUnauthorized: false });
  await once(client, "secureConnect");
  client.write("GET /tls-path HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  let reply = "";
  client.on("data", d => (reply += d.toString("latin1")));
  await once(client, "close");

  const chunk = await firstData;
  expect(chunk.toString("latin1").startsWith("GET /tls-path HTTP/1.1\r\n")).toBe(true);
  expect(reply).toContain("HTTP/1.1 200");

  server.closeAllConnections();
  server.close();
});

// A 'data' listener added later (inside the 'request' handler) arms via the
// Readable's _read(); it sees bytes that arrive after it was added.
test("req.socket 'data' listener added inside the request handler sees subsequent raw bytes", async () => {
  const received: Buffer[] = [];
  const { promise: done, resolve: onDone } = Promise.withResolvers<void>();

  const server = createServer((req, res) => {
    if (req.url === "/first") {
      req.socket.on("data", chunk => received.push(chunk));
      res.end("ok");
    } else {
      res.end("ok");
      onDone();
    }
  });
  await once(server.listen(0), "listening");
  const { port } = server.address() as AddressInfo;

  const client = connect(port);
  await once(client, "connect");
  client.on("data", () => {});
  client.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n");
  await once(client, "data");
  client.write("GET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  await done;
  client.end();
  await once(client, "close");

  const raw = Buffer.concat(received).toString("latin1");
  expect(raw).toContain("GET /second HTTP/1.1\r\n");

  server.closeAllConnections();
  server.close();
});
