import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Socket } from "node:net";

test("http.Server WebSocket upgrade sends response correctly", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  let upgradeReceived = false;
  let clientReceivedUpgrade = false;

  server.on("upgrade", (request, socket, head) => {
    upgradeReceived = true;

    const key = request.headers["sec-websocket-key"];
    expect(key).toBeTruthy();

    if (!key) {
      socket.destroy();
      return;
    }

    // Generate WebSocket accept key
    const acceptKey = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    // Send WebSocket upgrade response
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n");

    socket.write(headers);
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is not valid");
  }

  // Create WebSocket client
  const client = new Socket();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Test timeout - client never received upgrade response"));
    }, 2000);

    client.connect(address.port, "127.0.0.1", () => {
      // Send WebSocket handshake
      const key = Buffer.from("testkey123456789").toString("base64");
      const handshake = [
        "GET /test HTTP/1.1",
        "Host: localhost",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n");

      client.write(handshake);
    });

    client.on("data", data => {
      const response = data.toString();

      if (response.includes("101 Switching Protocols")) {
        clientReceivedUpgrade = true;
        clearTimeout(timeout);
        client.end();
        resolve();
      }
    });

    client.on("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Verify both server and client processed the upgrade
  expect(upgradeReceived).toBe(true);
  expect(clientReceivedUpgrade).toBe(true);

  // Clean up
  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
});
