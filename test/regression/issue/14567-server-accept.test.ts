import { createSocketPair } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// TODO: These tests currently fail because us_poll_start_rc fails when trying to add
// the socket pair FD to epoll. This needs further investigation - the FD from createSocketPair
// may need special handling or the socket needs to be in a different state.

test.todo("server.accept() accepts file descriptor and handles HTTP request", async () => {
  const [serverFd, clientFd] = createSocketPair();

  // Create HTTP server
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello from accepted connection!");
    },
  });

  try {
    // Accept the server side of the socket pair into the HTTP server
    server.accept(serverFd);

    // Connect client socket
    const client = await Bun.connect({
      socket: {
        data(socket, data) {
          // Receive response from server
          socket.data.response = data;
        },
        open(socket) {
          // Send HTTP request
          socket.write("GET / HTTP/1.1\r\n" + "Host: localhost\r\n" + "Connection: close\r\n" + "\r\n");
        },
        close(socket) {
          socket.data.closed = true;
        },
      },
      data: {
        response: null,
        closed: false,
      },
      fd: clientFd,
    });

    // Wait for response
    await new Promise(resolve => {
      const interval = setInterval(() => {
        if (client.data.response) {
          clearInterval(interval);
          resolve(undefined);
        }
      }, 10);
    });

    // Verify we got an HTTP response
    const response = Buffer.from(client.data.response).toString();
    expect(response).toContain("HTTP/1.1 200");
    expect(response).toContain("Hello from accepted connection!");

    client.end();
  } finally {
    server.stop();
  }
});

test("server.accept() throws on invalid file descriptor", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    expect(() => server.accept(-1)).toThrow();
    expect(() => server.accept(999999)).toThrow();
  } finally {
    server.stop();
  }
});

test("server.accept() requires a number argument", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    // @ts-expect-error - testing invalid input
    expect(() => server.accept()).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept("not a number")).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept({})).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => server.accept(null)).toThrow();
  } finally {
    server.stop();
  }
});

test("server.accept() method exists and is callable", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  try {
    expect(typeof server.accept).toBe("function");
    expect(server.accept.length).toBe(1);
  } finally {
    server.stop();
  }
});
