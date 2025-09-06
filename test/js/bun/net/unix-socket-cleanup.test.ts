import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Unix domain socket file should be cleaned up when listener.stop() is called", () => {
  const socketPath = join(tmpdir(), `bun_test_${randomBytes(8).toString("hex")}.sock`);

  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  using listener = Bun.listen({
    unix: socketPath,
    socket: { data() {} },
  });

  expect(existsSync(socketPath)).toBe(true);

  listener.stop();

  expect(existsSync(socketPath)).toBe(false);
});

test("Unix domain socket file should be cleaned up when listener.stop(true) is called", () => {
  const socketPath = join(tmpdir(), `bun_test_${randomBytes(8).toString("hex")}.sock`);

  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  using listener = Bun.listen({
    unix: socketPath,
    socket: { data() {} },
  });

  expect(existsSync(socketPath)).toBe(true);

  listener.stop(true);

  expect(existsSync(socketPath)).toBe(false);
});

test("Multiple Unix sockets cleanup", () => {
  const sockets: Array<Bun.UnixSocketListener<undefined>> = [];
  const paths: string[] = [];

  for (let i = 0; i < 3; i++) {
    const socketPath = join(tmpdir(), `bun_test_multi_${i}_${randomBytes(4).toString("hex")}.sock`);

    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }

    paths.push(socketPath);
    sockets.push(
      Bun.listen({
        unix: socketPath,
        socket: {
          data() {},
        },
      }),
    );

    expect(existsSync(socketPath)).toBe(true);
  }

  for (const listener of sockets) {
    listener.stop();
  }

  for (const path of paths) {
    expect(existsSync(path)).toBe(false);
  }
});

test("Unix socket cleanup with active connections", async () => {
  const socketPath = join(tmpdir(), `bun_test_active_${randomBytes(8).toString("hex")}.sock`);

  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const { promise, resolve: resolveConnectionReceived } = Promise.withResolvers<void>();

  using listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        resolveConnectionReceived();
      },
      data(socket, data) {
        socket.write(data);
      },
    },
  });

  expect(existsSync(socketPath)).toBe(true);

  await Bun.connect({
    unix: socketPath,
    socket: {
      data(socket, data) {
        socket.write(data);
      },
    },
  });

  await promise;

  listener.stop(true);

  await Bun.sleep(10);

  expect(existsSync(socketPath)).toBe(false);
});
