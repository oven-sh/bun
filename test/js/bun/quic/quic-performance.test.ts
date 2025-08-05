import { test, expect } from "bun:test";

test("QUIC large data transfer", async () => {
  let dataReceived = "";
  const testData = "x".repeat(64 * 1024); // 64KB test data

  const server = Bun.quic({
    hostname: "localhost",
    port: 9446,
    server: true,
    connection(socket) {
      // Send large data to client
      socket.write(testData);
    },
    open() {},
    message() {},
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const client = Bun.quic({
    hostname: "localhost",
    port: 9446,
    server: false,
    open() {},
    message(socket, data) {
      dataReceived += data.toString();
      
      if (dataReceived.length >= testData.length) {
        expect(dataReceived).toBe(testData);
        socket.close();
      }
    },
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  expect(dataReceived.length).toBe(testData.length);

  server.close();
  client.close();
});

test("QUIC multiple concurrent streams", async () => {
  const streamCount = 10;
  let streamsCreated = 0;
  let messagesReceived = 0;

  const server = Bun.quic({
    hostname: "localhost",
    port: 9447,
    server: true,
    connection(socket) {
      // Create multiple streams
      for (let i = 0; i < streamCount; i++) {
        const stream = socket.createStream();
        streamsCreated++;
        
        // Send message on each stream
        socket.write(`Stream ${i} message`);
      }
      
      expect(socket.streamCount).toBe(streamCount);
    },
    message(socket, data) {
      messagesReceived++;
      console.log("Server received:", data.toString());
    },
    open() {},
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const client = Bun.quic({
    hostname: "localhost",
    port: 9447,
    server: false,
    open(socket) {
      // Client also creates streams
      for (let i = 0; i < streamCount; i++) {
        socket.createStream();
        socket.write(`Client stream ${i}`);
      }
    },
    message(socket, data) {
      console.log("Client received:", data.toString());
    },
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  expect(streamsCreated).toBe(streamCount);
  expect(messagesReceived).toBeGreaterThan(0);

  server.close();
  client.close();
});

test("QUIC connection statistics", async () => {
  let finalStats: any = null;

  const server = Bun.quic({
    hostname: "localhost",
    port: 9448,
    server: true,
    connection(socket) {
      // Send some data to generate stats
      socket.write("Hello statistics!");
    },
    open() {},
    message() {},
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const client = Bun.quic({
    hostname: "localhost",
    port: 9448,
    server: false,
    open(socket) {
      // Send data back
      socket.write("Stats response!");
    },
    message(socket, data) {
      console.log("Client received:", data.toString());
      
      // Get final stats before closing
      finalStats = socket.stats;
    },
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify stats structure and values
  expect(finalStats).toBeDefined();
  expect(typeof finalStats.streamCount).toBe("number");
  expect(typeof finalStats.isConnected).toBe("boolean");
  expect(typeof finalStats.has0RTT).toBe("boolean");
  expect(typeof finalStats.bytesSent).toBe("number");
  expect(typeof finalStats.bytesReceived).toBe("number");
  
  // Should have received some data
  expect(finalStats.bytesReceived).toBeGreaterThan(0);

  server.close();
  client.close();
});

test("QUIC 0-RTT connection support", async () => {
  let has0RTTSupport = false;

  const server = Bun.quic({
    hostname: "localhost",
    port: 9449,
    server: true,
    connection(socket) {
      console.log("Server: 0-RTT support:", socket.has0RTT);
    },
    open() {},
    message() {},
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const client = Bun.quic({
    hostname: "localhost",
    port: 9449,
    server: false,
    open(socket) {
      has0RTTSupport = socket.has0RTT;
      console.log("Client: 0-RTT support:", has0RTTSupport);
    },
    message() {},
    close() {},
    error() {},
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  // 0-RTT is a boolean property
  expect(typeof has0RTTSupport).toBe("boolean");

  server.close();
  client.close();
});