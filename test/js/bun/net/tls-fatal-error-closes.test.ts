// A TLS session that gets a record it cannot authenticate is over. The TLS engine itself closes the connection, whatever
// the owner of the socket does with the report, and nothing that the peer sends behind that record is delivered.
//
// One row for each owner of a TLS connection. A TCP relay stands between the owner and its peer. Once the session carries
// application data, the relay puts a bad record in front of the peer's next, valid, message ("later"). The relay never
// closes the owner's connection itself, so `closedByOwner` only resolves when the owner's side sends a FIN or a RST.
//
// Two engines: openssl.c drives a socket, SSLWrapper drives TLS over a Duplex, a CONNECT tunnel or a named pipe.
import { RedisClient, SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tls as cert } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import https from "node:https";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";
import {
  listeningServer,
  MYSQL_CLIENT_LONG_PASSWORD,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  pgAuthenticationOk,
  pgCommandComplete,
  pgReadyForQuery,
  pgSSLResponse,
} from "../../sql/wire-frames";
import { startRecordingProxy } from "../../web/websocket/proxy-test-utils";

// The environment must not choose the route of the fetch and WebSocket rows.
const proxyEnvKeys = ["NO_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].flatMap(key => [key, key.toLowerCase()]);
const savedProxyEnv = proxyEnvKeys.map(key => [key, process.env[key]] as const);
for (const key of proxyEnvKeys) process.env[key] = "";
afterAll(() => {
  for (const [key, value] of savedProxyEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// application_data, 32 bytes that no key authenticates.
const BAD_RECORD = Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, 0x20]), Buffer.alloc(32, 0x42)]);
const BAD_RECORD_REASON = "error:1000008b:SSL routines:OPENSSL_internal:DECRYPTION_FAILED_OR_BAD_RECORD_MAC";

// A relay to 127.0.0.1:`port`. `owner` says which side is under test. `corrupt()` sends the bad record to that side.
async function faultRelay(port: number, owner: "client" | "server") {
  const closedByOwner = Promise.withResolvers<void>();
  let toOwner: net.Socket | undefined;
  const sockets: net.Socket[] = [];
  const relay = await listeningServer(client => {
    const upstream = net.connect(port, "127.0.0.1");
    sockets.push(client, upstream);
    const [ownerSide, peerSide] = owner === "client" ? [client, upstream] : [upstream, client];
    toOwner = ownerSide;
    for (const socket of [client, upstream]) socket.on("error", () => {});
    ownerSide.on("data", chunk => peerSide.write(chunk));
    peerSide.on("data", chunk => ownerSide.write(chunk));
    ownerSide.on("end", closedByOwner.resolve);
    ownerSide.on("close", closedByOwner.resolve);
  });
  return {
    port: relay.port,
    closedByOwner: closedByOwner.promise,
    corrupt: () => void toOwner!.write(BAD_RECORD),
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise(closed => relay.server.close(closed));
    },
  };
}

// A TLS server for the client rows. `plain` runs the cleartext prelude of the protocol. `onData(socket, chunk, fault)`
// plays the protocol. `fault(later)` sends the bad record and, behind it, `later` as a valid message.
async function serverBehindRelay(
  maxVersion: tls.SecureVersion,
  onData: (socket: tls.TLSSocket, chunk: Buffer, fault: (later: string | Buffer) => void) => void,
  plain?: (socket: net.Socket) => Promise<void>,
) {
  let fault!: (later: string | Buffer) => void;
  const backend = await listeningServer(async raw => {
    raw.on("error", () => {});
    await plain?.(raw);
    const socket = new tls.TLSSocket(raw, { isServer: true, cert: cert.cert, key: cert.key, maxVersion });
    fault = later => {
      relay.corrupt();
      socket.write(later);
    };
    socket.on("error", () => {});
    socket.on("close", () => raw.destroy());
    socket.on("data", chunk => onData(socket, chunk, fault));
  });
  const relay = await faultRelay(backend.port, "client");
  return {
    port: relay.port,
    closedByOwner: relay.closedByOwner,
    fault: (later: string | Buffer) => fault(later),
    async [Symbol.asyncDispose]() {
      await relay[Symbol.asyncDispose]();
      await new Promise(closed => backend.server.close(closed));
    },
  };
}

// Answers "go" with "first", and the next message with the fault.
const firstThenFault: Parameters<typeof serverBehindRelay>[1] = (socket, chunk, fault) =>
  String(chunk) === "go" ? void socket.write("first") : fault("later");

// Answers a request with the head of a response and the first chunk of its body.
const httpBody: Parameters<typeof serverBehindRelay>[1] = socket =>
  void socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n");

const textFrame = (text: string) => Buffer.concat([Buffer.from([0x81, text.length]), Buffer.from(text)]);
// Answers the upgrade request with 101 and the frame "first". The client's answer to that frame gets the fault.
const webSocketThenFault: Parameters<typeof serverBehindRelay>[1] = (socket, chunk, fault) => {
  const key = /sec-websocket-key:\s*(\S+)/i.exec(chunk.toString("latin1"))?.[1];
  if (!key) return fault(textFrame("later"));
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.write(textFrame("first"));
};

// The fault is in place of the rest of the body, once the first chunk arrived.
async function fetchEvents(server: Awaited<ReturnType<typeof serverBehindRelay>>, proxy: string | false) {
  const events: string[] = [];
  try {
    const response = await fetch(`https://127.0.0.1:${server.port}/`, {
      tls: { ca: cert.cert },
      proxy,
      keepalive: false,
    });
    for await (const chunk of response.body!) {
      events.push(`data ${Buffer.from(chunk)}`);
      server.fault("5\r\nlater\r\n0\r\n\r\n");
    }
    events.push("end");
  } catch (e: any) {
    events.push(`error ${e.code}`);
  }
  return events;
}

function webSocketEvents(port: number, tlsOptions: object, proxy?: string) {
  const events: string[] = [];
  const closed = Promise.withResolvers<string[]>();
  const ws = new WebSocket(`wss://127.0.0.1:${port}/`, { tls: tlsOptions, proxy } as any);
  ws.onmessage = event => {
    events.push(`message ${event.data}`);
    ws.send("answer");
  };
  ws.onclose = event => {
    events.push(`close ${event.code}`);
    closed.resolve(events);
  };
  return closed.promise;
}

// The events of a node:tls socket up to 'close'. It answers "first", which asks the peer for the fault.
function nodeTlsEvents(socket: tls.TLSSocket) {
  const events: string[] = [];
  const closed = Promise.withResolvers<string[]>();
  socket.on("data", chunk => {
    events.push(`data ${chunk}`);
    if (String(chunk) === "first") socket.write("fault");
  });
  socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
  socket.on("end", () => events.push("end"));
  socket.on("close", hadError => {
    events.push(`close ${hadError}`);
    closed.resolve(events);
  });
  return closed.promise;
}
const nodeTlsFault = ["data first", "error ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC", "end", "close false"];

function overDuplex(raw: net.Socket) {
  raw.on("error", () => {});
  const duplex = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      raw.write(chunk, callback);
    },
    final(callback) {
      raw.end(callback);
    },
    destroy(err, callback) {
      raw.destroy();
      callback(err);
    },
  });
  raw.on("data", chunk => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  return duplex;
}

const postgresPrelude = async (socket: net.Socket) => {
  await once(socket, "data");
  socket.write(pgSSLResponse("S"));
};

// Sends a HandshakeV10 that offers TLS, reads the SSLRequest packet and leaves what follows it to the TLS engine.
const mysqlPrelude = (socket: net.Socket) =>
  new Promise<void>(resolve => {
    socket.write(
      mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_LONG_PASSWORD | MYSQL_CLIENT_SSL }),
    );
    let buffered = Buffer.alloc(0);
    socket.on("data", function onData(chunk: Buffer) {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4 || buffered.length < 4 + buffered.readUIntLE(0, 3)) return;
      socket.removeListener("data", onData);
      socket.pause();
      socket.unshift(buffered.subarray(4 + buffered.readUIntLE(0, 3)));
      resolve();
    });
  });

describe.each(["TLSv1.3", "TLSv1.2"] as const)("a bad record on an established %s session", maxVersion => {
  describe("closes the client", () => {
    test.concurrent.each(["a socket", "a Duplex"])("node:tls over %s", async transport => {
      await using server = await serverBehindRelay(maxVersion, firstThenFault);
      const socket = tls.connect({
        ca: cert.cert,
        servername: "localhost",
        ...(transport === "a socket"
          ? { port: server.port, host: "127.0.0.1" }
          : { socket: overDuplex(net.connect(server.port, "127.0.0.1")) }),
      });
      socket.write("go");
      expect(await nodeTlsEvents(socket)).toEqual(nodeTlsFault);
      await server.closedByOwner;
    });

    test.concurrent.each([true, false])("Bun.connect (error handler: %p)", async withErrorHandler => {
      await using server = await serverBehindRelay(maxVersion, firstThenFault);
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: cert.cert, serverName: "localhost" },
        socket: {
          handshake: (socket, success) => void (events.push(`handshake ${success}`), socket.write("go")),
          data: (socket, chunk) => void (events.push(`data ${chunk}`), socket.write("fault")),
          ...(withErrorHandler && {
            error: (socket: Bun.Socket, error: Error) =>
              void events.push(`error ${(error as any).code}: ${error.message}, write ${socket.write("more")}`),
          }),
          close: socket => void (events.push(`close authorized=${socket.authorized}`), closed.resolve()),
        },
      });
      await closed.promise;
      expect(events).toEqual([
        "handshake true",
        "data first",
        ...(withErrorHandler ? [`error EPROTO: ${BAD_RECORD_REASON}, write -1`] : []),
        "close authorized=false",
      ]);
      await server.closedByOwner;
    });

    test.concurrent("fetch", async () => {
      await using server = await serverBehindRelay(maxVersion, httpBody);
      expect(await fetchEvents(server, false)).toEqual(["data first", "error EPROTO"]);
      await server.closedByOwner;
    });

    test.concurrent("fetch through a CONNECT proxy", async () => {
      await using server = await serverBehindRelay(maxVersion, httpBody);
      using proxy = await startRecordingProxy();
      expect(await fetchEvents(server, `http://127.0.0.1:${proxy.port}`)).toEqual(["data first", "error EPROTO"]);
      await server.closedByOwner;
    });

    // With rejectUnauthorized: false the WebSocket client does nothing with the report.
    test.concurrent.each([{ ca: cert.cert }, { rejectUnauthorized: false }])("WebSocket %p", async tlsOptions => {
      await using server = await serverBehindRelay(maxVersion, webSocketThenFault);
      expect(await webSocketEvents(server.port, tlsOptions)).toEqual(["message first", "close 1006"]);
      await server.closedByOwner;
    });

    test.concurrent("WebSocket through a CONNECT proxy", async () => {
      await using server = await serverBehindRelay(maxVersion, webSocketThenFault);
      using proxy = await startRecordingProxy();
      const events = await webSocketEvents(server.port, { ca: cert.cert }, `http://127.0.0.1:${proxy.port}`);
      expect(events).toEqual(["message first", "close 1006"]);
      // The connection to the proxy stays open: https://github.com/oven-sh/bun/pull/37487
    });

    test.concurrent("Bun.SQL postgres", async () => {
      let started = false;
      await using server = await serverBehindRelay(
        maxVersion,
        (socket, _chunk, fault) => {
          if (started) return fault(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()]));
          started = true;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        },
        postgresPrelude,
      );
      await using sql = new SQL({
        url: `postgres://user:pass@localhost:${server.port}/db?sslmode=verify-full`,
        tls: { ca: cert.cert },
        max: 1,
      });
      const outcome = await sql`SELECT 1`.simple().then(
        () => "resolved",
        e => `${e.code}: ${e.message}`,
      );
      expect(outcome).toBe(`EPROTO: ${BAD_RECORD_REASON}`);
      await server.closedByOwner;
    });

    test.concurrent("Bun.SQL mysql", async () => {
      let authenticated = false;
      await using server = await serverBehindRelay(
        maxVersion,
        (socket, chunk, fault) => {
          if (!authenticated) {
            authenticated = true;
            return void socket.write(mysqlOkPacket(chunk[3] + 1));
          }
          if (!mysqlAckSessionSetup(socket, chunk.subarray(4))) fault(mysqlOkPacket(1));
        },
        mysqlPrelude,
      );
      await using sql = new SQL({
        url: `mysql://user:pass@localhost:${server.port}/db?sslmode=verify-full`,
        tls: { ca: cert.cert },
        max: 1,
      });
      const outcome = await sql`SELECT 1`.simple().then(
        () => "resolved",
        e => `${e.code}: ${e.message}`,
      );
      expect(outcome).toBe(`EPROTO: ${BAD_RECORD_REASON}`);
      await server.closedByOwner;
    });

    test.concurrent("Bun.RedisClient", async () => {
      await using server = await serverBehindRelay(maxVersion, (socket, chunk, fault) =>
        String(chunk).includes("HELLO") ? void socket.write("%1\r\n$5\r\nproto\r\n:3\r\n") : fault("$5\r\nlater\r\n"),
      );
      const client = new RedisClient(`rediss://localhost:${server.port}`, {
        tls: { ca: cert.cert },
        autoReconnect: false,
      });
      const outcome = await client.get("key").then(
        value => `value ${value}`,
        e => `${e.code}: ${e.message}`,
      );
      client.close();
      expect(outcome).toBe(`EPROTO: ${BAD_RECORD_REASON}`);
      await server.closedByOwner;
    });
  });

  describe("closes the server", () => {
    // A node:tls client behind the relay. It sends "go". `fault()` sends the bad record and, behind it, "later".
    async function clientBehindRelay(port: number) {
      const relay = await faultRelay(port, "server");
      const client = tls.connect({
        port: relay.port,
        host: "127.0.0.1",
        ca: cert.cert,
        servername: "localhost",
        maxVersion,
      });
      client.on("error", () => {});
      client.write("go");
      return {
        client,
        closedByOwner: relay.closedByOwner,
        fault(later = "later") {
          relay.corrupt();
          client.write(later);
        },
        async [Symbol.asyncDispose]() {
          client.destroy();
          await relay[Symbol.asyncDispose]();
        },
      };
    }

    test.concurrent.each(["a socket", "a Duplex"])("node:tls over %s", async transport => {
      const accepted = Promise.withResolvers<string[]>();
      const server = tls.createServer(cert, socket => {
        nodeTlsEvents(socket).then(accepted.resolve);
      });
      // Over a Duplex this server never listens: a TCP server hands it each connection.
      const listener =
        transport === "a socket" ? server : net.createServer(raw => server.emit("connection", overDuplex(raw)));
      await once(listener.listen(0, "127.0.0.1"), "listening");
      try {
        await using peer = await clientBehindRelay((listener.address() as net.AddressInfo).port);
        peer.client.once("data", () => peer.fault());
        server.once("secureConnection", socket => socket.once("data", () => socket.write("ready")));
        expect(await accepted.promise).toEqual(["data go", ...nodeTlsFault.slice(1)]);
        await peer.closedByOwner;
      } finally {
        listener.close();
      }
    });

    // "open only": with no `handshake` handler `open` gets the report of the handshake, and no other report.
    test.concurrent.each(["error", "no error", "open only"])("Bun.listen (%s handler)", async handlers => {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: cert,
        socket: {
          ...(handlers === "open only"
            ? { open: () => void events.push("open") }
            : { handshake: (_socket: Bun.Socket, success: boolean) => void events.push(`handshake ${success}`) }),
          data: (socket, chunk) => void (events.push(`data ${chunk}`), socket.write("ready")),
          ...(handlers === "error" && {
            error: (_socket: Bun.Socket, error: Error) =>
              void events.push(`error ${(error as any).code}: ${error.message}`),
          }),
          close: () => void (events.push("close"), closed.resolve()),
        },
      });
      await using peer = await clientBehindRelay(listener.port);
      peer.client.once("data", () => peer.fault());
      await closed.promise;
      expect(events).toEqual([
        handlers === "open only" ? "open" : "handshake true",
        "data go",
        ...(handlers === "error" ? [`error EPROTO: ${BAD_RECORD_REASON}`] : []),
        "close",
      ]);
      await peer.closedByOwner;
    });

    test.concurrent.each(["Bun.serve", "node:https"])("%s", async kind => {
      const requests: string[] = [];
      const bunServer =
        kind === "Bun.serve"
          ? Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              tls: cert,
              fetch: request => (requests.push(new URL(request.url).pathname), new Response("ok")),
            })
          : undefined;
      const nodeServer = bunServer
        ? undefined
        : https.createServer(cert, (request, response) => (requests.push(request.url!), response.end("ok")));
      if (nodeServer) await once(nodeServer.listen(0, "127.0.0.1"), "listening");
      try {
        const relay = await faultRelay(bunServer?.port ?? (nodeServer!.address() as net.AddressInfo).port, "server");
        await using _ = relay;
        const client = tls.connect({
          port: relay.port,
          host: "127.0.0.1",
          ca: cert.cert,
          servername: "localhost",
          maxVersion,
        });
        client.on("error", () => {});
        client.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await once(client, "data");
        relay.corrupt();
        client.write("GET /later HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await relay.closedByOwner;
        client.destroy();
        expect(requests).toEqual(["/first"]);
      } finally {
        bunServer?.stop(true);
        nodeServer?.close();
      }
    });
  });
});
