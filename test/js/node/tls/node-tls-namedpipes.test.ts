import { describe, expect, it } from "bun:test";
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

describe.each(["TLSv1.2", "TLSv1.3"] as const)(
  "%s over a named pipe: write() issued before the handshake completes",
  version => {
    // Same contract as the Duplex transport tests in node-tls-connect.test.ts:
    // the write stays pending through 'secureConnect' and is delivered right
    // after the handshake. TLS 1.2 is the interesting half: a 1.2 client
    // finishes the handshake on the server's Finished without sending
    // anything of its own, so no pipe write completion follows it.
    it.if(isWindows)("is delivered after the handshake", async () => {
      const received = Promise.withResolvers<string>();
      const written = Promise.withResolvers<void>();
      const log: string[] = [];
      let client: ReturnType<typeof connect> | null = null;
      const server = createServer({ ...tls, minVersion: version, maxVersion: version }, socket => {
        socket.on("data", data => received.resolve(`${data} (${socket.getProtocol()})`));
        socket.on("error", received.reject);
      });
      server.on("tlsClientError", received.reject);
      try {
        const pipeName = `\\\\.\\pipe\\test\\${randomUUID()}`;
        server.listen(pipeName);
        await once(server, "listening");

        const socket = connect({ path: pipeName, ca: tls.cert, minVersion: version, maxVersion: version });
        client = socket;
        socket.on("error", received.reject);
        socket.on("secureConnect", () => log.push(`secureConnect writableLength=${socket.writableLength}`));
        socket.write("Hello World!", err => {
          log.push(`write callback err=${err}`);
          written.resolve();
        });

        const [data] = await Promise.all([received.promise, written.promise]);
        expect({ received: data, log }).toEqual({
          received: `Hello World! (${version})`,
          log: ["secureConnect writableLength=12", "write callback err=null"],
        });
      } finally {
        client?.destroy();
        server.close();
      }
    });

    it.if(isWindows)("is failed, not delivered, when a 'secureConnect' listener destroys the socket", async () => {
      // Settles once the server is done with the connection, whichever way the
      // client's teardown lands there (clean close of the accepted socket, or a
      // handshake it could no longer finish); either way every byte the client
      // sent has been consumed by then.
      const serverDone = Promise.withResolvers<void>();
      const writeOutcome = Promise.withResolvers<string>();
      const received: Buffer[] = [];
      let client: ReturnType<typeof connect> | null = null;
      const server = createServer({ ...tls, minVersion: version, maxVersion: version }, socket => {
        socket.on("data", (chunk: Buffer) => received.push(chunk));
        socket.on("error", () => {});
        socket.on("close", () => serverDone.resolve());
      });
      server.on("tlsClientError", () => serverDone.resolve());
      try {
        const pipeName = `\\\\.\\pipe\\test\\${randomUUID()}`;
        server.listen(pipeName);
        await once(server, "listening");

        const socket = connect({ path: pipeName, ca: tls.cert, minVersion: version, maxVersion: version });
        client = socket;
        socket.on("error", serverDone.reject);
        socket.write("parked", err => writeOutcome.resolve(err ? "failed" : "succeeded"));
        socket.on("secureConnect", () => socket.destroy());

        const [outcome] = await Promise.all([writeOutcome.promise, serverDone.promise]);
        expect({ outcome, serverReceived: Buffer.concat(received).toString() }).toEqual({
          outcome: "failed",
          serverReceived: "",
        });
      } finally {
        client?.destroy();
        server.close();
      }
    });
  },
);

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

// A named-pipe net.Socket is upgraded by running the TLS engine over the
// stream; its pipe handle stays in place and keeps delivering bytes. Those
// bytes belong to the TLS layer from then on and must not reach the pipe
// socket's own `data` listeners (the TCP counterparts of these tests live in
// node-tls-upgrade.test.ts).
// https://github.com/oven-sh/bun/issues/32242
it.if(isWindows)("tls.connect({ socket }) takes a named-pipe client socket over", async () => {
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: echoed, resolve: gotEcho } = Promise.withResolvers<string>();
  const pipeName = `\\\\.\\pipe\\test\\${randomUUID()}`;
  const server = createServer(tls, socket => {
    socket.on("error", reject);
    socket.on("data", data => socket.write(data));
  });
  server.on("error", reject);
  server.listen(pipeName);
  await once(server, "listening");

  const pipeSocket = net.connect(pipeName);
  try {
    pipeSocket.on("error", reject);
    // Plaintext-phase listener that stays attached across the upgrade.
    let surfaced = 0;
    pipeSocket.on("data", chunk => (surfaced += chunk.length));

    const client = connect({ socket: pipeSocket, ca: tls.cert, servername: "localhost" });
    client.on("error", reject);
    client.on("data", data => gotEcho(data.toString()));
    await Promise.race([once(client, "secureConnect"), failure]);
    client.write("Hello World!");
    const reply = await Promise.race([echoed, failure]);
    expect({ reply, surfaced, buffered: pipeSocket.readableLength }).toEqual({
      reply: "Hello World!",
      surfaced: 0,
      buffered: 0,
    });
  } finally {
    pipeSocket.destroy();
    server.close();
  }
});

it.if(isWindows)("tls.connect({ socket }) takes an accepted named-pipe socket over", async () => {
  // Same as above for the socket a named-pipe server accepted, driven the way
  // the issue drives it: the plaintext handler upgrades on the first chunk
  // after the greeting. The mock peer answers everything with TLS-looking
  // bytes, so some of them arrive after the upgrade: they must reach the TLS
  // layer (which reacts to them) and must not re-enter the handler, which
  // pre-fix made it upgrade a second time.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: outcome, resolve } = Promise.withResolvers<{ upgrades: number; tlsReacted: boolean }>();
  const pipeName = `\\\\.\\pipe\\test\\${randomUUID()}`;
  let accepted: net.Socket | undefined;
  const server = net.createServer(socket => {
    accepted = socket;
    let upgrades = 0;
    socket.on("error", reject);
    socket.on("close", () => resolve({ upgrades, tlsReacted: false }));
    socket.on("data", chunk => {
      if (upgrades === 0 && chunk.toString("latin1") === "PEER_GREETING") {
        socket.write("STARTTLS");
        return;
      }
      upgrades++;
      const secure = connect({ socket, rejectUnauthorized: false });
      secure.on("error", () => resolve({ upgrades, tlsReacted: true }));
      secure.on("secureConnect", () => resolve({ upgrades, tlsReacted: true }));
    });
  });
  server.on("error", reject);
  server.listen(pipeName);
  await once(server, "listening");

  const peer = net.connect(pipeName);
  try {
    peer.on("error", reject);
    peer.on("connect", () => peer.write("PEER_GREETING"));
    // First in reply to STARTTLS (this is what the handler upgrades on), then
    // in reply to the ClientHello the upgrade sends.
    peer.on("data", () => peer.write(Buffer.alloc(50, 0x16)));
    expect(await Promise.race([outcome, failure])).toEqual({ upgrades: 1, tlsReacted: true });
  } finally {
    peer.destroy();
    accepted?.destroy();
    server.close();
  }
});
