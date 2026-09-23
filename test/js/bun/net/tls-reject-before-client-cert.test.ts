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
import { RedisClient, SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tls as harnessTls, isWindows } from "harness";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
async function mtlsServer(opts: {
  plain?: (socket: net.Socket) => Promise<number>;
  onSecure?: (socket: tls.TLSSocket) => void;
  maxVersion?: tls.SecureVersion;
  pipe?: string;
}) {
  const closed = Promise.withResolvers<void>();
  const seen: Seen = { peerCN: null, clientHelloBytes: 0, clientTlsBytes: 0, closed: closed.promise };
  let fromClient = Buffer.alloc(0);
  const backend = await listeningServer(async raw => {
    raw.on("error", () => {});
    const preludeBytes = opts.plain ? await opts.plain(raw) : 0;
    const secure = new tls.TLSSocket(raw, {
      isServer: true,
      cert: serverCert,
      key: serverKey,
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
const dropAfterHandshake = (socket: tls.TLSSocket) => socket.destroy();

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
      const err = await sqlError(`postgres://user:pass@localhost:${srv.port}/db`, {
        sslmode: "verify-full",
        tls: mtls,
      });
      expect(err?.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      await srv.seen.closed;
      expect(srv.seen.peerCN).toBeNull();
      expect(srv.seen.clientTlsBytes).toBe(srv.seen.clientHelloBytes);
    });

    test("Bun.SQL mysql sslmode=verify-full", async () => {
      await using srv = await mtlsServer({ plain: mysqlPrelude, maxVersion });
      const err = await sqlError(`mysql://user:pass@localhost:${srv.port}/db`, { sslmode: "verify-full", tls: mtls });
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

  test("Bun.SQL postgres sslmode=require", async () => {
    await using srv = await mtlsServer({ plain: postgresPrelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(
      `postgres://user:pass@localhost:${srv.port}/db`,
      { sslmode: "require", tls: identity },
      srv.seen.closed,
    );
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("Bun.SQL mysql sslmode=require", async () => {
    await using srv = await mtlsServer({ plain: mysqlPrelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(
      `mysql://user:pass@localhost:${srv.port}/db`,
      { sslmode: "require", tls: identity },
      srv.seen.closed,
    );
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("Bun.SQL postgres sslmode=verify-full rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ plain: postgresPrelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(
      `postgres://user:pass@localhost:${srv.port}/db`,
      { sslmode: "verify-full", tls: { ...mtls, rejectUnauthorized: false } },
      srv.seen.closed,
    );
    expect(srv.seen.peerCN).toBe("agent3");
  });

  test("Bun.SQL mysql sslmode=verify-full rejectUnauthorized: false", async () => {
    await using srv = await mtlsServer({ plain: mysqlPrelude, onSecure: dropAfterHandshake });
    await sqlHandshakeOnly(
      `mysql://user:pass@localhost:${srv.port}/db`,
      { sslmode: "verify-full", tls: { ...mtls, rejectUnauthorized: false } },
      srv.seen.closed,
    );
    expect(srv.seen.peerCN).toBe("agent3");
  });
});
