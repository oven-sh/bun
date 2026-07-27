// A plain-object parameter bound to a non-json slot must be JSON.stringify'd,
// not ToString'd. The serialization dispatch in write_bind keys on the
// server-described parameter OID: only json/jsonb hit the JSON.stringify arm,
// and everything else falls through to BunString::from_js (ToString), so an
// object bound to a text/varchar/unknown slot became the literal
// "[object Object]" on the wire. postgres.js and node-pg both JSON.stringify
// plain objects regardless of the described type.
//
// Wire-level test: a mock server describes the single parameter as the given
// OID and captures the Bind message; the parameter bytes must be the JSON
// text, not "[object Object]". Also runs against a real server to check the
// full round-trip.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
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

// PostgreSQL FE/BE protocol §55.7 Bind: Byte1('B') Int32(len) String(portal)
// String(stmt) Int16(nFormatCodes) Int16[n] Int16(nParams) per-param:
// Int32(byteLen | -1) Byte[len] ... Int16(nResultFormatCodes) Int16[n]
function pgParseBindParams(body: Buffer): Buffer[] {
  let o = 0;
  o = body.indexOf(0, o) + 1; // portal name
  o = body.indexOf(0, o) + 1; // statement name
  const nFormatCodes = body.readInt16BE(o);
  o += 2 + 2 * nFormatCodes;
  const nParams = body.readInt16BE(o);
  o += 2;
  const params: Buffer[] = [];
  for (let i = 0; i < nParams; i++) {
    const len = body.readInt32BE(o);
    o += 4;
    if (len === -1) {
      params.push(Buffer.alloc(0));
    } else {
      params.push(Buffer.from(body.subarray(o, o + len)));
      o += len;
    }
  }
  return params;
}

/**
 * Mock a single-parameter `select $1 as v` round-trip on the default prepared
 * path, describing $1 as `paramOid`. Returns the raw bytes Bun put on the wire
 * for that parameter in the Bind message.
 */
async function capturedBindParam(value: unknown, paramOid: number): Promise<Buffer> {
  let bindBody: Buffer | undefined;
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    let buffered = Buffer.alloc(0);
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (startup) {
        if (buffered.length < 4) return;
        const len = buffered.readInt32BE(0);
        if (buffered.length < len) return;
        buffered = buffered.subarray(len);
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        if (type === 0x42 /* 'B' Bind */) {
          bindBody = Buffer.from(body);
        } else if (type === 0x53 /* 'S' Sync */) {
          if (bindBody === undefined) {
            socket.write(
              Buffer.concat([
                pgParseComplete(),
                pgParameterDescription([paramOid]),
                pgRowDescription([{ name: "v", typeOid: 25 }]),
                pgReadyForQuery(),
              ]),
            );
          } else {
            socket.write(
              Buffer.concat([
                pgBindComplete(),
                pgDataRow([Buffer.from("ok")]),
                pgCommandComplete("SELECT 1"),
                pgReadyForQuery(),
              ]),
            );
          }
        }
      });
    });
    socket.on("error", () => {});
  });
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5 });
    await sql`select ${value} as v`;
    if (bindBody === undefined) throw new Error("no Bind message received");
    return pgParseBindParams(bindBody)[0];
  } finally {
    server.close();
  }
}

const obj = { user: "alice", tags: ["a", "b"] };
const json = JSON.stringify(obj);

test.each([
  ["text", 25],
  ["varchar", 1043],
  ["unknown", 0],
])("object bound to a %s parameter is JSON.stringify'd on the wire", async (_, oid) => {
  const bytes = await capturedBindParam(obj, oid);
  expect(bytes.toString("utf-8")).toBe(json);
});

test("object bound to a json parameter is JSON.stringify'd on the wire", async () => {
  const bytes = await capturedBindParam(obj, 114);
  expect(bytes.toString("utf-8")).toBe(json);
});

test("object with toJSON bound to a text parameter honors toJSON", async () => {
  const custom = { toJSON: () => ({ x: 1 }) };
  const bytes = await capturedBindParam(custom, 25);
  expect(bytes.toString("utf-8")).toBe('{"x":1}');
});

test("string bound to a text parameter is sent verbatim", async () => {
  const bytes = await capturedBindParam("hello", 25);
  expect(bytes.toString("utf-8")).toBe("hello");
});

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("object in untyped select slot round-trips as JSON text", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    expect((await sql`select ${obj} as v`)[0].v).toBe(json);
  });

  test.each([
    ["text", "text"],
    ["varchar", "varchar(200)"],
  ])("object inserted into a %s column stores JSON text", async (_, coltype) => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    await sql.unsafe(`create temporary table t_obj (tt ${coltype})`);
    await sql`insert into t_obj (tt) values (${obj})`;
    expect((await sql`select tt from t_obj`)[0].tt).toBe(json);
  });

  test("object in untyped select slot with prepare: false round-trips as JSON text", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, prepare: false });
    expect((await sql`select ${obj} as v`)[0].v).toBe(json);
  });
});
