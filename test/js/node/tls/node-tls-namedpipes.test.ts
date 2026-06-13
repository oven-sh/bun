import { expect, it } from "bun:test";
import { expectMaxObjectTypeCount, isWindows, tls } from "harness";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { connect, createServer } from "node:tls";

it.if(isWindows)("should work with named pipes and tls", async () => {
  await expectMaxObjectTypeCount(expect, "TLSSocket", 0);
  async function test(pipe_name: string) {
    const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
    const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
    let client: ReturnType<typeof connect> | null = null;
    let server: ReturnType<typeof createServer> | null = null;
    try {
      server = createServer(tls, socket => {
        socket.on("data", data => {
          const message = data.toString();
          socket.write("Goodbye World!");
          resolveMessageReceived(message);
        });
      });

      server.listen(pipe_name);
      await once(server, "listening");

      client = connect({ path: pipe_name, ca: tls.cert }).on("data", data => {
        const message = data.toString();
        resolveClientReceived(message);
      });

      client?.write("Hello World!");
      const message = await messageReceived;
      expect(message).toBe("Hello World!");
      const client_message = await clientReceived;
      expect(client_message).toBe("Goodbye World!");
    } finally {
      client?.destroy();
      server?.close();
    }
  }

  const batch: Promise<void>[] = [];

  for (let i = 0; i < 200; i++) {
    batch.push(test(`\\\\.\\pipe\\test\\${randomUUID()}`));
    batch.push(test(`\\\\?\\pipe\\test\\${randomUUID()}`));
    if (i % 50 === 0) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }
  await Promise.all(batch);
  // Allow one extra straggler — server.close() resolves before the last
  // accepted socket's finalizer runs on Windows ARM64.
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
});

it.if(isWindows)("should be able to upgrade a named pipe connection to TLS", async () => {
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
  const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
  const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
  let client: ReturnType<typeof net.connect> | ReturnType<typeof connect> | null = null;
  let server: ReturnType<typeof createServer> | null = null;
  async function test(pipe_name: string) {
    try {
      server = createServer(tls, socket => {
        socket.on("data", data => {
          const message = data.toString();
          socket.write("Goodbye World!");
          resolveMessageReceived(message);
        });
      });

      server.listen(pipe_name);
      await once(server, "listening");

      const nonTLSClient = net.connect(pipe_name);
      client = connect({ socket: nonTLSClient, ca: tls.cert }).on("data", data => {
        const message = data.toString();
        resolveClientReceived(message);
      });
      await once(client, "secureConnect");
      client?.write("Hello World!");
      const message = await messageReceived;
      expect(message).toBe("Hello World!");
      const client_message = await clientReceived;
      expect(client_message).toBe("Goodbye World!");
    } finally {
      client?.destroy();
      server?.close();
    }
  }
  await test(`\\\\.\\pipe\\test\\${randomUUID()}`);
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
});

it.if(isWindows)(
  "tls.connect({ socket }) does not re-emit post-upgrade bytes on a named-pipe socket (STARTTLS) #32242",
  async () => {
    // Mock STARTTLS server over a named pipe: greet, reply PROCEED to STARTTLS,
    // then send mock TLS records. Those bytes must reach the TLS layer (OpenSSL
    // rejects them) rather than re-surface as cleartext `data` on the original
    // pipe socket. The named-pipe upgrade leaves the native handle in place, so
    // before the fix those bytes re-entered this handler and attempted a second
    // upgrade (the #32239 "Invalid socket" pattern).
    const pipe_name = `\\\\.\\pipe\\test\\${randomUUID()}`;

    const server = net.createServer(serverSocket => {
      serverSocket.on("error", () => {});
      serverSocket.write("SERVER_GREETING");
      let phase = "greeting";
      serverSocket.on("data", data => {
        if (phase === "greeting" && data.toString().includes("STARTTLS")) {
          phase = "proceed";
          serverSocket.write("PROCEED");
        } else if (phase === "proceed") {
          phase = "done";
          serverSocket.write(Buffer.alloc(50, 0x16));
        }
      });
    });

    server.listen(pipe_name);
    await once(server, "listening");

    const { promise, resolve } = Promise.withResolvers<{ upgrades: number; message: string }>();

    let upgrades = 0;
    let upgraded = false;

    const socket = net.connect(pipe_name);
    try {
      // Errors are an expected outcome here: OpenSSL rejects the mock handshake
      // bytes (the TLS socket emits `error`) and the pipe may reset during
      // teardown. Every terminal event settles `promise`, so a regression
      // surfaces as a failed assertion rather than a hang.
      socket.on("error", () => {});
      socket.on("close", () => resolve({ upgrades, message: "" }));

      socket.on("data", data => {
        if (!upgraded && data.toString("latin1").includes("SERVER_GREETING")) {
          socket.write("STARTTLS");
          return;
        }
        // The legitimate upgrade (on PROCEED) and the buggy re-entry (on
        // re-emitted ciphertext) both land here, mirroring the issue's handler.
        upgraded = true;
        upgrades++;
        const tlsSocket = connect({ socket, rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ upgrades, message: err.message }));
        tlsSocket.on("secureConnect", () => resolve({ upgrades, message: "" }));
        tlsSocket.on("close", () => resolve({ upgrades, message: "" }));
      });

      const result = await promise;

      // Once TLS owns the stream no further `data` event re-enters the handler,
      // so exactly one upgrade is attempted and it never fails with "Invalid
      // socket". A re-emitted post-upgrade chunk would push `upgrades` past 1.
      expect(result.message).not.toContain("Invalid socket");
      expect(result.upgrades).toBe(1);
    } finally {
      socket.destroy();
      server.close();
    }
  },
);

it.if(isWindows)(
  "tls.connect({ socket }) does not re-emit post-upgrade bytes on a server-accepted named-pipe socket (STARTTLS) #32242",
  async () => {
    // Same regression as above, but the upgraded socket is the one a named-pipe
    // *server* accepted (driven by ServerHandlers.data, not SocketHandlers2.data).
    // The connecting side plays the mock peer; the accepted socket runs the
    // STARTTLS handler and upgrades via `tls.connect({ socket })`. If the feeder
    // were not consulted in ServerHandlers.data, the post-upgrade bytes would
    // re-enter this handler and attempt a second upgrade.
    const pipe_name = `\\\\.\\pipe\\test\\${randomUUID()}`;

    const { promise, resolve } = Promise.withResolvers<{ upgrades: number; message: string }>();

    let upgrades = 0;
    let upgraded = false;
    let accepted: ReturnType<typeof net.connect> | null = null;

    const server = net.createServer(serverSocket => {
      accepted = serverSocket;
      serverSocket.on("error", () => {});
      serverSocket.on("close", () => resolve({ upgrades, message: "" }));
      serverSocket.on("data", data => {
        if (!upgraded && data.toString("latin1").includes("PEER_GREETING")) {
          serverSocket.write("STARTTLS");
          return;
        }
        // The legitimate upgrade (on PROCEED) and the buggy re-entry (on
        // re-emitted ciphertext) both land here.
        upgraded = true;
        upgrades++;
        const tlsSocket = connect({ socket: serverSocket, rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ upgrades, message: err.message }));
        tlsSocket.on("secureConnect", () => resolve({ upgrades, message: "" }));
        tlsSocket.on("close", () => resolve({ upgrades, message: "" }));
      });
    });

    server.listen(pipe_name);
    await once(server, "listening");

    // Mock peer: greet, reply PROCEED to STARTTLS, then send mock TLS records.
    const peer = net.connect(pipe_name);
    try {
      peer.on("error", () => {});
      peer.on("connect", () => peer.write("PEER_GREETING"));
      let phase = "greeting";
      peer.on("data", data => {
        if (phase === "greeting" && data.toString().includes("STARTTLS")) {
          phase = "proceed";
          peer.write("PROCEED");
        } else if (phase === "proceed") {
          phase = "done";
          peer.write(Buffer.alloc(50, 0x16));
        }
      });

      const result = await promise;

      expect(result.message).not.toContain("Invalid socket");
      expect(result.upgrades).toBe(1);
    } finally {
      peer.destroy();
      accepted?.destroy();
      server.close();
    }
  },
);
