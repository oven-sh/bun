// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { expect, mock, test } from "bun:test";
import { isWindows } from "harness";
import type net from "node:net";
import {
  listeningServer,
  loopbackFence,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAuthSwitchRequest,
  mysqlHandshakeV10,
  mysqlOkPacket,
} from "./wire-frames";

test.each([
  ["packets", Infinity],
  ["bytes", 6],
])("MySQL TLS handshake rejects plaintext %s buffered behind the server greeting", async (_, length) => {
  // A man-in-the-middle can append forged packets (e.g. an OK packet that marks
  // the connection as authenticated) to the same TCP segment as the server
  // greeting. Once the handshake negotiates TLS, everything after the greeting
  // must arrive over the encrypted channel; bytes already buffered in plaintext
  // must not be fed to the auth/command handlers.
  const greeting = mysqlHandshakeV10({
    serverVersion: "mock-8.0.0",
    authPlugin: "caching_sha2_password",
    capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL,
  });
  // A forged OK packet. If the client keeps consuming the plaintext buffer
  // after deciding to upgrade to TLS, this marks the connection as
  // authenticated without any certificate ever being validated.
  const forgedOk = mysqlOkPacket(2).subarray(0, length);

  const { port, server } = await listeningServer(socket => {
    // Greeting and the injected packet arrive in a single segment, before the
    // client has sent a byte.
    socket.write(Buffer.concat([greeting, forgedOk]));
    // Whatever the client sends next (SSLRequest, TLS ClientHello, auth
    // response), close so a misbehaving client cannot hang waiting for more.
    socket.on("data", () => socket.end());
    socket.on("error", () => {});
  });

  const onconnect = mock();
  try {
    await using sql = new SQL({
      url: `mysql://root:pw@127.0.0.1:${port}/db`,
      max: 1,
      tls: { rejectUnauthorized: false },
      onconnect,
    });
    const err = await sql`select 1`.then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );
    // The connection must never be reported as established off the back of a
    // plaintext packet, and the buffered bytes must be rejected outright.
    expect(onconnect).not.toHaveBeenCalled();
    expect(err).toEqual({ code: "ERR_MYSQL_UNEXPECTED_PACKET" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.skipIf(!fault.available() || isWindows).each([
  ["a plaintext packet", Infinity],
  ["part of a plaintext packet", 6],
])("%s that comes while the SSLRequest waits for the socket gets no answer", async (_, length) => {
  const blockWrites = () => fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1 });
  const accepted = Promise.withResolvers<net.Socket>();
  const left = Promise.withResolvers<void>();
  let received = Buffer.alloc(0);
  const { port, server } = await listeningServer(socket => {
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      socket.end();
    });
    socket.on("close", () => left.resolve());
    socket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    blockWrites();
    accepted.resolve(socket);
  });
  try {
    await using sql = new SQL({ url: `mysql://root:pw@127.0.0.1:${port}/db?sslmode=verify-full`, max: 1 });
    const connected = sql.connect().then(
      () => "connected",
      e => e.code,
    );
    const socket = await accepted.promise;
    await loopbackFence();
    fault.clear();
    const forged = mysqlAuthSwitchRequest(2, "mysql_native_password", Buffer.from("cccccccccccccccccccc\0"));
    socket.write(forged.subarray(0, length));
    blockWrites();
    await loopbackFence();
    fault.clear();
    await left.promise;
    expect(received.toString("hex")).toBe("");
    expect(await connected).toBe("ERR_MYSQL_UNEXPECTED_PACKET");
  } finally {
    fault.clear();
    server.close();
  }
});
