import { describe, expect, test } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";

describe("node:http 101 response handling", () => {
  test("handles 101 Switching Protocols response with slow data", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    let gotError = false;

    const server = net.createServer(socket => {
      let closed = false;
      socket.on("close", () => {
        closed = true;
      });
      socket.on("error", () => {
        closed = true;
      });

      socket.on("data", async data => {
        if (data.toString().includes("\r\n\r\n")) {
          try {
            // Send 101 response headers slowly
            if (!closed) socket.write(`HTTP/1.1 101 Switching Protocols\r\n`);
            await Bun.sleep(5);
            if (!closed) socket.write(`Upgrade: websocket\r\n`);
            await Bun.sleep(5);
            if (!closed) socket.write(`Connection: Upgrade\r\n`);
            await Bun.sleep(5);
            if (!closed) socket.write(`\r\n`);

            // Send some non-HTTP data (WebSocket frames) slowly
            // This used to trigger memory issues with recursive parsing
            for (let i = 0; i < 5 && !closed; i++) {
              // WebSocket text frame with 'A' (0x81 = FIN+text, 0x01 = length 1, 0x41 = 'A')
              socket.write(Buffer.from([0x81, 0x01, 0x41]));
              await Bun.sleep(5);
            }
          } catch (e) {
            // Socket may have been closed by client
          }

          // Close the socket after sending data
          setTimeout(() => {
            if (!closed) socket.destroy();
          }, 50);
        }
      });
    });

    await using _server = server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;

    const req = http.request(
      {
        port,
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      },
      res => {
        // We don't expect a successful response for WebSocket upgrade via http.request
        res.on("data", () => {});
        res.on("end", () => {
          resolve();
        });
      },
    );

    req.on("error", err => {
      // An error is expected since http.request doesn't support protocol upgrades
      // The important thing is that we don't crash with memory issues
      gotError = true;
      resolve();
    });

    req.end();

    await promise;

    // We expect an error since the HTTP client doesn't support protocol upgrades
    expect(gotError).toBe(true);
  });

  test("handles 101 response with immediate data", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    let gotError = false;

    const server = net.createServer(socket => {
      socket.on("data", data => {
        if (data.toString().includes("\r\n\r\n")) {
          // Send complete 101 response at once
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n` + `Upgrade: websocket\r\n` + `Connection: Upgrade\r\n` + `\r\n`,
          );

          // Send some WebSocket frames immediately
          socket.write(Buffer.from([0x81, 0x01, 0x41, 0x81, 0x01, 0x42]));

          // Close after a short delay
          setTimeout(() => {
            socket.destroy();
          }, 10);
        }
      });
    });

    await using _server = server;
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;

    const req = http.request(
      {
        port,
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      },
      res => {
        res.on("data", () => {});
        res.on("end", () => {
          resolve();
        });
      },
    );

    req.on("error", err => {
      // Error is expected, just ensure no crash
      gotError = true;
      resolve();
    });

    req.end();

    await promise;

    // We expect an error for protocol upgrades
    expect(gotError).toBe(true);
  });
});
