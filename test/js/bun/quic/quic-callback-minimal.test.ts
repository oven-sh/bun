import { test, expect } from "bun:test";
import { tls } from "harness";

// Disable TLS verification for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

test("QUIC server connection callback should fire", async () => {
  let serverOpenCalled = false;
  let clientOpenCalled = false;
  let connectionCalled = false;

  console.log("Creating QUIC server with TLS...");
  const server = Bun.quic({
    hostname: "localhost",
    port: 0, // Use random port
    server: true,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    open(socket) {
      serverOpenCalled = true;
      console.log("SERVER OPEN CALLBACK FIRED!");
    },
    connection(socket) {
      connectionCalled = true;
      console.log("SERVER CONNECTION CALLBACK FIRED!");
    },
    message(socket, data) {},
    close(socket) {},
    error(socket, error) {
      console.log("Server error:", error);
    },
  });

  // Get the actual port
  const port = server.port || 9999;
  console.log("Server listening on port:", port);

  // Wait a bit then create client
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log("Creating QUIC client with TLS...");
  const client = Bun.quic({
    hostname: "localhost",
    port: port,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    open(socket) {
      clientOpenCalled = true;
      console.log("CLIENT OPEN CALLBACK FIRED!");
    },
    message(socket, data) {},
    close(socket) {},
    error(socket, error) {
      console.log("Client error:", error);
    },
  });

  // Wait for connections
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log("\nTest results:");
  console.log("serverOpenCalled:", serverOpenCalled);
  console.log("clientOpenCalled:", clientOpenCalled);
  console.log("connectionCalled:", connectionCalled);

  expect(serverOpenCalled).toBe(true);
  expect(clientOpenCalled).toBe(true);
  expect(connectionCalled).toBe(true); // This is the one that's failing

  // Clean up
  client.close();
  server.close();
});