import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { createConnection, createServer } from "node:net";
import { createServer as createTlsServer, connect as tlsConnect } from "node:tls";

// Regression test for https://github.com/oven-sh/bun/issues/21226
// SocketHandlers2 (client-side socket handlers) crashed with
// "TypeError: Right side of assignment cannot be destructured"
// when socket.data was undefined during drain/close/etc callbacks.

test("net client socket does not crash when rapidly connecting and disconnecting (issue #21226)", async () => {
  // Create a simple TCP server
  const server = createServer(socket => {
    socket.on("data", data => {
      socket.write(data);
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    // Rapidly create and destroy many connections to exercise SocketHandlers2 code paths
    // This tries to trigger the race condition where socket.data could be undefined
    const iterations = 50;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < iterations; i++) {
      promises.push(
        new Promise<void>((resolve, reject) => {
          const client = createConnection(port, "127.0.0.1", () => {
            client.write("test data " + i);
          });

          client.on("data", () => {
            // Immediately destroy after receiving data
            client.destroy();
          });

          client.on("close", () => {
            resolve();
          });

          client.on("error", err => {
            // Connection reset errors are acceptable
            if ((err as any).code === "ECONNRESET" || (err as any).code === "EPIPE") {
              resolve();
            } else {
              reject(err);
            }
          });
        }),
      );
    }

    await Promise.all(promises);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("tls client socket does not crash when rapidly connecting and disconnecting (issue #21226)", async () => {
  // Create a TLS server (the original issue was triggered with TLS connections)
  const server = createTlsServer(
    {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
    },
    socket => {
      socket.on("data", data => {
        socket.write(data);
      });
    },
  );

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    // Rapidly create and destroy many TLS connections
    const iterations = 50;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < iterations; i++) {
      promises.push(
        new Promise<void>((resolve, reject) => {
          const client = tlsConnect(
            {
              port,
              host: "127.0.0.1",
              rejectUnauthorized: false,
            },
            () => {
              client.write("test data " + i);
            },
          );

          client.on("data", () => {
            client.destroy();
          });

          client.on("close", () => {
            resolve();
          });

          client.on("error", err => {
            if ((err as any).code === "ECONNRESET" || (err as any).code === "EPIPE") {
              resolve();
            } else {
              reject(err);
            }
          });
        }),
      );
    }

    await Promise.all(promises);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Direct test: verify the fix by spawning a subprocess that exercises the
// SocketHandlers2 drain handler under conditions where socket.data might be undefined
test("net.connect drain handler does not throw when socket.data is undefined (issue #21226)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const net = require("node:net");
      const server = net.createServer(socket => {
        // Write a lot of data to trigger drain on the client
        for (let i = 0; i < 100; i++) {
          socket.write("x".repeat(1024));
        }
        socket.end();
      });
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        // Create many concurrent connections
        let completed = 0;
        const total = 20;
        for (let i = 0; i < total; i++) {
          const client = net.createConnection(port, "127.0.0.1", () => {
            client.write("hello");
          });
          client.on("data", () => {
            client.destroy();
          });
          client.on("close", () => {
            completed++;
            if (completed === total) {
              server.close();
              process.exit(0);
            }
          });
          client.on("error", () => {
            completed++;
            if (completed === total) {
              server.close();
              process.exit(0);
            }
          });
        }
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
