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
    // pipe socket, whose native handle the named-pipe upgrade leaves in place.
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

    const { promise, resolve } = Promise.withResolvers<{ upgrades: number; outcome: string; message: string }>();

    let upgrades = 0;
    let upgraded = false;

    const socket = net.connect(pipe_name);
    try {
      // The post-upgrade bytes must reach the TLS layer via the feeder, which
      // surfaces as a TLS-level terminal event (the handshake completes, or the
      // parser errors on the mock records) rather than the raw socket closing
      // with the TLS layer idle. The raw-close outcome is tagged so a dropped
      // feeder fails the `outcome` assertion.
      socket.on("error", () => {});
      socket.on("close", () => resolve({ upgrades, outcome: "socket-close", message: "" }));

      socket.on("data", data => {
        if (!upgraded && data.toString("latin1").includes("SERVER_GREETING")) {
          socket.write("STARTTLS");
          return;
        }
        // The handler upgrades on any post-greeting data, so a chunk re-emitted
        // as cleartext after the upgrade would be counted as a second upgrade.
        upgraded = true;
        upgrades++;
        const tlsSocket = connect({ socket, rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ upgrades, outcome: "tls-error", message: err.message }));
        tlsSocket.on("secureConnect", () => resolve({ upgrades, outcome: "secure-connect", message: "" }));
        tlsSocket.on("close", () => resolve({ upgrades, outcome: "tls-close", message: "" }));
      });

      const result = await promise;

      // The post-upgrade bytes reached the TLS layer (the outcome is a TLS-level
      // event, not the raw socket closing idle). Once TLS owns the stream no
      // further `data` event re-enters the handler, so exactly one upgrade is
      // attempted and it never fails with "Invalid socket". A re-emitted
      // post-upgrade chunk would push `upgrades` past 1.
      expect(result.message).not.toContain("Invalid socket");
      expect(result.outcome).not.toBe("socket-close");
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
    // Same as above, but the upgraded socket is the one a named-pipe *server*
    // accepted. The connecting side plays the mock peer; the accepted socket
    // runs the STARTTLS handler and upgrades via `tls.connect({ socket })`.
    const pipe_name = `\\\\.\\pipe\\test\\${randomUUID()}`;

    const { promise, resolve } = Promise.withResolvers<{ upgrades: number; outcome: string; message: string }>();

    let upgrades = 0;
    let upgraded = false;
    let accepted: ReturnType<typeof net.connect> | null = null;

    const server = net.createServer(serverSocket => {
      accepted = serverSocket;
      serverSocket.on("error", () => {});
      // A bare accepted-socket close (the TLS layer idle) means the feeder never
      // delivered the post-upgrade bytes; it is tagged so the `outcome`
      // assertion fails in that case.
      serverSocket.on("close", () => resolve({ upgrades, outcome: "accepted-close", message: "" }));
      serverSocket.on("data", data => {
        if (!upgraded && data.toString("latin1").includes("PEER_GREETING")) {
          serverSocket.write("STARTTLS");
          return;
        }
        // The handler upgrades on any post-greeting data, so a chunk re-emitted
        // as cleartext after the upgrade would be counted as a second upgrade.
        upgraded = true;
        upgrades++;
        const tlsSocket = connect({ socket: serverSocket, rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ upgrades, outcome: "tls-error", message: err.message }));
        tlsSocket.on("secureConnect", () => resolve({ upgrades, outcome: "secure-connect", message: "" }));
        tlsSocket.on("close", () => resolve({ upgrades, outcome: "tls-close", message: "" }));
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

      // The post-upgrade bytes reached the accepted socket's TLS layer via the
      // feeder (the outcome is a TLS-level event, not the accepted socket
      // closing idle). Exactly one upgrade happens and it never fails with
      // "Invalid socket".
      expect(result.message).not.toContain("Invalid socket");
      expect(result.outcome).not.toBe("accepted-close");
      expect(result.upgrades).toBe(1);
    } finally {
      peer.destroy();
      accepted?.destroy();
      server.close();
    }
  },
);
