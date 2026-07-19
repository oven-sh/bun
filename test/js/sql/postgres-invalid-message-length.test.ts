// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Every PostgreSQL v3 backend message carries an Int32 length that includes its
// own 4 bytes (https://www.postgresql.org/docs/current/protocol-message-formats.html),
// so a declared length below 4 is malformed and makes the stream unframeable
// (libpq treats it as a sync loss). The length is server-controlled input:
// shared servers, poolers (pgbouncer/pgcat), tunnels and sidecars all sit on
// the connection path. It must surface as ERR_POSTGRES_INVALID_MESSAGE_LENGTH
// on that connection rather than being trusted.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { listeningServer, pgAuthenticationOk, pgCString, pgRaw, pgReadyForQuery } from "./wire-frames";

// connectionTimeout (seconds) bounds the connect-retry budget; keep it short
// in tests that expect the failure to surface.

// One mock server for the file; each test sets `current` before connecting and
// the accept handler latches it per connection. A per-test server flaked on
// Windows CI with ERR_POSTGRES_CONNECTION_REFUSED (loopback SYN not retransmitted).
let current!: { atStartup: Buffer[]; atQuery?: Buffer[] };
const { port, server } = await listeningServer(socket => {
  const { atStartup, atQuery } = current;
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), ...atStartup]));
      return;
    }
    if (atQuery && data[0] === 0x51 /* 'Q' */) socket.write(Buffer.concat(atQuery));
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

/**
 * Reply to the startup packet with AuthenticationOk followed by `frames`, so
 * `frames` arrive before ReadyForQuery and connect() observes them. Returns
 * connect()'s rejection.
 */
async function connectError(frames: Buffer[]): Promise<any> {
  current = { atStartup: frames };
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1, connectionTimeout: 1 });
  try {
    await db.connect();
    throw new Error("expected connect() to reject");
  } catch (err) {
    return err;
  } finally {
    await db.close({ timeout: 0 });
  }
}

/**
 * Complete the handshake normally, then answer the first simple query with
 * `frames`, so they arrive while a request is in flight. Returns the query's
 * rejection.
 */
async function queryError(frames: Buffer[]): Promise<any> {
  current = { atStartup: [pgReadyForQuery()], atQuery: frames };
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1, connectionTimeout: 1 });
  try {
    await db`select x`.simple();
    throw new Error("expected the query to reject");
  } catch (err) {
    return err;
  } finally {
    await db.close({ timeout: 0 });
  }
}

// Each entry drives a backend-message decoder with a length field that cannot
// be valid: below the 4 bytes the field itself occupies, or negative (the
// field is a signed Int32). All of them must fail the connection with the
// same protocol error.
const malformed: { name: string; frame: Buffer }[] = [
  // ReadyForQuery is Byte1('Z') Int32(5) Byte1(status); only the length lies.
  { name: "ReadyForQuery declaring length 3", frame: pgRaw("Z", Buffer.from("I"), 3) },
  { name: "ReadyForQuery declaring length 0", frame: pgRaw("Z", Buffer.from("I"), 0) },
  // writeInt32BE(-1) puts 0xFFFFFFFF on the wire, the signed high half.
  { name: "ReadyForQuery declaring length -1", frame: pgRaw("Z", Buffer.from("I"), -1) },
  { name: "ParameterStatus declaring length 3", frame: pgRaw("S", Buffer.alloc(0), 3) },
  { name: "NotificationResponse declaring length 3", frame: pgRaw("A", Buffer.alloc(0), 3) },
  // NoticeResponse is not exempt: an unframeable length is fatal even for a notice.
  { name: "NoticeResponse declaring length 3", frame: pgRaw("N", Buffer.alloc(0), 3) },
  { name: "ErrorResponse declaring length 3", frame: pgRaw("E", Buffer.alloc(0), 3) },
  // An unrecognized message type takes the skip-by-declared-length path.
  { name: "unknown message type declaring length 3", frame: pgRaw("X", Buffer.alloc(0), 3) },
];

test.each(malformed)("postgres: $name is a protocol error", async ({ frame }) => {
  const err = await connectError([frame]);
  expect({ code: err.code, name: err.name }).toEqual({
    code: "ERR_POSTGRES_INVALID_MESSAGE_LENGTH",
    name: "PostgresError",
  });
});

// CommandComplete is only decoded while a request is in flight, so it has to be
// injected as the answer to a query rather than during the startup phase.
test("postgres: CommandComplete declaring length 3 fails the in-flight query", async () => {
  const err = await queryError([pgRaw("C", pgCString("SELECT 1"), 3)]);
  expect({ code: err.code, name: err.name }).toEqual({
    code: "ERR_POSTGRES_INVALID_MESSAGE_LENGTH",
    name: "PostgresError",
  });
});

// Boundary: a length of exactly 4 (an empty NoticeResponse) is the smallest
// valid value and must still be accepted.
test("postgres: an empty NoticeResponse (length exactly 4) is accepted", async () => {
  current = { atStartup: [pgRaw("N", Buffer.alloc(0)), pgReadyForQuery()] };
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
  }
});
