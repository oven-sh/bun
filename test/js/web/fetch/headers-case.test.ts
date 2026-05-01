"use strict";

import { expect, test } from "bun:test";
import { createServer as createTcpServer } from "node:net";

// Test that fetch sends headers with proper case on the wire.
// We use a raw TCP server instead of an HTTP server because uWebSockets
// lowercases headers when parsing, which would make the test fail even
// when the client sends correct casing.
test("Headers retain keys case-sensitive on the wire", async () => {
  let receivedData = "";
  let resolveDataReceived: () => void;
  let headersDone = false;
  const dataReceived = new Promise<void>(resolve => {
    resolveDataReceived = resolve;
  });

  const server = createTcpServer(socket => {
    socket.on("data", data => {
      if (headersDone) return;
      receivedData += data.toString();
      // Wait for complete headers (ending with \r\n\r\n)
      if (receivedData.includes("\r\n\r\n")) {
        headersDone = true;
        // Send a minimal HTTP response
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        socket.end();
        resolveDataReceived();
      }
    });
  });

  server.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    // Make a fetch request with various headers
    await fetch(`http://localhost:${port}/`, {
      headers: {
        "Content-Type": "text/plain",
        "X-Custom-Header": "test-value",
        Authorization: "Bearer token123",
      },
    });

    await dataReceived;

    // Verify the headers are sent with correct casing
    expect(receivedData).toInclude("Content-Type: text/plain");
    expect(receivedData).toInclude("X-Custom-Header: test-value");
    expect(receivedData).toInclude("Authorization: Bearer token123");

    // Make sure they're NOT lowercased
    expect(receivedData).not.toInclude("content-type:");
    expect(receivedData).not.toInclude("x-custom-header:");
    expect(receivedData).not.toInclude("authorization:");
  } finally {
    server.close();
  }
});

// Test with Headers object
test("Headers object retains case on the wire", async () => {
  let receivedData = "";
  let resolveDataReceived: () => void;
  let headersDone = false;
  const dataReceived = new Promise<void>(resolve => {
    resolveDataReceived = resolve;
  });

  const server = createTcpServer(socket => {
    socket.on("data", data => {
      if (headersDone) return;
      receivedData += data.toString();
      // Wait for complete headers (ending with \r\n\r\n)
      if (receivedData.includes("\r\n\r\n")) {
        headersDone = true;
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        socket.end();
        resolveDataReceived();
      }
    });
  });

  server.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const headers = new Headers([
      ["Content-Type", "application/json"],
      ["X-Request-ID", "12345"],
    ]);

    await fetch(`http://localhost:${port}/`, { headers });

    await dataReceived;

    // Verify headers are sent with correct casing
    expect(receivedData).toInclude("Content-Type: application/json");
    expect(receivedData).toInclude("X-Request-ID: 12345");
  } finally {
    server.close();
  }
});

// Test with Request object
test("Request headers retain case on the wire", async () => {
  let receivedData = "";
  let resolveDataReceived: () => void;
  let headersDone = false;
  const dataReceived = new Promise<void>(resolve => {
    resolveDataReceived = resolve;
  });

  const server = createTcpServer(socket => {
    socket.on("data", data => {
      if (headersDone) return;
      receivedData += data.toString();
      // Wait for complete headers (ending with \r\n\r\n)
      if (receivedData.includes("\r\n\r\n")) {
        headersDone = true;
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        socket.end();
        resolveDataReceived();
      }
    });
  });

  server.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    // see https://github.com/nodejs/undici/pull/3183
    const request = new Request(`http://localhost:${port}/`, {
      headers: [["Content-Type", "text/plain"]],
    });

    await fetch(request, { method: "GET" });

    await dataReceived;

    expect(receivedData).toInclude("Content-Type: text/plain");
  } finally {
    server.close();
  }
});
