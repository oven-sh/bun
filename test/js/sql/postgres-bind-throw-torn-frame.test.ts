// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A parameter whose valueOf()/toString() throws mid-Bind must not leave the
// half-written `B\0\0\0\0…` prefix in the write buffer; flushed ahead of the
// next query it reads as `invalid message length` and drops the connection.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Mock backend: replies to startup / Parse / Bind with the minimal happy-path
// sequence and records every raw byte received after startup so the test can
// verify the client's wire framing directly.
let received!: Buffer;
const { port, server } = await listeningServer(socket => {
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  socket.on("data", chunk => {
    if (sawStartup) received = Buffer.concat([received, chunk]);
    pending = Buffer.concat([pending, chunk]);
    if (!sawStartup) {
      if (pending.length < 4) return;
      const len = pending.readInt32BE(0);
      if (pending.length < len) return;
      pending = pending.subarray(len);
      sawStartup = true;
      received = Buffer.concat([received, pending]);
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    pending = pgReadFrontendMessages(pending, type => {
      if (type === 0x50 /* Parse 'P' */) {
        socket.write(
          Buffer.concat([
            pgParseComplete(),
            pgParameterDescription([23 /* int4 */]),
            pgRowDescription([{ name: "v", typeOid: 23, format: 1 }]),
            pgReadyForQuery(),
          ]),
        );
      } else if (type === 0x42 /* Bind 'B' */) {
        socket.write(
          Buffer.concat([
            pgBindComplete(),
            pgDataRow([Buffer.from([0, 0, 0, 2])]), // int4 value 2, binary
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      }
    });
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

function newClient() {
  return new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    prepare: true,
    connectionTimeout: 2,
  });
}

/** Walk `buf` as Byte1-type + Int32-length frontend messages: returns the type
 * list iff every declared length is ≥ 4 and messages tile the buffer exactly,
 * otherwise the torn offset and a hex dump of the bytes there. */
function frameTypes(buf: Buffer): { types: string[] } | { tornAt: number; head: string } {
  const types: string[] = [];
  let o = 0;
  while (o + 5 <= buf.length) {
    const len = buf.readInt32BE(o + 1);
    if (len < 4 || o + 1 + len > buf.length) {
      return { tornAt: o, head: [...buf.subarray(o, o + 16)].map(b => b.toString(16).padStart(2, "0")).join(" ") };
    }
    types.push(String.fromCharCode(buf[o]));
    o += 1 + len;
  }
  if (o !== buf.length) {
    return { tornAt: o, head: [...buf.subarray(o)].map(b => b.toString(16).padStart(2, "0")).join(" ") };
  }
  return { types };
}

async function run(evil: unknown, errorType: new (...a: any[]) => Error, message: string) {
  received = Buffer.alloc(0);
  const db = newClient();
  try {
    // First query: the parameter's JS coercion throws mid-Bind, after the
    // 'B' tag + zero length placeholder + names + format codes are buffered.
    const first = await db`select ${evil as any}::int4 as v`.catch(e => e);
    expect(first).toBeInstanceOf(errorType);
    expect((first as Error).message).toBe(message);

    // Second, innocent query on the same connection.
    const rows: any = await db`select ${1}::int4 as v`;

    // Every byte sent after startup must be a well-formed frontend message;
    // a torn Bind fails frameTypes() with head `42 00 00 00 00 …`.
    const framed = frameTypes(received);
    expect(framed).toEqual({
      types: expect.arrayContaining(["B", "E", "S"]),
    });
    // Exactly one Bind reached the wire (the second query's), and it decoded
    // to the row the server sent for it.
    expect({
      binds: ((framed as { types: string[] }).types ?? []).filter(t => t === "B"),
      row: rows[0],
    }).toEqual({ binds: ["B"], row: { v: 2 } });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
}

test("postgres: a throwing valueOf() during Bind does not leave a torn frame on the wire", async () => {
  await run(
    {
      valueOf() {
        throw new RangeError("evil valueOf");
      },
    },
    RangeError,
    "evil valueOf",
  );
});

test("postgres: a throwing toString() during Bind does not leave a torn frame on the wire", async () => {
  await run(
    {
      toString() {
        throw new TypeError("evil toString");
      },
    },
    TypeError,
    "evil toString",
  );
});
