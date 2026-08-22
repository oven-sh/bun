import { describe, expect, it } from "bun:test";
import { expectMaxObjectTypeCount, isWindows, tls } from "harness";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { connect, createServer, TLSSocket } from "node:tls";

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

// Server-side wraps of an accepted named-pipe connection. A pipe has no fd for
// the native upgrade to adopt; the wrap has to run the TLS engine over the
// stream, the way tls.connect({ socket }) already does for pipes. It used to
// throw "upgradeTLS requires an established socket" from nextTick, uncaught.
type ServerWrap = (accepted: net.Socket, echo: (secure: TLSSocket) => void, fail: (err: Error) => void) => void;

async function serverWrapRoundTrip(wrap: ServerWrap) {
  const pipeName = `\\\\.\\pipe\\test\\${randomUUID()}`;
  const echoed = Promise.withResolvers<string>();
  const server = net.createServer(accepted => {
    accepted.on("error", echoed.reject);
    wrap(
      accepted,
      secure => {
        secure.on("error", echoed.reject);
        secure.on("data", chunk => secure.end(`echo:${chunk}`));
      },
      echoed.reject,
    );
  });
  let client: TLSSocket | undefined;
  try {
    server.listen(pipeName);
    await once(server, "listening");
    client = connect({ socket: net.connect(pipeName), rejectUnauthorized: false }, () => client!.write("ping"));
    client.on("error", echoed.reject);
    // Read through to the server's close_notify before tearing down: a pipe
    // write is only complete once the peer has read it, so closing on the
    // first data chunk would fail the server's still-pending close_notify
    // write with EPIPE.
    let received = "";
    client.on("data", chunk => (received += chunk));
    client.on("end", () => echoed.resolve(received));
    expect(await echoed.promise).toBe("echo:ping");
  } finally {
    client?.destroy();
    server.close();
  }
}

it.if(isWindows)("new TLSSocket(pipeSocket, { isServer: true }) completes a handshake over a named pipe", async () => {
  await serverWrapRoundTrip((accepted, echo) => echo(new TLSSocket(accepted, { isServer: true, ...tls })));
});

it.if(isWindows)("tls.Server wraps a named-pipe connection handed in via emit('connection')", async () => {
  const tlsServer = createServer(tls);
  try {
    await serverWrapRoundTrip((accepted, echo, fail) => {
      tlsServer.once("secureConnection", echo);
      tlsServer.once("tlsClientError", fail);
      tlsServer.emit("connection", accepted);
    });
  } finally {
    tlsServer.close();
  }
});
