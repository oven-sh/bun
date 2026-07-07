// A raw JavaScript array passed as a query parameter (not via sql.array) must be
// encoded in the Bind message as a PostgreSQL text array literal (`{1,2,3}`) with
// format code 0 (text). Before the fix the Bind writer had no array value encoder:
// int4[]/float4[] parameters were declared binary (format 1) yet carried a scalar
// or ASCII payload, and other array OIDs were stringified with JS toString
// ("1,2", no braces), so a real server rejected every array parameter with
// `08P01 insufficient data left in message` / `malformed array literal`.
//
// This asserts the exact Bind frame bytes with a mock backend so it is
// deterministic and needs no real PostgreSQL. Frame bytes come from
// ./wire-frames.ts.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDecodeBind,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgSplitFrontend,
  type PgBindMessage,
} from "./wire-frames";

// Drive one prepared query whose single parameter the backend reports as
// `paramOid`, and return the decoded Bind message the client sent.
async function captureBind(paramOid: number, param: unknown): Promise<PgBindMessage> {
  const { promise, resolve, reject } = Promise.withResolvers<PgBindMessage>();

  const { port, server } = await listeningServer(socket => {
    let startupDone = false;
    let buffered = Buffer.alloc(0);
    let batch: { type: string; body: Buffer }[] = [];

    socket.on("error", () => {});
    socket.on("data", chunk => {
      if (!startupDone) {
        startupDone = true;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      // Extract complete frames; a Sync ('S') ends a request batch.
      while (buffered.length >= 5) {
        const len = buffered.readInt32BE(1);
        if (buffered.length < 1 + len) break;
        const frame = pgSplitFrontend(buffered.subarray(0, 1 + len))[0];
        buffered = buffered.subarray(1 + len);
        batch.push(frame);
        if (frame.type !== "S") continue;

        const current = batch;
        batch = [];
        const bind = current.find(f => f.type === "B");
        if (bind) {
          // Execute phase: capture the Bind and let the query complete empty.
          socket.write(Buffer.concat([pgBindComplete(), pgCommandComplete("SELECT 0"), pgReadyForQuery()]));
          resolve(pgDecodeBind(bind.body));
        } else {
          // Prepare phase (Parse + Describe): report the parameter type.
          socket.write(
            Buffer.concat([pgParseComplete(), pgParameterDescription([paramOid]), pgNoData(), pgReadyForQuery()]),
          );
        }
      }
    });
  });

  try {
    await using sql = new SQL({ hostname: "127.0.0.1", port, username: "x", database: "x", max: 1 });
    try {
      await sql.unsafe("select $1", [param]);
    } catch (e) {
      reject(e as Error);
    }
    return await promise;
  } finally {
    server.close();
  }
}

const text = (b: Buffer | null) => (b === null ? null : b.toString("latin1"));

test("int4[] array parameter is sent as a text array literal, format 0", async () => {
  const bind = await captureBind(1007 /* int4_array */, [1, 2, 3]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"1","2","3"}`);
});

test("float4[] array parameter is sent as a text array literal, format 0", async () => {
  const bind = await captureBind(1021 /* float4_array */, [1.5, 2.5]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"1.5","2.5"}`);
});

test("text[] array parameter is wrapped in braces", async () => {
  const bind = await captureBind(1009 /* text_array */, ["a", "b"]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"a","b"}`);
});

test("int8[] array parameter is wrapped in braces", async () => {
  const bind = await captureBind(1016 /* int8_array */, [1, 2]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"1","2"}`);
});

test("null elements become NULL and quotes/backslashes are escaped", async () => {
  const bind = await captureBind(1009 /* text_array */, ["a,b", `he"llo`, "back\\slash", null]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"a,b","he\\"llo","back\\\\slash",NULL}`);
});

test("nested arrays produce nested braces", async () => {
  const bind = await captureBind(1007 /* int4_array */, [
    [1, 2],
    [3, 4],
  ]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{{"1","2"},{"3","4"}}`);
});

test("empty array becomes {}", async () => {
  const bind = await captureBind(1007 /* int4_array */, []);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{}`);
});

test("jsonb array parameter stays JSON, not a pg array literal", async () => {
  const bind = await captureBind(3802 /* jsonb */, ["a", "b"]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`["a","b"]`);
});

test("box[] uses ; as the element delimiter", async () => {
  const bind = await captureBind(1020 /* box_array */, ["(0,0),(1,1)", "(2,2),(3,3)"]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"(0,0),(1,1)";"(2,2),(3,3)"}`);
});

test("Date elements serialize as ISO strings", async () => {
  const bind = await captureBind(1185 /* timestamptz_array */, [new Date(Date.UTC(2024, 0, 2, 3, 4, 5))]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"2024-01-02T03:04:05.000Z"}`);
});

test("object elements in a jsonb[] serialize as JSON", async () => {
  const bind = await captureBind(3807 /* jsonb_array */, [{ a: 1 }, { b: [2, 3] }]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"{\\"a\\":1}","{\\"b\\":[2,3]}"}`);
});

test("primitive elements in a jsonb[] serialize as JSON", async () => {
  const bind = await captureBind(3807 /* jsonb_array */, ["hello", 42, true]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"\\"hello\\"","42","true"}`);
});

test("Buffer elements in a bytea[] serialize as hex", async () => {
  const bind = await captureBind(1001 /* bytea_array */, [Buffer.from([1, 2, 255]), Buffer.from([0])]);
  expect(bind.formatCodes).toEqual([0]);
  expect(text(bind.values[0])).toBe(`{"\\\\x0102ff","\\\\x00"}`);
});
