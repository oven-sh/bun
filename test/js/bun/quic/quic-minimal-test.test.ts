import { test, expect } from "bun:test";
import { tls } from "harness";

// Disable TLS verification for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

test("QUIC minimal connection test", async () => {
  console.log("Starting QUIC minimal test...");

  let serverConnected = false;
  let clientConnected = false;

  // Create QUIC server
  const server = Bun.quic({
    hostname: "127.0.0.1",
    port: 9444,
    server: true,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    socketOpen(socket) {
      console.log("Server socket opened");
    },
    connection(socket) {
      serverConnected = true;
      console.log("Server: Connection established");
    },
    open(stream) {
      console.log("Server: Stream opened, ID:", stream.id);
    },
    data(stream, buffer) {
      console.log("Server received:", buffer.toString());
      stream.write(`Echo: ${buffer}`);
    },
  });

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 100));

  // Create QUIC client
  const client = Bun.quic({
    hostname: "127.0.0.1",
    port: 9444,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    socketOpen(socket) {
      clientConnected = true;
      console.log("Client: Socket opened");

      // Create a stream
      const stream = socket.stream();
      console.log("Client: Created stream");

      // Write data
      stream.write("Hello QUIC");
      console.log("Client: Sent data");
    },
    data(stream, buffer) {
      console.log("Client received:", buffer.toString());
    },
  });

  // Wait for communication
  await new Promise(resolve => setTimeout(resolve, 1000));

  expect(serverConnected).toBe(true);
  expect(clientConnected).toBe(true);

  // Clean up
  server.close();
  client.close();
});