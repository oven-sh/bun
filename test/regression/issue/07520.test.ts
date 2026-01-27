import { expect, test } from "bun:test";
import http from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";

// Issue #7520: node:http module lowercases HTTP header names when sending requests
// Node.js preserves the original case of header names, but Bun was lowercasing them.
// This test verifies that header names are preserved in their original case.

interface HeaderCapturingServer {
  server: Server;
  port: number;
  getReceivedData: () => string;
  waitForHeaders: Promise<void>;
}

function createHeaderCapturingServer(): Promise<HeaderCapturingServer> {
  return new Promise(resolveSetup => {
    let receivedData = "";
    let headersDone = false;
    const { promise: waitForHeaders, resolve: resolveHeaders } = Promise.withResolvers<void>();

    const server = createTcpServer(socket => {
      socket.on("data", data => {
        if (headersDone) return;
        receivedData += data.toString();
        if (receivedData.includes("\r\n\r\n")) {
          headersDone = true;
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
          socket.end();
          resolveHeaders();
        }
      });
    });

    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolveSetup({
        server,
        port,
        getReceivedData: () => receivedData,
        waitForHeaders,
      });
    });
  });
}

test("node:http request preserves header case for custom headers", async () => {
  const { server, port, getReceivedData, waitForHeaders } = await createHeaderCapturingServer();

  try {
    const req = http.request(
      {
        hostname: "localhost",
        port: port,
        path: "/",
        method: "GET",
        headers: {
          "X-Custom-Header": "test-value",
          "X-Another-Header": "another-value",
          Authorization: "Bearer token123",
          "Content-Type": "application/json",
        },
      },
      (res: any) => {
        res.on("data", () => {});
        res.on("end", () => {});
      },
    );

    req.on("error", () => {});
    req.end();

    await waitForHeaders;

    const receivedData = getReceivedData();

    // Verify headers are sent with correct casing (not lowercased)
    expect(receivedData).toInclude("X-Custom-Header: test-value");
    expect(receivedData).toInclude("X-Another-Header: another-value");
    expect(receivedData).toInclude("Authorization: Bearer token123");
    expect(receivedData).toInclude("Content-Type: application/json");

    // Make sure they're NOT lowercased
    expect(receivedData).not.toInclude("x-custom-header:");
    expect(receivedData).not.toInclude("x-another-header:");
    expect(receivedData).not.toInclude("authorization:");
    expect(receivedData).not.toInclude("content-type:");
  } finally {
    server.close();
  }
});

test("node:http request preserves header case for POST requests", async () => {
  const { server, port, getReceivedData, waitForHeaders } = await createHeaderCapturingServer();

  try {
    const req = http.request(
      {
        hostname: "localhost",
        port: port,
        path: "/",
        method: "POST",
        headers: {
          "X-Request-ID": "12345",
          "Content-Type": "application/json",
        },
      },
      (res: any) => {
        res.on("data", () => {});
        res.on("end", () => {});
      },
    );

    req.on("error", () => {});
    req.write('{"test": true}');
    req.end();

    await waitForHeaders;

    const receivedData = getReceivedData();

    // Verify headers are sent with correct casing
    expect(receivedData).toInclude("X-Request-ID: 12345");
    expect(receivedData).toInclude("Content-Type: application/json");

    // Make sure they're NOT lowercased
    expect(receivedData).not.toInclude("x-request-id:");
    expect(receivedData).not.toInclude("content-type:");
  } finally {
    server.close();
  }
});

test("node:http request preserves header case when using setHeader()", async () => {
  const { server, port, getReceivedData, waitForHeaders } = await createHeaderCapturingServer();

  try {
    const req = http.request({
      hostname: "localhost",
      port: port,
      path: "/",
      method: "GET",
    });

    // Set headers using setHeader() method
    req.setHeader("X-Custom-Header", "value1");
    req.setHeader("X-Another-Custom-Header", "value2");
    req.setHeader("Authorization", "Bearer mytoken");

    req.on("response", (res: any) => {
      res.on("data", () => {});
      res.on("end", () => {});
    });

    req.on("error", () => {});
    req.end();

    await waitForHeaders;

    const receivedData = getReceivedData();

    // Verify headers are sent with correct casing
    expect(receivedData).toInclude("X-Custom-Header: value1");
    expect(receivedData).toInclude("X-Another-Custom-Header: value2");
    expect(receivedData).toInclude("Authorization: Bearer mytoken");

    // Make sure they're NOT lowercased
    expect(receivedData).not.toInclude("x-custom-header:");
    expect(receivedData).not.toInclude("x-another-custom-header:");
    expect(receivedData).not.toInclude("authorization:");
  } finally {
    server.close();
  }
});
