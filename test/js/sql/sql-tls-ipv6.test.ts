// Bun.SQL takes its TLS name from the URL host, and the URL parser keeps the
// brackets of an IPv6 literal. The text "[::1]" went out as SNI and was matched
// against the certificate as a DNS name, so `sslmode=verify-full` refused a
// certificate for `IP:::1` and accepted one for `DNS:[::1]`. Same class as
// https://github.com/oven-sh/bun/issues/30668 (fetch, WebSocket).
//
// This needs a server that presents a certificate of the test's choosing and
// reports the SNI it received, which the shared containers cannot do, so both
// adapters talk to a minimal mock that upgrades to TLS and accepts the login.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isIPv6, tls as localhostTls } from "harness";
import type net from "node:net";
import tls from "node:tls";
import {
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

type ServerCert = { key: string; cert: string };

// The harness certificate: SAN DNS:localhost, IP:127.0.0.1, IP:::1. Self-signed, so it is its own CA.
const ipSan: ServerCert = localhostTls;

// The only name on this one is the DNS name "[::1]". Self-signed, so it is its own CA.
// openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key.pem -out cert.pem \
//   -subj "/CN=bracketed-ipv6-dns-name" -addext "subjectAltName = DNS:[::1]" -days 3650
const bracketedDnsSan: ServerCert = {
  cert: `-----BEGIN CERTIFICATE-----
MIIBqzCCAVGgAwIBAgIUHiIyPpuHlq0jpxutr3efwHgrYUgwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXYnJhY2tldGVkLWlwdjYtZG5zLW5hbWUwHhcNMjYwOTE1MDEy
NjMwWhcNMzYwOTEyMDEyNjMwWjAiMSAwHgYDVQQDDBdicmFja2V0ZWQtaXB2Ni1k
bnMtbmFtZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABLZVM0RGVYGVBM5SrFr7
H0HAcXLOyu61mT3sEPeHfAvBl/AP/+S57S9p3DYua1IJKQ3/fT97ZqG7HLx+NHqH
dFijZTBjMB0GA1UdDgQWBBQQ6LAnTRx3lBmHwsLdSJYaAKNuyDAfBgNVHSMEGDAW
gBQQ6LAnTRx3lBmHwsLdSJYaAKNuyDAPBgNVHRMBAf8EBTADAQH/MBAGA1UdEQQJ
MAeCBVs6OjFdMAoGCCqGSM49BAMCA0gAMEUCICX/2lVQin991IzyTNw//XQQHPil
RS67icIxyza9l1vSAiEA1TTwPyeQG+Ms+4398ww2rb3TCxwWxWZ0eS97S/NhDuY=
-----END CERTIFICATE-----`,
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg69l4/uau7wgldkMU
rdn4+kz+gaJJ9Q6gWhjr23NHUbKhRANCAAS2VTNERlWBlQTOUqxa+x9BwHFyzsru
tZk97BD3h3wLwZfwD//kue0vadw2LmtSCSkN/30/e2ahuxy8fjR6h3RY
-----END PRIVATE KEY-----`,
};

/** What the server saw of the first connection. */
type Seen = {
  /** SNI of the ClientHello, `false` for none, `null` if the TLS handshake did not complete. */
  servername: string | false | null;
  /** The client went on to send its first packet inside TLS. */
  loggedIn: boolean;
};
type MockServer = { port: number; seen: Promise<Seen> } & AsyncDisposable;

/**
 * Wraps `rawSocket` in a server-side TLSSocket once the plaintext prelude is
 * done. Bytes already buffered past the prelude are TLS records: hand them to
 * the TLS engine instead of the plaintext parser.
 */
function upgrade(rawSocket: net.Socket, cert: ServerCert, leftover: Buffer, seen: Seen) {
  rawSocket.pause();
  if (leftover.length) rawSocket.unshift(leftover);
  const socket = new tls.TLSSocket(rawSocket, { isServer: true, ...cert });
  socket.on("secure", () => (seen.servername = socket.servername || false));
  socket.on("error", () => {});
  return socket;
}

async function mockServer(
  host: string,
  onConnection: (rawSocket: net.Socket, seen: Seen) => void,
): Promise<MockServer> {
  const closed = Promise.withResolvers<Seen>();
  const { server, port } = await listeningServer(rawSocket => {
    const seen: Seen = { servername: null, loggedIn: false };
    rawSocket.on("error", () => {});
    rawSocket.on("close", () => closed.resolve(seen));
    onConnection(rawSocket, seen);
  }, host);
  return {
    port,
    seen: closed.promise,
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/** Answers SSLRequest with 'S', upgrades, then accepts any StartupMessage. */
function postgresServer(cert: ServerCert, host: string): Promise<MockServer> {
  return mockServer(host, (rawSocket, seen) => {
    // SSLRequest is Int32(8) Int32(80877103); the client sends nothing else
    // until it has the one-byte answer.
    rawSocket.once("data", (chunk: Buffer) => {
      rawSocket.write(pgSSLResponse("S"));
      const socket = upgrade(rawSocket, cert, chunk.subarray(8), seen);
      socket.once("data", () => {
        seen.loggedIn = true;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      });
    });
  });
}

/** Advertises CLIENT_SSL, upgrades after the SSLRequest packet, then accepts the login. */
function mysqlServer(cert: ServerCert, host: string): Promise<MockServer> {
  return mockServer(host, (rawSocket, seen) => {
    rawSocket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    let buffered = Buffer.alloc(0);
    const onPlainData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
      if (buffered.length < 4 + length) return;
      // The SSLRequest packet; the ClientHello may already follow it.
      const leftover = buffered.subarray(4 + length);
      buffered = Buffer.alloc(0);
      rawSocket.removeListener("data", onPlainData);
      const socket = upgrade(rawSocket, cert, leftover, seen);
      socket.on("data", (chunk: Buffer) => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!seen.loggedIn) {
            seen.loggedIn = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (!mysqlAckSessionSetup(socket, payload)) socket.end();
        });
      });
    };
    rawSocket.on("data", onPlainData);
  });
}

// The client runs in a subprocess: on a build with assertions, a refused
// certificate aborts the process (see `refusesCleanly`), and that must fail one
// test, not take the runner down.
const client = `
  await using sql = new Bun.SQL({ url: process.env.SQL_URL, tls: JSON.parse(process.env.SQL_TLS), max: 1 });
  console.log(await sql.connect().then(() => "connected", () => "refused"));
`;

async function connect(url: string, tlsOptions: Bun.TLSOptions) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", client],
    env: { ...bunEnv, SQL_URL: `${url}?sslmode=verify-full`, SQL_TLS: JSON.stringify(tlsOptions) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const connected = { stdout: "connected\n", stderr: "", exitCode: 0 };
const refused = { stdout: "refused\n", stderr: "", exitCode: 0 };

// A hostname mismatch fails with an Error whose message is empty, and
// JSC::createError asserts `!message.isEmpty()`. https://github.com/oven-sh/bun/pull/42054
// gives that Error a code and a message.
const refusesCleanly = !isDebug && !isASAN;

describe.concurrent.each([
  ["PostgreSQL", "postgres", postgresServer],
  ["MySQL", "mysql", mysqlServer],
] as const)("%s with sslmode=verify-full", (_, scheme, startServer) => {
  // Skipped on Buildkite Linux: those instances have no IPv6 (see `isIPv6` in harness.ts).
  test.skipIf(!isIPv6())("checks [::1] in the URL as an IP address and sends no SNI", async () => {
    await using server = await startServer(ipSan, "::1");
    expect(await connect(`${scheme}://u@[::1]:${server.port}/db`, { ca: ipSan.cert })).toEqual(connected);
    expect(await server.seen).toEqual({ servername: false, loggedIn: true });
  });

  test.skipIf(!isIPv6() || !refusesCleanly)("refuses a certificate for the DNS name [::1]", async () => {
    await using server = await startServer(bracketedDnsSan, "::1");
    expect(await connect(`${scheme}://u@[::1]:${server.port}/db`, { ca: bracketedDnsSan.cert })).toEqual(refused);
    expect(await server.seen).toEqual({ servername: false, loggedIn: false });
  });

  // The same two cases without IPv6 on the machine: `tls.serverName` overrides
  // the URL host as the TLS name, as it does in fetch().
  test("checks tls.serverName [::1] as an IP address and sends no SNI", async () => {
    await using server = await startServer(ipSan, "127.0.0.1");
    const options = { ca: ipSan.cert, serverName: "[::1]" };
    expect(await connect(`${scheme}://u@127.0.0.1:${server.port}/db`, options)).toEqual(connected);
    expect(await server.seen).toEqual({ servername: false, loggedIn: true });
  });

  test.skipIf(!refusesCleanly)("refuses a certificate for the DNS name [::1] with tls.serverName [::1]", async () => {
    await using server = await startServer(bracketedDnsSan, "127.0.0.1");
    const options = { ca: bracketedDnsSan.cert, serverName: "[::1]" };
    expect(await connect(`${scheme}://u@127.0.0.1:${server.port}/db`, options)).toEqual(refused);
    expect(await server.seen).toEqual({ servername: false, loggedIn: false });
  });

  test("sends no SNI for an IPv4 literal", async () => {
    await using server = await startServer(ipSan, "127.0.0.1");
    expect(await connect(`${scheme}://u@127.0.0.1:${server.port}/db`, { ca: ipSan.cert })).toEqual(connected);
    expect(await server.seen).toEqual({ servername: false, loggedIn: true });
  });

  test("sends a DNS name as SNI", async () => {
    await using server = await startServer(ipSan, "127.0.0.1");
    expect(await connect(`${scheme}://u@localhost:${server.port}/db`, { ca: ipSan.cert })).toEqual(connected);
    expect(await server.seen).toEqual({ servername: "localhost", loggedIn: true });
  });
});
