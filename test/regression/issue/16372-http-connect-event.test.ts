import { expect, test } from "bun:test";
import { createServer } from "node:http";
import net from "node:net";

test("node:http server should emit 'connect' event for CONNECT method", async () => {
  let connectCalled = false;

  const server = createServer();

  server.on("connect", (req, socket, head) => {
    connectCalled = true;
    // Respond with 200 Connection Established
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.end();
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;

  // Create a client connection and send CONNECT request
  const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
    client.write("CONNECT github.com:443 HTTP/1.1\r\n");
    client.write("Host: github.com:443\r\n");
    client.write("Proxy-Connection: Keep-Alive\r\n");
    client.write("\r\n");
  });

  let response = "";
  client.on("data", data => {
    response += data.toString();
  });

  await new Promise<void>(resolve => {
    client.on("end", () => {
      resolve();
    });
  });

  // Verify the connect event was called
  expect(connectCalled).toBe(true);

  // Verify proper response
  expect(response).toContain("200 Connection Established");

  server.close();
  client.destroy();
});

test("node:http server should respond with 400 if no connect handler", async () => {
  const server = createServer();

  // No connect event handler - should return 400

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;

  // Create a client connection and send CONNECT request
  const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
    client.write("CONNECT github.com:443 HTTP/1.1\r\n");
    client.write("Host: github.com:443\r\n");
    client.write("\r\n");
  });

  let response = "";
  client.on("data", data => {
    response += data.toString();
  });

  await new Promise<void>(resolve => {
    client.on("end", () => {
      resolve();
    });
    client.on("error", () => {
      // Connection might be closed early
      resolve();
    });
  });

  // Should get 400 or 405 response
  expect(response).toMatch(/HTTP\/1\.1 (400|405)/);

  server.close();
  client.destroy();
});
