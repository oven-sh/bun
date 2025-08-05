import { test, expect } from "bun:test";

test("Bun.quic should be available", () => {
  expect(typeof Bun.quic).toBe("function");
});

test("Bun.quic should create a QUIC socket with basic options", () => {
  const socket = Bun.quic({
    hostname: "localhost",
    port: 8443,
    server: false,
    data: {
      test: true
    },
    open(socket) {
      console.log("QUIC connection opened", socket);
    },
    message(socket, data) {
      console.log("QUIC message received", data);
    },
    close(socket) {
      console.log("QUIC connection closed", socket);
    },
    error(socket, error) {
      console.log("QUIC error", error);
    },
  });

  expect(socket).toBeDefined();
  expect(typeof socket.connect).toBe("function");
  expect(typeof socket.write).toBe("function");
  expect(typeof socket.read).toBe("function");
  expect(typeof socket.createStream).toBe("function");
  expect(typeof socket.close).toBe("function");
  
  // Test properties
  expect(typeof socket.isConnected).toBe("boolean");
  expect(typeof socket.isServer).toBe("boolean");
  expect(typeof socket.streamCount).toBe("number");
  expect(socket.readyState).toBe("open");
  
  // Clean up
  socket.close();
  expect(socket.readyState).toBe("closed");
});

test("QuicSocket should support server mode", () => {
  const server = Bun.quic({
    hostname: "localhost", 
    port: 8443,
    server: true,
    data: {
      isServer: true
    },
    open(socket) {
      console.log("QUIC server ready", socket);
    },
    connection(socket) {
      console.log("New QUIC connection", socket);
    },
    message(socket, data) {
      console.log("Server received message", data);
    },
    close(socket) {
      console.log("QUIC server closed", socket);
    },
    error(socket, error) {
      console.log("QUIC server error", error);
    },
  });

  expect(server).toBeDefined();
  expect(server.isServer).toBe(true);
  
  // Clean up
  server.close();
});

test("QuicSocket should provide stats", () => {
  const socket = Bun.quic({
    hostname: "localhost",
    port: 8443,
    server: false,
    open() {},
    message() {},
    close() {},
    error() {},
  });

  const stats = socket.stats;
  expect(stats).toBeDefined();
  expect(typeof stats.streamCount).toBe("number");
  expect(typeof stats.isConnected).toBe("boolean");
  expect(typeof stats.has0RTT).toBe("boolean");
  expect(typeof stats.bytesSent).toBe("number");
  expect(typeof stats.bytesReceived).toBe("number");
  
  socket.close();
});

test("QuicSocket should support stream creation", () => {
  const socket = Bun.quic({
    hostname: "localhost",
    port: 8443, 
    server: false,
    open() {},
    message() {},
    close() {},
    error() {},
  });

  // Stream creation should succeed even during connection process in QUIC
  expect(() => socket.createStream()).not.toThrow();
  expect(typeof socket.createStream()).toBe("number");
  
  socket.close();
});

test("QuicSocket should validate options", () => {
  // Missing options
  expect(() => Bun.quic()).toThrow();
  
  // Invalid options type
  expect(() => Bun.quic("invalid")).toThrow();
  
  // Empty options should work (no connection will be made)
  const socket = Bun.quic({
    open() {},
    message() {},
    close() {},
    error() {},
  });
  expect(socket).toBeDefined();
  socket.close();
});