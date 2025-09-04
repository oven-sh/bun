import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(isWindows)("Unix domain socket file should be cleaned up when listener.stop() is called", () => {
  // Generate a random socket path to avoid conflicts
  const socketPath = join(tmpdir(), `bun_test_${randomBytes(8).toString("hex")}.sock`);

  // Clean up any existing socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  // Create a Unix socket listener
  const listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {},
      data(socket, data) {},
      close(socket) {},
    },
  });

  // Verify the socket file was created
  expect(existsSync(socketPath)).toBe(true);

  // Stop the listener
  listener.stop();

  // Verify the socket file was cleaned up
  expect(existsSync(socketPath)).toBe(false);
});

test.skipIf(isWindows)("Unix domain socket file should be cleaned up when listener.stop(true) is called", () => {
  // Generate a random socket path
  const socketPath = join(tmpdir(), `bun_test_${randomBytes(8).toString("hex")}.sock`);

  // Clean up any existing socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  // Create a Unix socket listener
  const listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {},
      data(socket, data) {},
      close(socket) {},
    },
  });

  // Verify the socket file was created
  expect(existsSync(socketPath)).toBe(true);

  // Stop the listener with force=true
  listener.stop(true);

  // Verify the socket file was cleaned up
  expect(existsSync(socketPath)).toBe(false);
});

test.skipIf(isWindows)("Abstract Unix domain sockets should not leave files (start with null byte)", () => {
  // Abstract sockets start with a null byte and don't create filesystem entries
  const abstractPath = "\0bun_test_abstract_" + randomBytes(8).toString("hex");

  // Create an abstract Unix socket listener
  const listener = Bun.listen({
    unix: abstractPath,
    socket: {
      open(socket) {},
      data(socket, data) {},
      close(socket) {},
    },
  });

  // Abstract sockets shouldn't create a file in the filesystem
  // We can't really check this, but we can verify stop() doesn't crash
  listener.stop();

  // Test passes if no crash occurs
  expect(true).toBe(true);
});

test.skipIf(isWindows)("Multiple Unix sockets cleanup", () => {
  const sockets = [];
  const paths = [];

  // Create multiple Unix socket listeners
  for (let i = 0; i < 3; i++) {
    const socketPath = join(tmpdir(), `bun_test_multi_${i}_${randomBytes(4).toString("hex")}.sock`);

    // Clean up any existing socket file
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }

    paths.push(socketPath);
    sockets.push(
      Bun.listen({
        unix: socketPath,
        socket: {
          open(socket) {},
          data(socket, data) {},
          close(socket) {},
        },
      }),
    );

    // Verify the socket file was created
    expect(existsSync(socketPath)).toBe(true);
  }

  // Stop all listeners
  for (const listener of sockets) {
    listener.stop();
  }

  // Verify all socket files were cleaned up
  for (const path of paths) {
    expect(existsSync(path)).toBe(false);
  }
});

test.skipIf(isWindows)("Unix socket cleanup with active connections", async () => {
  const socketPath = join(tmpdir(), `bun_test_active_${randomBytes(8).toString("hex")}.sock`);

  // Clean up any existing socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  let serverSocket = null;
  let connectionReceived = false;

  // Create a Unix socket listener
  const listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        serverSocket = socket;
        connectionReceived = true;
      },
      data(socket, data) {
        socket.write(data);
      },
      close(socket) {},
    },
  });

  // Verify the socket file was created
  expect(existsSync(socketPath)).toBe(true);

  // Connect to the socket
  const client = await Bun.connect({
    unix: socketPath,
    socket: {
      open(socket) {},
      data(socket, data) {},
      close(socket) {},
    },
  });

  // Wait for connection to be established
  await Bun.sleep(10);
  expect(connectionReceived).toBe(true);

  // Stop the listener with force=true (should close all connections)
  listener.stop(true);

  // Give some time for cleanup
  await Bun.sleep(10);

  // Verify the socket file was cleaned up even with active connections
  expect(existsSync(socketPath)).toBe(false);
});
