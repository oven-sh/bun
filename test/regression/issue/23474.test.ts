import { expect, test } from "bun:test";

test("request.cookies.set() should set websocket upgrade response cookie - issue #23474", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/ws": req => {
        // Set a cookie before upgrading
        req.cookies.set("test", "123", {
          httpOnly: true,
          path: "/",
        });

        const upgraded = server.upgrade(req);
        if (upgraded) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
    },
    websocket: {
      message(ws, message) {
        ws.close();
      },
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers();

  // Use Bun.connect to send a WebSocket upgrade request and check response headers
  const socket = await Bun.connect({
    hostname: "localhost",
    port: server.port,
    socket: {
      data(socket, data) {
        try {
          const response = new TextDecoder().decode(data);

          // Check that we got a successful upgrade response
          expect(response).toContain("HTTP/1.1 101");
          expect(response).toContain("Upgrade: websocket");

          // The critical check: Set-Cookie header should be present
          expect(response).toContain("Set-Cookie:");
          expect(response).toContain("test=123");

          socket.end();
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      error(socket, error) {
        reject(error);
      },
    },
  });

  // Send a valid WebSocket upgrade request
  socket.write(
    "GET /ws HTTP/1.1\r\n" +
      `Host: localhost:${server.port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  await promise;
});

test("request.cookies.set() should work with custom headers in upgrade - issue #23474", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/ws": req => {
        // Set cookies before upgrading
        req.cookies.set("session", "abc123", { path: "/" });
        req.cookies.set("user", "john", { httpOnly: true });

        const upgraded = server.upgrade(req, {
          headers: {
            "X-Custom-Header": "test",
          },
        });
        if (upgraded) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
    },
    websocket: {
      message(ws, message) {
        ws.close();
      },
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = await Bun.connect({
    hostname: "localhost",
    port: server.port,
    socket: {
      data(socket, data) {
        try {
          const response = new TextDecoder().decode(data);

          // Check that we got a successful upgrade response
          expect(response).toContain("HTTP/1.1 101");
          expect(response).toContain("Upgrade: websocket");

          // Check custom header
          expect(response).toContain("X-Custom-Header: test");

          // Check that both cookies are present
          expect(response).toContain("Set-Cookie:");
          expect(response).toContain("session=abc123");
          expect(response).toContain("user=john");

          socket.end();
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      error(socket, error) {
        reject(error);
      },
    },
  });

  socket.write(
    "GET /ws HTTP/1.1\r\n" +
      `Host: localhost:${server.port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  await promise;
});
