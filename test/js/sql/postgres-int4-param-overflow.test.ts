// Fault-injection test: requires a mock server so we can observe the exact
// int4 bytes Bun writes in the Bind message. DO NOT COPY THIS PATTERN for
// anything a real server can produce; see describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts.
//
// Binding a JS number outside the i32 range to an int4 parameter used to
// silently saturate to INT32_MIN/INT32_MAX (via the saturating f64 -> i32
// coercion in write_bind) and store the wrong value. A real PostgreSQL server
// rejects the same literal with "integer out of range" (SQLSTATE 22003), so
// every other client surfaces a loud error while Bun quietly persisted the
// saturated value instead.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const INT4 = 23;

// Read the first parameter value out of a Bind body as a 4-byte big-endian
// i32, or null if the body is short / the value length is not 4.
function bindFirstInt4(body: Buffer): number | null {
  if (body.length < 2) return null;
  let o = body.indexOf(0) + 1; // portal name
  o = body.indexOf(0, o) + 1; // statement name
  if (o <= 0 || o + 2 > body.length) return null;
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt; // format codes
  o += 2; // nParams
  if (o + 4 > body.length) return null;
  const len = body.readInt32BE(o);
  o += 4;
  return len === 4 && o + 4 <= body.length ? body.readInt32BE(o) : null;
}

// Capture the value Bun bound for $1 on the most recent Bind. `undefined` means
// no Bind arrived at all (the client rejected before writing it).
let lastBoundInt4: number | null | undefined;

const { port, server } = await listeningServer(socket => {
  socket.on("error", () => {});
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  socket.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!sawStartup) {
      if (pending.length < 4) return;
      const len = pending.readInt32BE(0);
      if (pending.length < len) return;
      pending = pending.subarray(len);
      sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    pending = pgReadFrontendMessages(pending, (type, body) => {
      if (type === 0x50 /* 'P' Parse */) {
        socket.write(pgParseComplete());
      } else if (type === 0x44 /* 'D' Describe */) {
        socket.write(
          Buffer.concat([pgParameterDescription([INT4]), pgRowDescription([{ name: "n", typeOid: INT4, format: 1 }])]),
        );
      } else if (type === 0x42 /* 'B' Bind */) {
        lastBoundInt4 = bindFirstInt4(body);
        socket.write(pgBindComplete());
      } else if (type === 0x45 /* 'E' Execute */) {
        socket.write(pgCommandComplete("SELECT 0"));
      } else if (type === 0x53 /* 'S' Sync */) {
        socket.write(pgReadyForQuery());
      }
    });
  });
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function bind(n: number | bigint) {
  lastBoundInt4 = undefined;
  await using sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });
  await sql`SELECT ${n}::int4 AS n`.values();
}

const overflowing = [
  { label: "2^31", value: 2147483648 },
  { label: "2^32 + 1", value: 4294967297 },
  { label: "-(2^31 + 1)", value: -2147483649 },
  { label: "Number.MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER },
  { label: "Infinity", value: Infinity },
  { label: "-Infinity", value: -Infinity },
  { label: "NaN", value: NaN },
];

test.each(overflowing)("binding $label to an int4 parameter rejects instead of saturating", async ({ value }) => {
  let error: any;
  try {
    await bind(value);
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(error?.code ?? error?.message).toMatch(/ERR_POSTGRES_OVERFLOW|Overflow/);
  // The Bind message must not have reached the server carrying a saturated i32.
  expect(lastBoundInt4).not.toBe(2147483647);
  expect(lastBoundInt4).not.toBe(-2147483648);
});

test("binding INT32_MAX / INT32_MIN to an int4 parameter still works", async () => {
  await bind(2147483647);
  expect(lastBoundInt4).toBe(2147483647);
  await bind(-2147483648);
  expect(lastBoundInt4).toBe(-2147483648);
});

test("binding 0 to an int4 parameter still works", async () => {
  await bind(0);
  expect(lastBoundInt4).toBe(0);
});

// write_bind streams into the connection's write_buffer directly; erroring out
// mid-serialize used to leave a partial 'B…' frontend message in the buffer,
// which the auto-flusher then shipped to the server ahead of the next query's
// Parse on the same pooled connection.
test("a follow-up query on the same connection still works after an int4 overflow rejection", async () => {
  await using sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });

  let error: any;
  try {
    await sql`SELECT ${2 ** 32 + 1}::int4 AS n`.values();
  } catch (e) {
    error = e;
  }
  expect(error?.code ?? error?.message).toMatch(/ERR_POSTGRES_OVERFLOW|Overflow/);

  // Any partial Bind bytes that were flushed would reach the server before the
  // next Parse, and the mock handler would see a leading 0x42 'B' frame whose
  // declared length (00 00 00 00) swallows nothing, so the follow-up Parse
  // would never be answered and this await would reject or hang.
  lastBoundInt4 = undefined;
  await sql`SELECT ${7}::int4 AS n`.values();
  expect(lastBoundInt4).toBe(7);
});
