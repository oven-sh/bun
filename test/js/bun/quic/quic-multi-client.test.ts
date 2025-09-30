import { test, expect } from "bun:test";
import { tls } from "harness";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

test("QUIC server handles multiple concurrent clients", async () => {
  let serverConnections = 0;
  const clientMessages: string[] = [];
  const serverMessages: string[] = [];

  // Create QUIC server
  const server = Bun.quic({
    hostname: "127.0.0.1",
    port: 9500,
    server: true,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    connection(socket) {
      serverConnections++;
      console.log(`Server: Connection ${serverConnections} established`);
    },
    open(stream) {
      console.log(`Server: Stream opened, ID: ${stream.id}`);
    },
    data(stream, buffer) {
      const msg = buffer.toString();
      serverMessages.push(msg);
      console.log(`Server received: ${msg}`);
      stream.write(`Echo: ${msg}`);
    },
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  // Create first client
  const client1 = Bun.quic({
    hostname: "127.0.0.1",
    port: 9500,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    socketOpen(socket) {
      console.log("Client 1: Connected");
      const stream = socket.stream();
      stream.write("Hello from client 1");
    },
    data(stream, buffer) {
      clientMessages.push(buffer.toString());
      console.log(`Client 1 received: ${buffer.toString()}`);
    },
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  // Create second client
  const client2 = Bun.quic({
    hostname: "127.0.0.1",
    port: 9500,
    server: false,
    tls: {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    socketOpen(socket) {
      console.log("Client 2: Connected");
      const stream = socket.stream();
      stream.write("Hello from client 2");
    },
    data(stream, buffer) {
      clientMessages.push(buffer.toString());
      console.log(`Client 2 received: ${buffer.toString()}`);
    },
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify both connections were established
  expect(serverConnections).toBe(2);

  // Verify both messages were received by server
  expect(serverMessages).toContain("Hello from client 1");
  expect(serverMessages).toContain("Hello from client 2");

  // Verify both clients got responses
  expect(clientMessages).toContain("Echo: Hello from client 1");
  expect(clientMessages).toContain("Echo: Hello from client 2");

  server.close();
  client1.close();
  client2.close();
});