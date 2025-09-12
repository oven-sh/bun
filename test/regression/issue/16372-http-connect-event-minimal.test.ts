import { test, expect } from "bun:test";
import { createServer } from "node:http";
import net from "node:net";

test("node:http server emits 'connect' event for CONNECT method", async () => {
  let connectEventEmitted = false;
  let receivedRequest = null;
  
  const server = createServer();
  
  server.on("connect", (req, socket, head) => {
    connectEventEmitted = true;
    receivedRequest = {
      method: req.method,
      url: req.url,
    };
    // Note: Raw socket writing is not fully implemented yet
    // This test only verifies the event is emitted
    socket.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;

  // Send CONNECT request
  const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
    client.write("CONNECT github.com:443 HTTP/1.1\r\n");
    client.write("Host: github.com:443\r\n");
    client.write("\r\n");
  });

  await new Promise<void>((resolve) => {
    client.on("end", () => {
      resolve();
    });
    client.on("error", () => {
      resolve();
    });
    
    // Timeout to prevent hanging
    setTimeout(() => {
      client.destroy();
      resolve();
    }, 1000);
  });

  // Verify the connect event was emitted with correct data
  expect(connectEventEmitted).toBe(true);
  expect(receivedRequest).not.toBeNull();
  expect(receivedRequest?.method).toBe("CONNECT");
  expect(receivedRequest?.url).toBe("github.com:443");

  server.close();
  client.destroy();
});