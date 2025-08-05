import { test, expect } from "bun:test";
import { tls } from "harness";

// Disable TLS verification for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

test("QUIC basic server setup without TLS", async () => {
  console.log("Creating QUIC server without TLS...");
  
  const server = Bun.quic({
    hostname: "127.0.0.1", // Use explicit IP instead of localhost
    port: 0, // Use random port
    server: true,
    open(socket) {
      console.log("QUIC server open callback called");
    },
    connection(socket) {
      console.log("QUIC server connection callback called");
    },
    message(socket, data) {
      console.log("QUIC server message:", data);
    },
    close(socket) {
      console.log("QUIC server close callback called");
    },
    error(socket, error) {
      console.error("QUIC server error:", error);
    },
  });

  console.log("Server created, checking properties...");
  expect(server).toBeDefined();
  expect(server.isServer).toBe(true);
  
  // Wait a bit for server to fully initialize
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log("Closing server...");
  server.close();
});

test.skip("QUIC client without server", async () => {
  console.log("Creating QUIC client...");
  
  let errorReceived = false;
  
  const client = Bun.quic({
    hostname: "127.0.0.1",
    port: 65432, // Non-existent port
    server: false,
    open(socket) {
      console.log("QUIC client open - should not happen");
    },
    message(socket, data) {
      console.log("QUIC client message:", data);
    },
    close(socket) {
      console.log("QUIC client close");
    },
    error(socket, error) {
      console.log("QUIC client error (expected):", error);
      errorReceived = true;
    },
  });

  console.log("Client created, waiting for error...");
  
  // Wait for connection attempt
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  expect(errorReceived).toBe(true);
  client.close();
});

test.skip("QUIC server-client basic connection", async () => {
  console.log("=== Starting QUIC server-client test ===");
  
  const { promise: serverConnPromise, resolve: resolveServerConn } = Promise.withResolvers();
  const { promise: clientOpenPromise, resolve: resolveClientOpen } = Promise.withResolvers();
  const { promise: serverPortPromise, resolve: resolveServerPort } = Promise.withResolvers();
  
  // Create server
  const server = Bun.quic({
    hostname: "127.0.0.1",
    port: 0, // Use random port
    server: true,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    open(socket) {
      console.log("Server: open callback");
      try {
        const actualPort = socket.port;
        console.log("Server listening on port:", actualPort);
        resolveServerPort(actualPort);
      } catch (err) {
        console.error("Error getting port:", err);
        resolveServerPort(9443); // Fallback port
      }
    },
    connection(socket) {
      console.log("Server: connection callback - new client connected!");
      resolveServerConn(socket);
    },
    message(socket, data) {
      console.log("Server: received message:", data);
      socket.write("Echo: " + data);
    },
    close(socket) {
      console.log("Server: close callback");
    },
    error(socket, error) {
      console.error("Server: error:", error);
    },
  });

  // Wait for server to be ready
  const actualPort = await serverPortPromise;
  console.log("Server ready on port:", actualPort);
  
  // Create client
  const client = Bun.quic({
    hostname: "127.0.0.1",
    port: actualPort,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    open(socket) {
      console.log("Client: open callback - connected!");
      console.log("Socket object:", socket);
      console.log("Socket.write method:", socket.write);
      resolveClientOpen(socket);
      try {
        const result = socket.write("Hello from client");
        console.log("Write result:", result);
      } catch (err) {
        console.error("Write error:", err);
      }
    },
    message(socket, data) {
      console.log("Client: received message:", data);
    },
    close(socket) {
      console.log("Client: close callback");
    },
    error(socket, error) {
      console.error("Client: error:", error);
    },
  });

  // Wait for both connection events
  const [serverSocket, clientSocket] = await Promise.all([
    serverConnPromise,
    clientOpenPromise
  ]);
  
  console.log("Connection established!");
  
  // Clean up
  client.close();
  server.close();
  
  expect(serverSocket).toBeDefined();
  expect(clientSocket).toBeDefined();
});