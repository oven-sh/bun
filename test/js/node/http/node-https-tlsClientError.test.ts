// A TLS handshake that fails on an https.Server must reach JS: node's tls.Server
// emits 'tlsClientError' and https.Server mirrors it to 'clientError'. Bun's
// https.Server is backed by Bun.serve, whose uWS listener used to drop handshake
// failures on the floor, so every class below was silent.
import { expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import { constants as cryptoConstants } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import tls from "node:tls";

type Probe = (port: number) => Promise<unknown>;

// Runs `probe` against an https.Server and resolves once the server reports the
// handshake failure. Both events are recorded so their order (node emits
// 'clientError' first, from the listener https.Server installs in its
// constructor) is observable.
async function collectHandshakeFailure(serverOptions: https.ServerOptions, probe: Probe) {
  const events: string[] = [];
  const errors: (Error & { code?: string })[] = [];
  const server = https.createServer({ ...COMMON_CERT, ...serverOptions }, (_req, res) => res.end("unexpected"));
  const reported = Promise.withResolvers<void>();

  server.on("connection", () => events.push("connection"));
  server.on("clientError", (err: Error & { code?: string }, socket: net.Socket) => {
    events.push(`clientError:${err.code}`);
    socket.destroy();
  });
  server.on("tlsClientError", (err: Error & { code?: string }) => {
    events.push(`tlsClientError:${err.code}`);
    errors.push(err);
    reported.resolve();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await probe((server.address() as AddressInfo).port);
    await reported.promise;
  } finally {
    server.close();
    await once(server, "close");
  }
  return { events, errors };
}

// Writes raw (non-TLS) bytes at the TLS port, then waits for the server to hang
// up on it. Never resolves on its own, so the caller's `reported` promise is
// what actually gates the assertions.
function writeRawBytes(bytes: string | null): Probe {
  return port =>
    new Promise<void>(resolve => {
      const socket = net.connect(port, "127.0.0.1", () => {
        if (bytes === null) socket.destroy();
        else socket.write(bytes);
      });
      socket.on("error", () => {});
      socket.on("close", () => resolve());
    });
}

test("plaintext HTTP at the TLS port reports ERR_SSL_HTTP_REQUEST", async () => {
  const { events, errors } = await collectHandshakeFailure({}, writeRawBytes("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));

  expect(events).toEqual(["connection", "clientError:ERR_SSL_HTTP_REQUEST", "tlsClientError:ERR_SSL_HTTP_REQUEST"]);
  expect(errors[0].message).toContain("HTTP_REQUEST");
  // Node decomposes the OpenSSL error string the same way ThrowCryptoError does.
  expect(errors[0]).toMatchObject({ library: "SSL routines", reason: "HTTP_REQUEST" });
});

test("garbage bytes at the TLS port report ERR_SSL_WRONG_VERSION_NUMBER", async () => {
  const { events } = await collectHandshakeFailure(
    {},
    writeRawBytes("\x80\x81\x82not-tls-at-all-012345678901234567890123456789"),
  );

  expect(events).toEqual([
    "connection",
    "clientError:ERR_SSL_WRONG_VERSION_NUMBER",
    "tlsClientError:ERR_SSL_WRONG_VERSION_NUMBER",
  ]);
});

test("a client that disconnects before the handshake reports ECONNRESET", async () => {
  const { events, errors } = await collectHandshakeFailure({}, writeRawBytes(null));

  expect(events).toEqual(["connection", "clientError:ECONNRESET", "tlsClientError:ECONNRESET"]);
  expect(errors[0].message).toBe("socket hang up");
});

test("a client offering only an excluded protocol version reports ERR_SSL_UNSUPPORTED_PROTOCOL", async () => {
  const { events } = await collectHandshakeFailure(
    {
      secureOptions:
        cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1 | cryptoConstants.SSL_OP_NO_TLSv1_2,
    },
    port =>
      new Promise<void>(resolve => {
        const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, maxVersion: "TLSv1.2" });
        socket.on("error", () => resolve());
        socket.on("secureConnect", () => {
          socket.destroy();
          resolve();
        });
      }),
  );

  expect(events).toEqual([
    "connection",
    "clientError:ERR_SSL_UNSUPPORTED_PROTOCOL",
    "tlsClientError:ERR_SSL_UNSUPPORTED_PROTOCOL",
  ]);
});

test("requestCert + rejectUnauthorized reports ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE", async () => {
  const { events } = await collectHandshakeFailure(
    { requestCert: true, rejectUnauthorized: true, ca: [COMMON_CERT.cert] },
    port =>
      new Promise<void>(resolve => {
        const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        socket.on("error", () => resolve());
        socket.on("secureConnect", () => socket.write("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));
        socket.on("close", () => resolve());
      }),
  );

  expect(events).toEqual([
    "connection",
    "clientError:ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE",
    "tlsClientError:ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE",
  ]);
});

test("with no clientError listener the failed connection is destroyed", async () => {
  const server = https.createServer(COMMON_CERT, (_req, res) => res.end("unexpected"));
  const destroyed = Promise.withResolvers<boolean>();
  server.on("tlsClientError", (_err, socket: net.Socket) => {
    // The listener https.Server installs in its constructor runs first: with no
    // 'clientError' listener it destroys the socket before user listeners see it.
    destroyed.resolve(socket.destroyed);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const socket = net.connect(port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));
    socket.on("error", () => {});
    expect(await destroyed.promise).toBe(true);
    socket.destroy();
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("a TLS handshake failure still lets later connections succeed", async () => {
  const server = https.createServer(COMMON_CERT, (_req, res) => res.end("ok"));
  const reported = Promise.withResolvers<void>();
  server.on("tlsClientError", () => reported.resolve());

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const bad = net.connect(port, "127.0.0.1", () => bad.write("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));
    bad.on("error", () => {});
    await reported.promise;
    bad.destroy();

    const res = await fetch(`https://127.0.0.1:${port}/`, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("http.Server never emits tlsClientError and keeps its own clientError", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  const events: string[] = [];
  const reported = Promise.withResolvers<void>();
  server.on("tlsClientError", () => events.push("tlsClientError"));
  server.on("clientError", (err: Error & { code?: string }, socket: net.Socket) => {
    events.push(`clientError:${err.code}`);
    socket.destroy();
    reported.resolve();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const socket = net.connect(port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nBad Header\r\n\r\n"));
    socket.on("error", () => {});
    await reported.promise;
    socket.destroy();
    // No 'tlsClientError' mirror is installed on a plain http.Server, so its
    // 'clientError' fires exactly once, from the HTTP parser.
    expect(events).toEqual(["clientError:HPE_INVALID_HEADER_TOKEN"]);
  } finally {
    server.close();
    await once(server, "close");
  }
});
