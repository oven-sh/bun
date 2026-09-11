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

// Same contract as "tls.connect over a Duplex reports a fatal post-handshake
// SSL error" in node-tls-connect.test.ts, with both TLS peers on a named pipe.
// A plain pipe proxy between them injects a record that cannot authenticate
// once the handshake has completed on both sides.
describe("a fatal post-handshake SSL error over a named pipe", () => {
  const BAD_RECORD = Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, 0x20]), Buffer.alloc(32, 0x42)]);
  // BoringSSL and OpenSSL 3 name the bad_record_mac alert differently.
  const ALERT_BAD_RECORD_MAC = (process.features as { openssl_is_boringssl?: boolean }).openssl_is_boringssl
    ? "ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC"
    : "ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC";

  type Outcome = { event: string; code?: string; library?: string };
  // Settles on the 'error' (expected), or on a 'close' with no 'error' before it (the bug).
  function firstErrorOrClose(socket: net.Socket): Promise<Outcome> {
    return new Promise(resolve => {
      socket.once("error", (err: NodeJS.ErrnoException & { library?: string }) =>
        resolve({ event: "error", code: err.code, library: err.library }),
      );
      socket.once("close", () => resolve({ event: "close" }));
    });
  }

  async function run(inject: (toClient: net.Socket, toServer: net.Socket) => void) {
    let toClient: net.Socket | undefined;
    let toServer: net.Socket | undefined;
    let client: ReturnType<typeof connect> | undefined;
    let serverSocket: ReturnType<typeof connect> | undefined;
    const serverPipe = `\\\\.\\pipe\\test\\${randomUUID()}`;
    const proxyPipe = `\\\\.\\pipe\\test\\${randomUUID()}`;
    const server = createServer(tls);
    const serverOutcome = Promise.withResolvers<Outcome>();
    server.on("secureConnection", s => firstErrorOrClose(s).then(serverOutcome.resolve));
    const proxy = net.createServer(c => {
      toClient = c;
      toServer = net.connect(serverPipe);
      c.pipe(toServer);
      toServer.pipe(c);
      c.on("error", () => {});
      toServer.on("error", () => {});
    });
    try {
      await once(server.listen(serverPipe), "listening");
      const serverSecure = once(server, "secureConnection");
      await once(proxy.listen(proxyPipe), "listening");

      client = connect({ path: proxyPipe, rejectUnauthorized: false });
      const clientOutcome = firstErrorOrClose(client);
      await once(client, "secureConnect");
      [serverSocket] = await serverSecure;

      inject(toClient!, toServer!);
      return { client: await clientOutcome, server: await serverOutcome.promise };
    } finally {
      for (const s of [client, serverSocket, toClient, toServer]) s?.destroy();
      proxy.close();
      server.close();
    }
  }

  it.if(isWindows)("a record that fails to decrypt on the client", async () => {
    expect(await run(toClient => void toClient.write(BAD_RECORD))).toEqual({
      client: { event: "error", code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC", library: "SSL routines" },
      // The client's bad_record_mac alert reaches the server as its own error.
      server: { event: "error", code: ALERT_BAD_RECORD_MAC, library: "SSL routines" },
    });
  });

  it.if(isWindows)("a record that fails to decrypt on the server", async () => {
    expect(await run((_toClient, toServer) => void toServer.write(BAD_RECORD))).toEqual({
      client: { event: "error", code: ALERT_BAD_RECORD_MAC, library: "SSL routines" },
      server: { event: "error", code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC", library: "SSL routines" },
    });
  });
});
