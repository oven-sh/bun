import { expect, test } from "bun:test";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const fixturesDir = join(import.meta.dir, "../../js/bun/http/fixtures");

test("#12117 TLS socket reconnection should not leak onConnectEnd listeners", async () => {
  await using server = Bun.serve({
    port: 0,
    tls: {
      cert: Bun.file(join(fixturesDir, "cert.pem")),
      key: Bun.file(join(fixturesDir, "cert.key")),
    },
    fetch() {
      return new Response("OK");
    },
  });

  const port = server.port;

  for (let i = 0; i < 50; i++) {
    const socket = tls.connect({
      port,
      host: "localhost",
      rejectUnauthorized: false,
    });

    await new Promise<void>(resolve => {
      socket.on("error", () => resolve());
      socket.on("close", () => resolve());
      socket.on("secureConnect", () => {
        socket.end();
        resolve();
      });
    });

    const endListeners = socket.listenerCount("end");
    expect(endListeners).toBeLessThanOrEqual(2);
    socket.destroy();
  }
});

test("#12117 TLS socket should clean up onConnectEnd listener on successful handshake", async () => {
  await using server = Bun.serve({
    port: 0,
    tls: {
      cert: Bun.file(join(fixturesDir, "cert.pem")),
      key: Bun.file(join(fixturesDir, "cert.key")),
    },
    fetch() {
      return new Response("OK");
    },
  });

  const socket = tls.connect({
    port: server.port,
    host: "localhost",
    rejectUnauthorized: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("secureConnect", () => {
      const endListeners = socket.listenerCount("end");
      expect(endListeners).toBeLessThanOrEqual(1);
      socket.destroy();
      resolve();
    });
    socket.on("error", reject);
  });
});

test("#12117 AbortSignal listener cleanup", async () => {
  const controller = new AbortController();

  for (let i = 0; i < 10; i++) {
    const socket = new net.Socket({ signal: controller.signal });
    socket.destroy();
  }

  expect(() => controller.abort()).not.toThrow();
});
