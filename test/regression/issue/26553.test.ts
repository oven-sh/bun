import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

describe("Issue #26553 - HTTP server socket events and properties", () => {
  test("connection event fires before connect event for CONNECT requests", async () => {
    const events: string[] = [];
    let connectionSocket: any;

    const server = http.createServer();

    server.on("connection", socket => {
      events.push("connection");
      // Set a custom property on the socket that should be available in the 'connect' handler
      socket.myCustomId = 12345;
      connectionSocket = socket;
    });

    server.on("connect", (req, socket, head) => {
      events.push("connect");
      // The socket from the 'connect' event should be the same as from 'connection'
      expect(req.socket.myCustomId).toBe(12345);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.end();
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      // Make a CONNECT request using node:net
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });

      await new Promise<void>((resolve, reject) => {
        client.on("data", data => {
          const response = data.toString();
          if (response.includes("200 Connection Established")) {
            client.end();
          }
        });
        client.on("close", resolve);
        client.on("error", reject);
      });

      // Verify the order of events
      expect(events).toEqual(["connection", "connect"]);
    } finally {
      server.close();
    }
  });

  test("socket close event fires when CONNECT connection closes", async () => {
    const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();

    const server = http.createServer();

    server.on("connection", socket => {
      socket.on("close", () => {
        closeResolve();
      });
    });

    server.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // Close the socket after a short delay
      setTimeout(() => socket.end(), 10);
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      // Make a CONNECT request using node:net
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });

      await new Promise<void>((resolve, reject) => {
        client.on("close", resolve);
        client.on("error", reject);
      });

      // Wait for the close event with a timeout
      await Promise.race([
        closePromise,
        Bun.sleep(1000).then(() => {
          throw new Error("Timeout waiting for close event");
        }),
      ]);
    } finally {
      server.close();
    }
  });

  test("socket bytesWritten tracks data sent for CONNECT requests", async () => {
    let bytesWrittenValue = 0;
    const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();

    const server = http.createServer();

    server.on("connection", socket => {
      socket.on("close", () => {
        bytesWrittenValue = socket.bytesWritten;
        closeResolve();
      });
    });

    server.on("connect", (req, socket, head) => {
      // Write a known response
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // Close the socket after a short delay
      setTimeout(() => socket.end(), 10);
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });

      await new Promise<void>((resolve, reject) => {
        client.on("close", resolve);
        client.on("error", reject);
      });

      await Promise.race([
        closePromise,
        Bun.sleep(1000).then(() => {
          throw new Error("Timeout waiting for close event");
        }),
      ]);

      // bytesWritten should include the "HTTP/1.1 200 Connection Established\r\n\r\n" response
      // which is 39 bytes
      expect(bytesWrittenValue).toBeGreaterThanOrEqual(39);
    } finally {
      server.close();
    }
  });

  test("socket bytesRead tracks data received for CONNECT tunnel", async () => {
    let bytesReadValue = 0;
    const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();
    const testData = "Hello from client!";

    const server = http.createServer();

    server.on("connection", socket => {
      socket.on("close", () => {
        bytesReadValue = socket.bytesRead;
        closeResolve();
      });
    });

    server.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // Read data from the tunnel
      socket.on("data", () => {});
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });

      let receivedResponse = false;

      client.on("data", data => {
        if (!receivedResponse && data.toString().includes("200 Connection Established")) {
          receivedResponse = true;
          // Send data through the tunnel
          client.write(testData);
          setTimeout(() => client.end(), 50);
        }
      });

      await new Promise<void>((resolve, reject) => {
        client.on("close", resolve);
        client.on("error", reject);
      });

      await Promise.race([
        closePromise,
        Bun.sleep(1000).then(() => {
          throw new Error("Timeout waiting for close event");
        }),
      ]);

      // bytesRead should include the data sent after tunnel establishment
      expect(bytesReadValue).toBeGreaterThanOrEqual(testData.length);
    } finally {
      server.close();
    }
  });
});
