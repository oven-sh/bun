import { createSocketPair } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

// Tests for server.accept() which allows accepting file descriptors into the HTTP server.
// Note: server.accept() is not supported on Windows because us_socket_from_fd() is not implemented there.

test.todoIf(isWindows)("server.accept() accepts file descriptor and handles HTTP request", async () => {
  const [serverFd, clientFd] = createSocketPair();

  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      requestCount++;
      return new Response(`Hello from request ${requestCount}!`);
    },
  });

  try {
    // Accept the server side of the socket pair into the HTTP server
    server.accept(serverFd);

    // Connect client socket and track responses
    const responses: Buffer[] = [];
    let resolveData: ((value: void) => void) | null = null;
    let dataPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });

    const client = await Bun.connect({
      socket: {
        data(socket, data) {
          responses.push(Buffer.from(data));
          if (resolveData) {
            resolveData();
            resolveData = null;
          }
        },
        open(socket) {
          // Send HTTP request
          socket.write("GET / HTTP/1.1\r\n" + "Host: localhost\r\n" + "Connection: close\r\n" + "\r\n");
        },
      },
      fd: clientFd,
    });

    // Wait for response
    await dataPromise;

    // Verify we got an HTTP response
    const response = Buffer.concat(responses).toString();
    expect(response).toContain("HTTP/1.1 200");
    expect(response).toContain("Hello from request 1!");

    client.end();
  } finally {
    server.stop();
  }
});

test.todoIf(isWindows)("server.accept() handles multiple requests with Keep-Alive", async () => {
  const [serverFd, clientFd] = createSocketPair();

  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requestCount++;
      const body = await req.text();
      return new Response(`Request ${requestCount}: ${body || "no body"}`, {
        headers: {
          "Connection": "keep-alive",
          "Content-Type": "text/plain",
        },
      });
    },
  });

  try {
    server.accept(serverFd);

    const responses: string[] = [];
    let resolveData: ((value: void) => void) | null = null;
    let currentPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });

    const client = await Bun.connect({
      socket: {
        data(socket, data) {
          const text = Buffer.from(data).toString();
          responses.push(text);
          if (resolveData) {
            resolveData();
            resolveData = null;
          }
        },
        open(socket) {
          // Send first request with body
          const body1 = "Hello World";
          socket.write(
            "POST /test HTTP/1.1\r\n" +
              "Host: localhost\r\n" +
              "Connection: keep-alive\r\n" +
              `Content-Length: ${body1.length}\r\n` +
              "Content-Type: text/plain\r\n" +
              "\r\n" +
              body1,
          );
        },
      },
      fd: clientFd,
    });

    // Wait for first response
    await currentPromise;
    expect(responses[0]).toContain("HTTP/1.1 200");
    expect(responses[0]).toContain("Request 1: Hello World");

    // Send second request
    currentPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });
    const body2 = "Second request";
    client.write(
      "POST /another HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Connection: keep-alive\r\n" +
        `Content-Length: ${body2.length}\r\n` +
        "Content-Type: text/plain\r\n" +
        "\r\n" +
        body2,
    );

    await currentPromise;
    expect(responses.length).toBeGreaterThanOrEqual(2);
    const fullResponse = responses.join("");
    expect(fullResponse).toContain("Request 2: Second request");

    // Send third request
    currentPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });
    client.write("GET /final HTTP/1.1\r\n" + "Host: localhost\r\n" + "Connection: close\r\n" + "\r\n");

    await currentPromise;
    const finalResponse = responses.join("");
    expect(finalResponse).toContain("Request 3: no body");

    expect(requestCount).toBe(3);

    client.end();
  } finally {
    server.stop();
  }
});

test.todoIf(isWindows)("server.accept() handles POST request with large body", async () => {
  const [serverFd, clientFd] = createSocketPair();

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      return new Response(`Received ${body.length} bytes: ${body.slice(0, 50)}...`, {
        headers: { "Content-Type": "text/plain" },
      });
    },
  });

  try {
    server.accept(serverFd);

    let fullResponse = "";
    let resolveData: ((value: void) => void) | null = null;
    let dataPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });

    const client = await Bun.connect({
      socket: {
        data(socket, data) {
          fullResponse += Buffer.from(data).toString();
          if (fullResponse.includes("\r\n\r\n") && resolveData) {
            resolveData();
            resolveData = null;
          }
        },
        open(socket) {
          // Send POST with a large body
          const largeBody = "x".repeat(10000);
          socket.write(
            "POST /upload HTTP/1.1\r\n" +
              "Host: localhost\r\n" +
              "Connection: close\r\n" +
              `Content-Length: ${largeBody.length}\r\n` +
              "Content-Type: text/plain\r\n" +
              "\r\n" +
              largeBody,
          );
        },
      },
      fd: clientFd,
    });

    await dataPromise;

    expect(fullResponse).toContain("HTTP/1.1 200");
    expect(fullResponse).toContain("Received 10000 bytes");
    expect(fullResponse).toContain("xxxxxxxxxx");

    client.end();
  } finally {
    server.stop();
  }
});

test.todoIf(isWindows)("server.accept() handles file upload with binary data", async () => {
  const [serverFd, clientFd] = createSocketPair();

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "POST" && req.url.endsWith("/upload")) {
        const buffer = await req.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Verify we received binary data correctly
        let sum = 0;
        for (let i = 0; i < bytes.length; i++) {
          sum += bytes[i];
        }

        // Send back binary data
        const response = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          response[i] = i;
        }

        return new Response(response, {
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Received-Length": buffer.byteLength.toString(),
            "X-Received-Sum": sum.toString(),
          },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  try {
    server.accept(serverFd);

    let fullResponse = Buffer.alloc(0);
    let resolveData: ((value: void) => void) | null = null;
    let dataPromise = new Promise<void>(resolve => {
      resolveData = resolve;
    });

    const client = await Bun.connect({
      socket: {
        data(socket, data) {
          fullResponse = Buffer.concat([fullResponse, Buffer.from(data)]);
          // Check if we have received the full response (headers + 256 bytes of body)
          const headerEnd = fullResponse.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const body = fullResponse.slice(headerEnd + 4);
            if (body.length >= 256 && resolveData) {
              resolveData();
              resolveData = null;
            }
          }
        },
        open(socket) {
          // Create binary data to upload (1000 bytes with values 0-255 repeating)
          const uploadData = Buffer.alloc(1000);
          for (let i = 0; i < 1000; i++) {
            uploadData[i] = i % 256;
          }

          // Send POST with binary data
          const headers =
            "POST /upload HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Connection: close\r\n" +
            `Content-Length: ${uploadData.length}\r\n` +
            "Content-Type: application/octet-stream\r\n" +
            "\r\n";

          socket.write(Buffer.concat([Buffer.from(headers), uploadData]));
        },
      },
      fd: clientFd,
    });

    await dataPromise;

    // Parse the response
    const responseStr = fullResponse.toString("utf8");
    expect(responseStr).toContain("HTTP/1.1 200");
    expect(responseStr).toContain("X-Received-Length: 1000");

    // Calculate expected sum: sum of 0-255 repeated ~4 times (1000 bytes)
    // = (0+1+2+...+255) * 3 + (0+1+2+...+231) = 32640 * 3 + 26796 = 124716
    expect(responseStr).toContain("X-Received-Sum: 124716");

    // Verify we received correct binary data back
    const headerEnd = fullResponse.indexOf("\r\n\r\n");
    const responseBody = fullResponse.slice(headerEnd + 4);
    expect(responseBody.length).toBeGreaterThanOrEqual(256);

    // Check the binary response contains sequential bytes 0-255
    for (let i = 0; i < 256; i++) {
      expect(responseBody[i]).toBe(i);
    }

    client.end();
  } finally {
    server.stop();
  }
});

test("server.accept() throws on invalid file descriptor", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    expect(() => server.accept(-1)).toThrow();
    expect(() => server.accept(999999)).toThrow();
  } finally {
    server.stop();
  }
});

test("server.accept() requires a number argument", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    // @ts-expect-error - testing invalid input
    expect(() => server.accept()).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept("not a number")).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept({})).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept(null)).toThrow();
  } finally {
    server.stop();
  }
});

test("server.accept() method exists and is callable", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    expect(typeof server.accept).toBe("function");
    expect(server.accept.length).toBe(1);
  } finally {
    server.stop();
  }
});
