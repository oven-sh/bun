// Fixture for the "TLS peer stopped responding" test in
// sql-close-pending-connection.test.ts. Every driver x trigger combination
// below runs concurrently against its own mock. Each prints one line when the
// client reports the failure and one more when the mock's TCP socket sees the
// connection go away; the process then has to exit by itself, since a
// connection the client has given up on must not keep it alive.
//
// Each mock completes the STARTTLS upgrade, takes the client's startup message
// and then stops responding for good (see startTlsServerSide), so the client's
// close_notify is never answered. The client then gives the connection up
// either because the pool is force-closed while the connection is still
// waiting for the startup reply ("close") or because what the mock answered
// was a protocol violation ("unexpected"). Both triggers happen strictly after
// the mock has stopped responding, and both go through the driver's fail(),
// the same path a connection or idle timeout takes; a timeout itself is not
// used as a trigger because on a slow debug build it can fire before the TLS
// handshake is even done, at which point there is nothing to wait for.
//
// The pools in the "unexpected" scenarios are deliberately not closed: on
// mysql a close() issued after the failure closes the socket a second time,
// which happens to complete a graceful TLS close that is still waiting for
// the peer, and would hide exactly what this fixture observes.

import { SQL } from "bun";
import type net from "node:net";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlHandshakeV10,
  mysqlRawPacket,
  pgReadyForQuery,
  pgSSLRequest,
  pgSSLResponse,
  startTlsServerSide,
} from "./wire-frames";

type Driver = "postgres" | "mysql";
type Trigger = "close" | "unexpected";

// The harness certificate for 127.0.0.1, handed over by the test: importing
// "harness" here would cost this debug-build subprocess several seconds.
const { MOCK_TLS_KEY: key, MOCK_TLS_CERT: cert } = process.env;
if (!key || !cert) throw new Error("MOCK_TLS_KEY and MOCK_TLS_CERT must be set by the test that spawns this fixture");
const tlsCredentials = { key, cert };

// Answers to the startup message that the client rejects: a ReadyForQuery before
// any Authentication message, resp. an auth reply whose header byte no auth
// packet uses.
const unexpectedReply: Record<Driver, Buffer> = {
  postgres: pgReadyForQuery(),
  mysql: mysqlRawPacket(3, Buffer.from([0x42])),
};

// Length of the plaintext the client sends before TLS once `buffered` holds all
// of it: postgres sends the 8-byte SSLRequest, mysql one packet (its SSLRequest)
// in reply to our greeting. undefined while more bytes are needed.
function preludeLength(driver: Driver, buffered: Buffer): number | undefined {
  if (driver === "postgres") {
    return buffered.length >= pgSSLRequest().length ? pgSSLRequest().length : undefined;
  }
  if (buffered.length < 4) return undefined;
  const length = 4 + (buffered[0] | (buffered[1] << 8) | (buffered[2] << 16));
  return buffered.length >= length ? length : undefined;
}

/** Resolves once the mock has taken the client's startup message and stopped responding. */
function mockThatStopsResponding(driver: Driver, trigger: Trigger, raw: net.Socket): Promise<void> {
  const stoppedResponding = Promise.withResolvers<void>();
  // Once the client closes for real, the RST it sends surfaces here.
  raw.on("error", () => {});
  if (driver === "mysql") {
    raw.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
  }
  let buffered = Buffer.alloc(0);
  const onPlaintext = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const length = preludeLength(driver, buffered);
    if (length === undefined) return;
    raw.removeListener("data", onPlaintext);
    if (driver === "postgres") raw.write(pgSSLResponse("S"));
    const peer = startTlsServerSide(raw, buffered.subarray(length), tlsCredentials);
    // The first decrypted bytes are the StartupMessage / HandshakeResponse.
    peer.secure.once("data", () => {
      peer.stopReading();
      if (trigger === "unexpected") peer.secure.write(unexpectedReply[driver]);
      stoppedResponding.resolve();
    });
  };
  raw.on("data", onPlaintext);
  return stoppedResponding.promise;
}

async function scenario(driver: Driver, trigger: Trigger) {
  const mockStoppedResponding = Promise.withResolvers<void>();
  const mockSawClose = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(raw => {
    raw.on("close", () => mockSawClose.resolve());
    mockThatStopsResponding(driver, trigger, raw).then(mockStoppedResponding.resolve);
  });
  const sql = new SQL({
    url: `${driver}://user:password@127.0.0.1:${port}/db`,
    max: 1,
    tls: { ca: tlsCredentials.cert },
  });
  const query = sql`select 1`.then(
    () => "resolved",
    (err: any) => `rejected with ${err?.code ?? err}`,
  );
  if (trigger === "close") {
    await mockStoppedResponding.promise;
    // The string form closes at once even though a query is waiting; a numeric
    // 0 currently waits for it (https://github.com/oven-sh/bun/issues/32038).
    await sql.close({ timeout: "0" });
  }
  console.log(`${driver} ${trigger}: ${await query}`);
  await mockSawClose.promise;
  console.log(`${driver} ${trigger}: the mock saw the connection close`);
  server.close();
}

await Promise.all([
  scenario("postgres", "close"),
  scenario("postgres", "unexpected"),
  scenario("mysql", "close"),
  scenario("mysql", "unexpected"),
]);
