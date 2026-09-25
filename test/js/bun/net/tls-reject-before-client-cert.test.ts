// A client with rejectUnauthorized on must abort the TLS handshake when the
// server's chain fails verification, before its own Certificate message goes
// out. Otherwise a server the client then refuses still learns the client's
// mTLS identity. node:tls already did this; these cover the other clients.
//
// Each mock server requests a client certificate, accepts any, and records
// the peer CN on `secure`. The client pins ca2 while the server presents the
// self-signed harness certificate, so the chain must fail. The client's own
// certificate is agent3 (signed by ca2).
//
// Four clients run TLS in SSLWrapper, not on a usockets socket: fetch and
// WebSocket through an HTTP CONNECT proxy, tls.connect over a Duplex, and
// tls.connect over a Windows named pipe.
//
// The same holds for a server whose chain verifies but whose certificate names
// another host. There the server presents agent1 (signed by ca1, names only
// "agent1") and the client pins ca1.
import { RedisClient, SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tls as harnessTls, isWindows, tempDir } from "harness";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";
import {
  MYSQL_CLIENT_LONG_PASSWORD,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  listeningServer,
  mysqlHandshakeV10,
  pgSSLResponse,
} from "../../sql/wire-frames";
import { startRecordingProxy } from "../../web/websocket/proxy-test-utils";

// NO_PROXY applies to an explicit `proxy` option too. An ambient
// NO_PROXY=127.0.0.1 would send the proxy rows direct, and they would then
// test the wrong client. With NO_PROXY off, an ambient HTTPS_PROXY (or
// ALL_PROXY, its fallback) would capture the direct rows. An empty value turns
// each one off.
const proxyEnvKeys = ["NO_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].flatMap(key => [key, key.toLowerCase()]);
const savedProxyEnv = proxyEnvKeys.map(key => [key, process.env[key]] as const);
for (const key of proxyEnvKeys) process.env[key] = "";
afterAll(() => {
  for (const [key, value] of savedProxyEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const keys = join(import.meta.dir, "../../node/test/fixtures/keys");
const pem = (name: string) => readFileSync(join(keys, name), "utf8");
const serverCert = harnessTls.cert;
const serverKey = harnessTls.key;
const trustedCA = harnessTls.cert;
const untrustedCA = pem("ca2-cert.pem");
const clientCert = pem("agent3-cert.pem");
const clientKey = pem("agent3-key.pem");

const identity = { cert: clientCert, key: clientKey };
const mtls = { ca: untrustedCA, ...identity };

// agent1's only name is its CN (it has no SAN), so it names neither localhost
// nor 127.0.0.1. A client that pins ca1 accepts its chain.
const otherHost = { cert: pem("agent1-cert.pem"), key: pem("agent1-key.pem") };
const otherHostMtls = { ca: pem("ca1-cert.pem"), ...identity };

// `peerCN` is what the server learned about the client's certificate.
// `clientHelloBytes` is the size of the client's first TLS record and
// `clientTlsBytes` every TLS byte the client sent, both counted by a plain
// TCP relay in front of the server. A client that aborts on the server's
// chain sends nothing after the ClientHello, so the two are equal. That holds
// whether or not the server's handshake completes, so it does not depend on
// the `secure` event. `closed` resolves once the server's TLS socket is gone,
// so the values are final.
type Seen = {
  peerCN: string | null;
  clientHelloBytes: number;
  clientTlsBytes: number;
  closed: Promise<void>;
};

// `plain` runs the protocol's cleartext prelude on the raw socket and resolves
// with the number of cleartext bytes the client sent before TLS starts.
// `pipe` makes the relay listen on that Windows named pipe, not on a TCP port.
// `identity` replaces the self-signed harness certificate the server presents.
async function mtlsServer(opts: {
  plain?: (socket: net.Socket) => Promise<number>;
  onSecure?: (socket: tls.TLSSocket) => void;
  maxVersion?: tls.SecureVersion;
  pipe?: string;
  identity?: { cert: string; key: string };
}) {
  const closed = Promise.withResolvers<void>();
  const seen: Seen = { peerCN: null, clientHelloBytes: 0, clientTlsBytes: 0, closed: closed.promise };
  let fromClient = Buffer.alloc(0);
  const backend = await listeningServer(async raw => {
    raw.on("error", () => {});
    const preludeBytes = opts.plain ? await opts.plain(raw) : 0;
    const secure = new tls.TLSSocket(raw, {
      isServer: true,
      cert: opts.identity?.cert ?? serverCert,
      key: opts.identity?.key ?? serverKey,
      ca: untrustedCA,
      requestCert: true,
      rejectUnauthorized: false,
      maxVersion: opts.maxVersion,
    });
    secure.on("error", () => {});
    secure.on("close", () => {
      // Every byte the client sent reached the relay before the FIN that
      // closed this socket.
      seen.clientTlsBytes = fromClient.length - preludeBytes;
      seen.clientHelloBytes = 5 + fromClient.readUInt16BE(preludeBytes + 3);
      // A paused, unshifted raw socket (the MySQL prelude) is not destroyed
      // with its TLS wrapper, and server.close() would wait for it.
      raw.destroy();
      closed.resolve();
    });
    secure.on("secure", () => {
      const peer = secure.getPeerCertificate();
      seen.peerCN = peer?.subject?.CN ?? "(none)";
      opts.onSecure?.(secure);
    });
  });
  // The relay counts the client's bytes independently of the TLS engine.
  const onRelayClient = (client: net.Socket) => {
    const upstream = net.connect(backend.port, "127.0.0.1");
    client.on("error", () => {});
    upstream.on("error", () => {});
    client.on("data", chunk => {
      fromClient = Buffer.concat([fromClient, chunk]);
      upstream.write(chunk);
    });
    upstream.on("data", chunk => client.write(chunk));
    client.on("end", () => upstream.end());
    upstream.on("end", () => client.end());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  };
  const relay = opts.pipe
    ? await new Promise<{ port: number; server: net.Server }>(resolve => {
        const server = net.createServer(onRelayClient);
        server.listen(opts.pipe, () => resolve({ port: 0, server }));
      })
    : await listeningServer(onRelayClient);
  return {
    port: relay.port,
    seen,
    [Symbol.asyncDispose]: async () => {
      await new Promise<void>(r => relay.server.close(() => r()));
      await new Promise<void>(r => backend.server.close(() => r()));
    },
  };
}

const httpOk = (socket: tls.TLSSocket) =>
  socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"));

// The handshake is all this test needs: drop the connection once it is done.
// Not inside 'secure': a TLS 1.2 server has not sent its Finished there yet,
// and a destroy() in that callback turns the client down.
const dropAfterHandshake = (socket: tls.TLSSocket) => setImmediate(() => socket.destroy());

// Postgres: answer the 8-byte SSLRequest with "S", then TLS starts.
const postgresPrelude = (socket: net.Socket) =>
  new Promise<number>(resolve =>
    socket.once("data", () => {
      socket.write(pgSSLResponse("S"));
      resolve(8);
    }),
  );

// MySQL: send a HandshakeV10 that offers CLIENT_SSL, read the SSLRequest
// packet, then TLS starts. The ClientHello follows the packet at once, so
// hand any bytes past it to the TLS engine.
const mysqlPrelude = (socket: net.Socket) =>
  new Promise<number>(resolve => {
    socket.write(
      mysqlHandshakeV10({
        capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_LONG_PASSWORD | MYSQL_CLIENT_SSL,
      }),
    );
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
      if (buffered.length < 4 + length) return;
      socket.removeListener("data", onData);
      socket.pause();
      const leftover = buffered.subarray(4 + length);
      if (leftover.length) socket.unshift(leftover);
      resolve(4 + length);
    };
    socket.on("data", onData);
  });

const sqlAdapters = [
  ["postgres", postgresPrelude],
  ["mysql", mysqlPrelude],
] as const;

const settle = <T>(p: Promise<T>) =>
  p.then(
    () => null,
    (e: any) => e,
  );

// The CONNECT proxy dials the host the client names, and the relay listens on
// 127.0.0.1 only, so a proxied client targets 127.0.0.1 (it is in the harness
// certificate's SANs).
const websocketOutcome = (port: number, tlsOpts: object, proxy?: string) =>
  new Promise<string>(resolve => {
    const ws = new WebSocket(`wss://${proxy ? "127.0.0.1" : "localhost"}:${port}/`, { tls: tlsOpts, proxy } as any);
    ws.onopen = () => resolve("open");
    ws.onerror = () => resolve("error");
    ws.onclose = () => resolve("close");
  });

// Resolves with the TLS socket's error, or with null once the server ends the
// connection without one.
const tlsOutcome = (socket: tls.TLSSocket) =>
  new Promise<any>(resolve => {
    socket.on("error", resolve);
    socket.on("end", () => {
      socket.destroy();
      resolve(null);
    });
  });

// Resolves with the error the `handshake` callback got, or with null for an
// authorized handshake. `target` is a TCP port, or the path of a Windows named
// pipe. `upgrade` connects in plain TCP first and starts TLS with
// socket.upgradeTLS(). `onOpen` runs in the TLS socket's `open` callback,
// before the handshake. `onHandshake` runs first in its `handshake` callback.
const bunConnectOutcome = (
  target: number | string,
  tlsOpts: object,
  {
    upgrade = false,
    onOpen,
    onHandshake,
  }: { upgrade?: boolean; onOpen?: (socket: any) => void; onHandshake?: (socket: any) => void } = {},
) =>
  new Promise<any>(resolve => {
    const tlsHandlers = {
      open: (socket: any) => onOpen?.(socket),
      handshake(socket: any, authorized: boolean, error: Error | null) {
        onHandshake?.(socket);
        resolve(error ?? (authorized ? null : new Error("not authorized, and no error")));
        socket.end();
      },
      data() {},
      error: (_socket: any, error: Error) => resolve(error),
      connectError: (_socket: any, error: Error) => resolve(error),
    };
    Bun.connect({
      ...(typeof target === "string" ? { unix: target } : { hostname: "localhost", port: target }),
      ...(upgrade
        ? {
            socket: {
              ...tlsHandlers,
              handshake: undefined,
              open: (raw: any) => void raw.upgradeTLS({ tls: tlsOpts, socket: tlsHandlers }),
            },
          }
        : { tls: tlsOpts, socket: tlsHandlers }),
    } as any).catch(resolve);
  });

// tls.connect over a generic Duplex: the ciphertext moves through JS, here to
// a TCP socket into the relay.
function tlsOverDuplex(port: number, tlsOpts: object) {
  const raw = net.connect(port, "127.0.0.1");
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
  return tlsOutcome(tls.connect({ socket: duplex, servername: "localhost", ...tlsOpts }));
}

// Windows only: tls.connect({ path }) over a named pipe runs TLS in SSLWrapper too.
const pipeName = () => `\\\\.\\pipe\\bun-tls-reject-${randomUUID()}`;
const tlsOverPipe = (path: string, tlsOpts: object) =>
  tlsOutcome(tls.connect({ path, servername: "localhost", ...tlsOpts }));

async function sqlError(url: string, options: object) {
  const sql = new SQL({ url, max: 1, ...options });
  const err = await settle(sql`SELECT 1`);
  await sql.close();
  return err;
}

// Bun.SQL reads sslmode from the URL. An `sslmode` option key is ignored.
const sqlUrl = (adapter: string, host: string, port: number, sslmode: string) =>
  `${adapter}://user:pass@${host}:${port}/db?sslmode=${sslmode}`;

// A connection dropped after the handshake is retried, so the query never
// settles on its own. Wait for the first handshake, then close the pool.
async function sqlHandshakeOnly(url: string, options: object, closed: Promise<void>) {
  const sql = new SQL({ url, max: 1, ...options });
  const query = settle(sql`SELECT 1`);
  await closed;
  await sql.close();
  await query;
}

// In TLS 1.3 the client's Certificate follows the server's Finished, so the
// read loop suppresses it. In TLS 1.2 the client writes it first and the
// parked-write retry catches it. Both paths must keep it off the wire.
// SSLWrapper queues both in a memory BIO and must drop that queue: before the
// check it flushed the TLS 1.2 flight while it waited for the server's Finished.
describe.each(["TLSv1.3", "TLSv1.2"] as const)(
  "%s: a rejecting client sends no client certificate to a server whose chain fails",
  maxVersion => {
    test("control: with the right CA the server does see the client certificate", async () => {
      await using srv = await mtlsServer({ onSecure: httpOk, maxVersion });
      const res = await fetch(`https://localhost:${srv.port}/`, { tls: { ...mtls, ca: trustedCA } });
      expect(await res.text()).toBe("ok");
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("fetch", async () => {
      await using srv = await mtlsServer({ onSecure: httpOk, maxVersion });
      const err = await settle(fetch(`https://localhost:${srv.port}/`, { tls: mtls }));
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("fetch with the default trust store (no ca)", async () => {
      await using srv = await mtlsServer({ onSecure: httpOk, maxVersion });
      const err = await settle(fetch(`https://localhost:${srv.port}/`, { tls: identity }));
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("WebSocket", async () => {
      await using srv = await mtlsServer({ maxVersion });
      expect(await websocketOutcome(srv.port, mtls)).toBe("error");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.RedisClient", async () => {
      await using srv = await mtlsServer({ maxVersion });
      const client = new RedisClient(`rediss://localhost:${srv.port}`, { tls: mtls, maxRetries: 0 } as any);
      const err = await settle(client.connect());
      // connect() settles from the close event, not from the handshake verdict.
      expect(err?.code).toBe("ERR_REDIS_CONNECTION_CLOSED");
      client.close();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.SQL postgres sslmode=verify-full", async () => {
      await using srv = await mtlsServer({ plain: postgresPrelude, maxVersion });
      const err = await sqlError(sqlUrl("postgres", "localhost", srv.port, "verify-full"), { tls: mtls });
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.SQL mysql sslmode=verify-full", async () => {
      await using srv = await mtlsServer({ plain: mysqlPrelude, maxVersion });
      const err = await sqlError(sqlUrl("mysql", "localhost", srv.port, "verify-full"), { tls: mtls });
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // The SSLWrapper clients. `proxy.requests` shows the request did go
    // through the tunnel, so the inner TLS did run in the wrapper.
    test("control: through a CONNECT proxy with the right CA the server does see the client certificate", async () => {
      await using srv = await mtlsServer({ onSecure: httpOk, maxVersion });
      using proxy = await startRecordingProxy();
      const res = await fetch(`https://127.0.0.1:${srv.port}/`, {
        tls: { ...mtls, ca: trustedCA },
        proxy: `http://127.0.0.1:${proxy.port}`,
      });
      expect(await res.text()).toBe("ok");
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("fetch through a CONNECT proxy", async () => {
      await using srv = await mtlsServer({ onSecure: httpOk, maxVersion });
      using proxy = await startRecordingProxy();
      const err = await settle(
        fetch(`https://127.0.0.1:${srv.port}/`, { tls: mtls, proxy: `http://127.0.0.1:${proxy.port}` }),
      );
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // The server drops the connection after the handshake, so the WebSocket
    // upgrade fails. The handshake is what this row checks.
    test("control: WebSocket through a CONNECT proxy with the right CA completes the handshake", async () => {
      await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion });
      using proxy = await startRecordingProxy();
      await websocketOutcome(srv.port, { ...mtls, ca: trustedCA }, `http://127.0.0.1:${proxy.port}`);
      await srv.seen.closed;
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("WebSocket through a CONNECT proxy", async () => {
      await using srv = await mtlsServer({ maxVersion });
      using proxy = await startRecordingProxy();
      expect(await websocketOutcome(srv.port, mtls, `http://127.0.0.1:${proxy.port}`)).toBe("error");
      await srv.seen.closed;
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("control: over a Duplex with the right CA the server does see the client certificate", async () => {
      await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion });
      await tlsOverDuplex(srv.port, { ...mtls, ca: trustedCA });
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("tls.connect over a Duplex", async () => {
      await using srv = await mtlsServer({ maxVersion });
      const err = await tlsOverDuplex(srv.port, mtls);
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test.skipIf(!isWindows)(
      "control: over a named pipe with the right CA the server does see the client certificate",
      async () => {
        const pipe = pipeName();
        await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion, pipe });
        await tlsOverPipe(pipe, { ...mtls, ca: trustedCA });
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBe("agent3");
      },
    );

    test.skipIf(!isWindows)("tls.connect over a named pipe", async () => {
      const pipe = pipeName();
      await using srv = await mtlsServer({ maxVersion, pipe });
      const err = await tlsOverPipe(pipe, mtls);
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });
  },
);

// These clients match the server's name with the native checkServerIdentity
// port. They run it inside the handshake, right before their Certificate
// message is built (TLS 1.2: after ServerHelloDone, TLS 1.3: after the
// server's Finished), so it does not depend on the TLS version.
describe.each(["TLSv1.3", "TLSv1.2"] as const)(
  "%s: a rejecting client sends no client certificate to a server whose certificate names another host",
  maxVersion => {
    test("control: under the name the certificate carries the server does see the client certificate", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      const res = await fetch(`https://localhost:${srv.port}/`, { tls: { ...otherHostMtls, serverName: "agent1" } });
      expect(await res.text()).toBe("ok");
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("fetch", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      const err = await settle(fetch(`https://localhost:${srv.port}/`, { tls: otherHostMtls }));
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("WebSocket", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      expect(await websocketOutcome(srv.port, otherHostMtls)).toBe("error");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.connect", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      let fromGetter: any;
      const err = await bunConnectOutcome(srv.port, otherHostMtls, {
        onHandshake: socket => (fromGetter = socket.getAuthorizationError()),
      });
      // The error of the check after the handshake, which a server that asks
      // for no certificate still gets. The getter agrees with the callback.
      const expected = {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        message: "Hostname/IP does not match certificate's altnames: Host: localhost. is not cert's CN: agent1",
      };
      expect({ code: err?.code, message: err?.message }).toEqual(expected);
      expect({ code: fromGetter?.code, message: fromGetter?.message }).toEqual(expected);
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("socket.upgradeTLS", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      const err = await bunConnectOutcome(srv.port, otherHostMtls, { upgrade: true });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("control: Bun.connect under the name the certificate carries completes the handshake", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion });
      expect(await bunConnectOutcome(srv.port, { ...otherHostMtls, serverName: "agent1" })).toBeNull();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("Bun.RedisClient", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      const client = new RedisClient(`rediss://localhost:${srv.port}`, { tls: otherHostMtls, maxRetries: 0 } as any);
      const [err, commandErr] = await Promise.all([settle(client.connect()), settle(client.send("PING", []))]);
      // connect() settles from the close event. The handshake verdict goes to
      // the queued commands, and it is the one of the check after the handshake.
      expect(err?.code).toBe("ERR_REDIS_CONNECTION_CLOSED");
      expect({ code: commandErr?.code, message: commandErr?.message }).toEqual({
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        message: "Hostname/IP does not match certificate's altnames: Host: localhost",
      });
      client.close();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.SQL postgres sslmode=verify-full", async () => {
      await using srv = await mtlsServer({ identity: otherHost, plain: postgresPrelude, maxVersion });
      const err = await sqlError(sqlUrl("postgres", "localhost", srv.port, "verify-full"), { tls: otherHostMtls });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.SQL mysql sslmode=verify-full", async () => {
      await using srv = await mtlsServer({ identity: otherHost, plain: mysqlPrelude, maxVersion });
      const err = await sqlError(sqlUrl("mysql", "localhost", srv.port, "verify-full"), { tls: otherHostMtls });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("fetch through a CONNECT proxy", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      using proxy = await startRecordingProxy();
      const err = await settle(
        fetch(`https://127.0.0.1:${srv.port}/`, { tls: otherHostMtls, proxy: `http://127.0.0.1:${proxy.port}` }),
      );
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("WebSocket through a CONNECT proxy", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      using proxy = await startRecordingProxy();
      expect(await websocketOutcome(srv.port, otherHostMtls, `http://127.0.0.1:${proxy.port}`)).toBe("error");
      await srv.seen.closed;
      expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // Windows only: Bun.connect over a named pipe runs TLS in SSLWrapper too,
    // and matches the name against "localhost" unless tls.serverName is set.
    test.skipIf(!isWindows)(
      "control: Bun.connect over a named pipe under the name the certificate carries completes the handshake",
      async () => {
        const pipe = pipeName();
        await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion, pipe });
        expect(await bunConnectOutcome(pipe, { ...otherHostMtls, serverName: "agent1" })).toBeNull();
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBe("agent3");
      },
    );

    test.skipIf(!isWindows)("Bun.connect over a named pipe", async () => {
      const pipe = pipeName();
      await using srv = await mtlsServer({ identity: otherHost, maxVersion, pipe });
      let fromGetter: any;
      const err = await bunConnectOutcome(pipe, otherHostMtls, {
        onHandshake: socket => (fromGetter = socket.getAuthorizationError()),
      });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      expect({ code: fromGetter?.code, message: fromGetter?.message }).toEqual({
        code: err.code,
        message: err.message,
      });
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // The name check is a step of certificate verification: it does not depend on a client certificate.
    test("a client with no certificate rejects inside the handshake too", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      const err = await settle(fetch(`https://localhost:${srv.port}/`, { tls: { ca: otherHostMtls.ca } }));
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // A checkServerIdentity function owns the verdict, and it can accept a
    // name the native matcher rejects. The in-handshake check must stay out.
    test("fetch with a checkServerIdentity that accepts the name still completes the request", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      const res = await fetch(`https://localhost:${srv.port}/`, {
        tls: { ...otherHostMtls, checkServerIdentity: () => undefined },
      });
      expect(await res.text()).toBe("ok");
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("fetch rejectUnauthorized: false still completes the request", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      const res = await fetch(`https://localhost:${srv.port}/`, {
        tls: { ...otherHostMtls, rejectUnauthorized: false },
      });
      expect(await res.text()).toBe("ok");
      expect(srv.seen.peerCN).toBe("agent3");
    });

    // The in-handshake check must accept what the check after the handshake
    // accepts. One accepting row for each client that installs it.
    test("control: WebSocket under the name the certificate carries completes the handshake", async () => {
      await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion });
      await websocketOutcome(srv.port, { ...mtls, ca: trustedCA });
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("control: Bun.RedisClient under the name the certificate carries completes the handshake", async () => {
      await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion });
      const client = new RedisClient(`rediss://localhost:${srv.port}`, {
        tls: { ...mtls, ca: trustedCA },
        maxRetries: 0,
      } as any);
      await settle(client.connect());
      client.close();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test.each(sqlAdapters)(
      "control: Bun.SQL %s sslmode=verify-full under the name the certificate carries completes the handshake",
      async (adapter, prelude) => {
        await using srv = await mtlsServer({
          identity: otherHost,
          plain: prelude,
          onSecure: dropAfterHandshake,
          maxVersion,
        });
        await sqlHandshakeOnly(
          sqlUrl(adapter, "localhost", srv.port, "verify-full"),
          { tls: { ...otherHostMtls, serverName: "agent1" } },
          srv.seen.closed,
        );
        expect(srv.seen.peerCN).toBe("agent3");
      },
    );

    test("control: socket.upgradeTLS under the name the certificate carries completes the handshake", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion });
      expect(
        await bunConnectOutcome(srv.port, { ...otherHostMtls, serverName: "agent1" }, { upgrade: true }),
      ).toBeNull();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    // An IP host sends no SNI, and the name to match is still the host.
    test.each(sqlAdapters)("Bun.SQL %s sslmode=verify-full to an IP address", async (adapter, prelude) => {
      await using srv = await mtlsServer({ identity: otherHost, plain: prelude, maxVersion });
      const err = await sqlError(sqlUrl(adapter, "127.0.0.1", srv.port, "verify-full"), { tls: otherHostMtls });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // Each of these configurations keeps the name out of the verdict, so the
    // in-handshake check must stay out too.
    test("Bun.connect rejectUnauthorized: false still completes the handshake", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion });
      const err = await bunConnectOutcome(srv.port, { ...otherHostMtls, rejectUnauthorized: false });
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test.each(sqlAdapters)("Bun.SQL %s sslmode=verify-ca still completes the handshake", async (adapter, prelude) => {
      await using srv = await mtlsServer({
        identity: otherHost,
        plain: prelude,
        onSecure: dropAfterHandshake,
        maxVersion,
      });
      await sqlHandshakeOnly(
        sqlUrl(adapter, "localhost", srv.port, "verify-ca"),
        { tls: otherHostMtls },
        srv.seen.closed,
      );
      expect(srv.seen.peerCN).toBe("agent3");
    });

    test("fetch through a CONNECT proxy with a checkServerIdentity that accepts the name still completes the request", async () => {
      await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
      using proxy = await startRecordingProxy();
      const res = await fetch(`https://127.0.0.1:${srv.port}/`, {
        tls: { ...otherHostMtls, checkServerIdentity: () => undefined },
        proxy: `http://127.0.0.1:${proxy.port}`,
      });
      expect(await res.text()).toBe("ok");
      expect(srv.seen.peerCN).toBe("agent3");
    });

    // A TLS unix socket has no host name, and the client matches none.
    test.skipIf(isWindows)("Bun.RedisClient over a TLS unix socket still completes the handshake", async () => {
      using dir = tempDir("tls-reject-redis-unix", {});
      const path = join(String(dir), "redis.sock");
      await using srv = await mtlsServer({
        identity: otherHost,
        onSecure: dropAfterHandshake,
        maxVersion,
        pipe: path,
      });
      const client = new RedisClient(`redis+tls+unix://${path}`, { tls: otherHostMtls, maxRetries: 0 } as any);
      await settle(client.connect());
      client.close();
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBe("agent3");
    });

    // The outer socket to an https:// proxy. Its name is always matched
    // natively: a checkServerIdentity function is for the target only.
    test.each([
      ["", {}],
      [" and a checkServerIdentity function", { checkServerIdentity: () => undefined }],
    ])("fetch through an https:// proxy whose certificate names another host%s", async (_label, extra) => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      const err = await settle(
        fetch("https://target.invalid/", {
          tls: { ...otherHostMtls, ...extra },
          proxy: `https://localhost:${srv.port}`,
        }),
      );
      expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("WebSocket through an https:// proxy whose certificate names another host", async () => {
      await using srv = await mtlsServer({ identity: otherHost, maxVersion });
      expect(await websocketOutcome(1, otherHostMtls, `https://localhost:${srv.port}`)).toBe("error");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    // The name to match there is the proxy's, not the target's.
    test("control: fetch through an https:// proxy under the name its certificate carries completes the handshake", async () => {
      const refuse = (socket: tls.TLSSocket) =>
        socket.on("data", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"));
      await using srv = await mtlsServer({ onSecure: refuse, maxVersion });
      await settle(
        fetch("https://target.invalid/", { tls: { ...mtls, ca: trustedCA }, proxy: `https://localhost:${srv.port}` }),
      );
      await srv.seen.closed;
      expect(srv.seen.clientTlsBytes).toBeGreaterThan(srv.seen.clientHelloBytes);
    });

    // setVerifyMode(), setServername() and setKeyCert() change what the check
    // after the handshake decides, or what there is to withhold. The
    // in-handshake check follows them.
    describe("a Bun.connect socket changed in its open callback", () => {
      test("setVerifyMode(false, false) still completes the handshake", async () => {
        await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion });
        const err = await bunConnectOutcome(srv.port, otherHostMtls, {
          onOpen: socket => socket.setVerifyMode(false, false),
        });
        expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBe("agent3");
      });

      test("setVerifyMode(false, false) and the right setServername() authorize the server", async () => {
        await using srv = await mtlsServer({ identity: otherHost, onSecure: dropAfterHandshake, maxVersion });
        const err = await bunConnectOutcome(srv.port, otherHostMtls, {
          onOpen: socket => {
            socket.setVerifyMode(false, false);
            socket.setServername("agent1");
          },
        });
        expect(err).toBeNull();
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBe("agent3");
      });

      test("setVerifyMode(true, true) sends no client certificate", async () => {
        await using srv = await mtlsServer({ identity: otherHost, maxVersion });
        const err = await bunConnectOutcome(
          srv.port,
          { ...otherHostMtls, rejectUnauthorized: false },
          { onOpen: socket => socket.setVerifyMode(true, true) },
        );
        expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBeNull();
        expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
      });

      // Rejection turned on after connect covers the chain as well as the name.
      test("setVerifyMode(false, true) sends no client certificate to a server whose chain fails", async () => {
        await using srv = await mtlsServer({ maxVersion });
        const err = await bunConnectOutcome(
          srv.port,
          { ...mtls, rejectUnauthorized: false },
          { onOpen: socket => socket.setVerifyMode(false, true) },
        );
        expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBeNull();
        expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
      });

      // The client certificate arrives after the check was set up without one.
      test("setKeyCert() sends no client certificate", async () => {
        await using srv = await mtlsServer({ identity: otherHost, maxVersion });
        const withCertificate = tls.createSecureContext({ ca: otherHostMtls.ca, ...identity }) as any;
        const err = await bunConnectOutcome(
          srv.port,
          { ca: otherHostMtls.ca },
          { onOpen: socket => socket.setKeyCert(withCertificate.context) },
        );
        expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBeNull();
        expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
      });

      // An empty server name moves the name to match back to the host.
      test('setServername("") after the right serverName sends no client certificate', async () => {
        await using srv = await mtlsServer({ identity: otherHost, maxVersion });
        const err = await bunConnectOutcome(
          srv.port,
          { ...otherHostMtls, serverName: "agent1" },
          { onOpen: socket => socket.setServername("") },
        );
        expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBeNull();
        expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
      });

      test('setServername("") after a wrong serverName authorizes the server', async () => {
        await using srv = await mtlsServer({ onSecure: dropAfterHandshake, maxVersion });
        const err = await bunConnectOutcome(
          srv.port,
          { ...mtls, ca: trustedCA, serverName: "another-host.test" },
          { onOpen: socket => socket.setServername("") },
        );
        expect(err).toBeNull();
        await srv.seen.closed;
        expect(srv.seen.peerCN).toBe("agent3");
      });
    });
  },
);

// node:tls decides the name in JS, in the handshake callback. Under TLS 1.3
// the client's final flight, with its certificate, is still held at that
// point, and the destroy() of the refusal drops it. Under TLS 1.2 the
// certificate leaves before the server's Finished, in node too.
// node-tls-connect.test.ts runs every route in node as well.
describe("TLSv1.3: a node:tls client sends no client certificate to a server whose certificate names another host", () => {
  const maxVersion = "TLSv1.3";

  test("tls.connect", async () => {
    await using srv = await mtlsServer({ identity: otherHost, maxVersion });
    const err = await tlsOutcome(tls.connect({ host: "localhost", port: srv.port, ...otherHostMtls }));
    expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBeNull();
    expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
  });

  test("tls.connect with a checkServerIdentity function that returns an Error", async () => {
    await using srv = await mtlsServer({ identity: otherHost, maxVersion });
    const checkServerIdentity = () => Object.assign(new Error("not the pinned key"), { code: "ERR_PINNED_KEY" });
    const err = await tlsOutcome(
      tls.connect({ host: "localhost", port: srv.port, servername: "agent1", ...otherHostMtls, checkServerIdentity }),
    );
    expect(err?.code).toBe("ERR_PINNED_KEY");
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBeNull();
    expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
  });

  test("https.request", async () => {
    await using srv = await mtlsServer({ identity: otherHost, onSecure: httpOk, maxVersion });
    const err = await new Promise<any>(resolve =>
      https
        .request({ host: "localhost", port: srv.port, agent: false, ...otherHostMtls }, () => resolve(null))
        .on("error", resolve)
        .end(),
    );
    expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBeNull();
    expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
  });
});

// The inline reject is installed only when the client's policy rejects a bad
// chain. A client that accepts one must still complete the handshake, and
// the server then sees the client certificate as before.
describe("a client that accepts a bad chain still completes the handshake", () => {
  test("fetch rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    await settle(fetch(`https://localhost:${srv.port}/`, { tls: { ...mtls, rejectUnauthorized: false } }));
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("WebSocket rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    await websocketOutcome(srv.port, { ...mtls, rejectUnauthorized: false });
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("fetch through a CONNECT proxy rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    using proxy = await startRecordingProxy();
    await settle(
      fetch(`https://127.0.0.1:${srv.port}/`, {
        tls: { ...mtls, rejectUnauthorized: false },
        proxy: `http://127.0.0.1:${proxy.port}`,
      }),
    );
    await srv.seen.closed;
    expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("WebSocket through a CONNECT proxy rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    using proxy = await startRecordingProxy();
    await websocketOutcome(srv.port, { ...mtls, rejectUnauthorized: false }, `http://127.0.0.1:${proxy.port}`);
    await srv.seen.closed;
    expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT 127.0.0.1:${srv.port} HTTP/1.1`]);
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("tls.connect over a Duplex rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    await tlsOverDuplex(srv.port, { ...mtls, rejectUnauthorized: false });
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test.skipIf(!isWindows)("tls.connect over a named pipe rejectUnauthorized: false", async () => {
    const pipe = pipeName();
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake, pipe });
    await tlsOverPipe(pipe, { ...mtls, rejectUnauthorized: false });
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("Bun.RedisClient rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ onSecure: dropAfterHandshake });
    const client = new RedisClient(`rediss://localhost:${srv.port}`, {
      tls: { ...mtls, rejectUnauthorized: false },
      maxRetries: 0,
    } as any);
    await settle(client.connect());
    client.close();
    await srv.seen.closed;
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test.each(sqlAdapters)("Bun.SQL %s sslmode=require", async (adapter, prelude) => {
    await using srv = await mtlsServer({ plain: prelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(sqlUrl(adapter, "localhost", srv.port, "require"), { tls: identity }, srv.seen.closed);
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test.each(sqlAdapters)("Bun.SQL %s sslmode=verify-full rejectUnauthorized: false", async (adapter, prelude) => {
    await using srv = await mtlsServer({ plain: prelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(
      sqlUrl(adapter, "localhost", srv.port, "verify-full"),
      { tls: { ...mtls, rejectUnauthorized: false } },
      srv.seen.closed,
    );
    expect(srv.seen.peerCN).toBe("agent3");
  });
});
