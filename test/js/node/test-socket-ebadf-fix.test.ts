/**
 * Test for socket EBADF fix - ensuring writes to detached sockets
 * behave consistently with Node.js (return false instead of throwing)
 */

import { describe, expect, test } from "bun:test";
import { connect, createServer, Socket } from "net";

describe("socket EBADF handling", () => {
  test("write to detached socket returns false instead of throwing EBADF", async () => {
    const server = createServer();
    let serverSocket: Socket;

    server.on("connection", socket => {
      serverSocket = socket;
      socket.write("connected\n");

      // Destroy after a short delay
      setTimeout(() => {
        socket.destroy();
      }, 10);
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any).port;
    const client = connect(port);

    await new Promise<void>(resolve => {
      client.on("connect", resolve);
    });

    // Wait for server to destroy the connection
    await new Promise(resolve => setTimeout(resolve, 50));

    // This should return false, not throw
    let threwError = false;
    let writeResult: boolean;

    try {
      writeResult = client.write("test data");
    } catch (error) {
      threwError = true;
      expect((error as any).code).not.toBe("EBADF");
    }

    expect(threwError).toBe(false);
    expect(typeof writeResult!).toBe("boolean"); // May be true or false depending on timing

    client.destroy();
    server.close();
  });

  test("multiple concurrent writes during connection close", async () => {
    const server = createServer();
    let serverSockets: Socket[] = [];

    server.on("connection", socket => {
      serverSockets.push(socket);
      socket.write("ready\n");

      setTimeout(() => {
        socket.destroy();
      }, 25);
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any).port;
    const clients: Socket[] = [];
    const errors: any[] = [];

    // Create multiple clients
    for (let i = 0; i < 5; i++) {
      const client = connect(port);
      clients.push(client);

      client.on("error", error => {
        errors.push(error);
      });

      await new Promise<void>(resolve => {
        client.on("connect", resolve);
      });

      // Start rapid writes
      const writeInterval = setInterval(() => {
        try {
          const result = client.write(`data_${i}_${Date.now()}\n`);
          expect(typeof result).toBe("boolean");
        } catch (error) {
          expect((error as any).code).not.toBe("EBADF");
          clearInterval(writeInterval);
        }
      }, 5);

      // Stop after connection should be closed
      setTimeout(() => {
        clearInterval(writeInterval);
      }, 100);
    }

    // Wait for all operations to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    // Check that no EBADF errors occurred
    const ebadafErrors = errors.filter(err => err.code === "EBADF");
    expect(ebadafErrors).toHaveLength(0);

    clients.forEach(client => client.destroy());
    server.close();
  });

  test("stream end event chain should not throw EBADF", async () => {
    // This test simulates the exact chain from the stack trace:
    // endReadableNT -> emit -> transport write -> EBADF

    const server = createServer();
    let serverSocket: Socket;
    let ebadafThrown = false;

    server.on("connection", socket => {
      serverSocket = socket;
      socket.write("stream_ready\n");

      // Close abruptly to trigger the race
      setTimeout(() => {
        socket.destroy();
      }, 30);
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any).port;
    const client = connect(port);

    await new Promise<void>(resolve => {
      client.on("connect", resolve);
    });

    // Set up the event chain that was problematic
    client.on("end", () => {
      // This triggers when the readable side ends
      process.nextTick(() => {
        try {
          // This write was throwing EBADF before the fix
          const result = client.write("end_triggered_write");
          expect(typeof result).toBe("boolean");
        } catch (error) {
          if ((error as any).code === "EBADF") {
            ebadafThrown = true;
          }
        }
      });
    });

    client.on("error", error => {
      if ((error as any).code === "EBADF") {
        ebadafThrown = true;
      }
    });

    // Wait for the connection lifecycle to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(ebadafThrown).toBe(false);

    client.destroy();
    server.close();
  });

  test("corked writes should not throw EBADF when socket detaches", async () => {
    const server = createServer();
    let serverSocket: Socket;

    server.on("connection", socket => {
      serverSocket = socket;
      socket.write("cork_ready\n");

      setTimeout(() => {
        socket.destroy();
      }, 20);
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any).port;
    const client = connect(port);

    await new Promise<void>(resolve => {
      client.on("connect", resolve);
    });

    // Cork the client to buffer writes
    client.cork();

    // Add multiple writes to the buffer
    for (let i = 0; i < 20; i++) {
      const result = client.write(`corked_data_${i}\n`);
      expect(typeof result).toBe("boolean");
    }

    // Wait for socket to be destroyed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Uncorking should not throw EBADF
    let threwError = false;
    try {
      client.uncork();
    } catch (error) {
      threwError = true;
      expect((error as any).code).not.toBe("EBADF");
    }

    expect(threwError).toBe(false);

    client.destroy();
    server.close();
  });
});
