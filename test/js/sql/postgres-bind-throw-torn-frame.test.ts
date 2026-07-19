// Fault-injection test: requires a server we can byte-inspect, which a healthy
// container does not expose. DO NOT COPY THIS PATTERN; anything a real server
// can produce belongs in describeWithContainer.
//
// `write_bind` serialises parameter values directly into the connection's
// outgoing wire buffer, calling back into JS for each value (coerce / toString
// / valueOf). The Bind message's Int32 length field is written as a zero
// placeholder and only patched once every parameter has been encoded. If one of
// those JS callbacks throws, the query rejects with the user's error, but the
// partially-written `B\0\0\0\0…` prefix must be truncated from the buffer;
// otherwise the next query's frames are appended after the torn Bind and the
// whole lot is flushed together, which a real PostgreSQL server answers with
// `invalid message length` and a dropped connection.
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

// Mock backend: answers startup with AuthOk+ReadyForQuery, every Parse with
// ParseComplete+ParameterDescription(int4)+RowDescription+ReadyForQuery, and
// every Bind with BindComplete+DataRow+CommandComplete+ReadyForQuery. Records
// the raw bytes of every chunk received after startup so the test can verify
// the client's wire framing directly.
let received!: Buffer;
const { port, server } = await listeningServer(socket => {
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
      if (pending.length === 0) return;
    }
    received = Buffer.concat([received, pending]);
    pgReadFrontendMessages(pending, type => {
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
    pending = Buffer.alloc(0);
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

/** Walk `buf` as a sequence of Byte1-type + Int32-length frontend messages.
 * Returns the type-character list if every declared length is ≥ 4 and the
 * messages tile the buffer exactly; otherwise returns the torn offset and a
 * hex dump of the first bytes at that offset. */
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
    // First query: the parameter's JS coercion throws while the Bind is being
    // serialised, after the 'B' tag, the zero length placeholder, the
    // portal/statement names and the format codes are already in the buffer.
    const first = await db`select ${evil as any}::int4 as v`.catch(e => e);
    expect(first).toBeInstanceOf(errorType);
    expect((first as Error).message).toBe(message);

    // Second, innocent query on the same connection.
    const rows: any = await db`select ${1}::int4 as v`;

    // Every byte the client sent after startup must be a well-formed frontend
    // message. A torn Bind shows up as `42 00 00 00 00 …` (declared length 0,
    // below the 4-byte minimum) at the offset where the first query's Bind was
    // partially written, and frameTypes() reports it instead of a type list.
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
