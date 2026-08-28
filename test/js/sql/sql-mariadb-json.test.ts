// MariaDB has no server-side JSON type: JSON columns are LONGTEXT and reach
// the client as MYSQL_TYPE_BLOB with a text charset, so the MYSQL_TYPE_JSON
// decode path (which parses the value into objects/arrays, like on MySQL)
// never fired and `SELECT` returned raw JSON text as a string. The way a
// MariaDB server distinguishes them is the MARIADB_CLIENT_EXTENDED_TYPE_INFO
// capability: once negotiated, every column definition carries extended
// metadata and JSON columns are marked "format=json".
//
// The mock-server tests below byte-assert the negotiation itself (which bits
// of the handshake's reserved tail the client writes); that part cannot be
// asserted against a real server. The mocks behave like a real MariaDB 11.x: extended metadata is only
// sent when the client actually requested the capability, so an un-negotiated
// connection keeps returning plain strings. A docker-backed suite against real
// MariaDB follows at the bottom.

import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, isCI, isDockerEnabled } from "harness";
import { readFileSync } from "node:fs";
import type net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import {
  MARIADB_CLIENT_EXTENDED_TYPE_INFO,
  MYSQL_CLIENT_LONG_PASSWORD,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlLenencStr,
  mysqlOkPacket,
  mysqlParseHandshakeResponseExtendedCaps,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE = 0x19;
const MYSQL_TYPE_BLOB = 0xfc;
const BLOB_FLAG = 0x10;

const jsonText = '{"answer":42,"list":[1,2,3]}';
const jsonValue = { answer: 42, list: [1, 2, 3] };

// A mock MariaDB server that answers `SELECT j` over both protocols with a
// single LONGTEXT-backed JSON column. Like the real server, it advertises
// `extendedCaps` in the handshake's reserved tail and attaches the
// format=json extended metadata only when the client negotiated
// MARIADB_CLIENT_EXTENDED_TYPE_INFO in its response. With `ssl` it requires
// the SSLRequest-then-TLS upgrade flow and records the SSLRequest's bytes,
// which are the ones a real MariaDB server reads the extended capabilities
// from on TLS connections. `extendedBlob` replaces the well-formed extended
// metadata contents for fault injection.
async function mariadbMockServer(opts: {
  serverCapabilities?: number;
  extendedCaps: number;
  ssl?: boolean;
  extendedBlob?: Buffer;
}) {
  const state = { clientExtendedCaps: -1, sslRequestPayloadLength: -1, sslRequestExtendedCaps: -1 };
  const columnDefinition = (seq: number, negotiated: boolean) =>
    mysqlColumnDefinition(seq, {
      name: "j",
      type: MYSQL_TYPE_BLOB,
      charset: 224, // utf8mb4_unicode_ci, a text charset (not the binary pseudo-charset)
      flags: BLOB_FLAG,
      columnLength: 0xffffffff,
      // kind 0 entries carry type names ("uuid", "inet4", ...); include one to
      // prove unrelated entries are skipped without desyncing the decoder.
      extendedTypeInfo: negotiated
        ? (opts.extendedBlob ?? [
            { kind: 0, value: "ignored" },
            { kind: 1, value: "json" },
          ])
        : undefined,
    });

  const { server, port } = await listeningServer(rawSocket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let socket: net.Socket | tls.TLSSocket = rawSocket;
    rawSocket.write(
      mysqlHandshakeV10({
        serverVersion: "11.8.0-MariaDB",
        capabilities: opts.serverCapabilities ?? MYSQL_DEFAULT_CAPABILITIES | (opts.ssl ? MYSQL_CLIENT_SSL : 0),
        mariadbExtendedCapabilities: opts.extendedCaps,
      }),
    );

    const onPacket = (seq: number, payload: Buffer) => {
      if (!authed) {
        authed = true;
        state.clientExtendedCaps = mysqlParseHandshakeResponseExtendedCaps(payload);
        socket.write(mysqlOkPacket(seq + 1));
        return;
      }
      if (mysqlAckSessionSetup(socket, payload)) return;
      const negotiated = (state.clientExtendedCaps & MARIADB_CLIENT_EXTENDED_TYPE_INFO) !== 0;
      switch (payload[0]) {
        case COM_STMT_PREPARE:
          socket.write(Buffer.concat([mysqlStmtPrepareOk(1, 1, 1, 0), columnDefinition(2, negotiated)]));
          break;
        case COM_STMT_EXECUTE:
          socket.write(
            Buffer.concat([
              mysqlRawPacket(1, Buffer.from([0x01])), // result set header: 1 column
              columnDefinition(2, negotiated),
              // binary row: header byte, null bitmap, then the lenenc value
              mysqlRawPacket(3, Buffer.concat([Buffer.from([0x00, 0x00]), mysqlLenencStr(jsonText)])),
              mysqlOkPacket(4, 0xfe),
            ]),
          );
          break;
        case COM_QUERY:
          socket.write(
            Buffer.concat([
              mysqlRawPacket(1, Buffer.from([0x01])), // result set header: 1 column
              columnDefinition(2, negotiated),
              mysqlRawPacket(3, mysqlLenencStr(jsonText)), // text row
              mysqlOkPacket(4, 0xfe),
            ]),
          );
          break;
        case COM_STMT_CLOSE:
          break; // no response
        default:
          socket.end();
      }
    };
    const onData = (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), onPacket);
    };

    if (opts.ssl) {
      // Plaintext phase: exactly one packet (the SSLRequest) arrives before
      // the TLS handshake. The client starts its ClientHello immediately
      // after, so any bytes past the packet boundary are TLS records: unshift
      // them for the TLSSocket wrap (which replays the socket's readable
      // buffer into the TLS engine) instead of parsing them here.
      const onPlainData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length < 4) return;
        const length = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + length) return;
        const payload = buffered.subarray(4, 4 + length);
        state.sslRequestPayloadLength = payload.length;
        state.sslRequestExtendedCaps = mysqlParseHandshakeResponseExtendedCaps(payload);
        const leftover = buffered.subarray(4 + length);
        buffered = Buffer.alloc(0);
        rawSocket.removeListener("data", onPlainData);
        rawSocket.pause();
        if (leftover.length) rawSocket.unshift(leftover);
        const tlsSocket = new tls.TLSSocket(rawSocket, {
          isServer: true,
          key: readFileSync(join(import.meta.dir, "mysql-tls/ssl/server-key.pem")),
          cert: readFileSync(join(import.meta.dir, "mysql-tls/ssl/server-cert.pem")),
        });
        socket = tlsSocket;
        tlsSocket.on("data", onData);
        tlsSocket.on("error", () => {});
      };
      rawSocket.on("data", onPlainData);
    } else {
      rawSocket.on("data", onData);
    }
    rawSocket.on("error", () => {});
  });
  return { server, port, state };
}

test.concurrent("MariaDB marks JSON columns via extended type info: binary protocol parses them", async () => {
  // 0x3d is what MariaDB 11.8 advertises (progress, bulk ops, extended type
  // info, metadata caching, bulk unit results).
  const { server, port, state } = await mariadbMockServer({ extendedCaps: 0x3d });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const rows = await sql`SELECT j`;
    // Of the advertised bits, the client must request exactly the one it
    // implements, in the last 4 of the 23 filler bytes.
    expect(state.clientExtendedCaps).toBe(MARIADB_CLIENT_EXTENDED_TYPE_INFO);
    expect(rows).toEqual([{ j: jsonValue }]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("MariaDB marks JSON columns via extended type info: text protocol parses them", async () => {
  const { server, port, state } = await mariadbMockServer({ extendedCaps: 0x3d });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const rows = await sql`SELECT j`.simple();
    expect(state.clientExtendedCaps).toBe(MARIADB_CLIENT_EXTENDED_TYPE_INFO);
    expect(rows).toEqual([{ j: jsonValue }]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("MariaDB without extended type info keeps returning JSON text as strings", async () => {
  const { server, port, state } = await mariadbMockServer({ extendedCaps: 0 });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const rows = await sql`SELECT j`;
    // The server advertised nothing, so the client must request nothing.
    expect(state.clientExtendedCaps).toBe(0);
    expect(rows).toEqual([{ j: jsonText }]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("MySQL-style servers get an all-zero filler even with garbage in the reserved bytes", async () => {
  // CLIENT_LONG_PASSWORD set = not a MariaDB 10.2+ server; the reserved tail
  // is then plain filler and must be ignored no matter its content.
  const { server, port, state } = await mariadbMockServer({
    serverCapabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_LONG_PASSWORD,
    extendedCaps: 0xdeadbeef,
  });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const rows = await sql`SELECT j`;
    expect(state.clientExtendedCaps).toBe(0);
    expect(rows).toEqual([{ j: jsonText }]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("over TLS, the SSLRequest carries the extended capabilities", async () => {
  // On TLS connections MariaDB reads the extended client capabilities from
  // the SSLRequest (the pre-TLS prefix of the handshake response), so this is
  // the packet that must carry the bit for extended metadata to flow at all.
  const { server, port, state } = await mariadbMockServer({ extendedCaps: 0x3d, ssl: true });
  try {
    await using sql = new SQL({
      url: `mysql://root@127.0.0.1:${port}/db`,
      max: 1,
      tls: { rejectUnauthorized: false },
    });
    const rows = await sql`SELECT j`;
    // 4 capability bytes + 4 max-packet + 1 charset + 19 reserved + 4
    // extended capability bytes; same length as before, different tail.
    expect(state.sslRequestPayloadLength).toBe(32);
    expect(state.sslRequestExtendedCaps).toBe(MARIADB_CLIENT_EXTENDED_TYPE_INFO);
    // The post-TLS handshake response repeats the same capabilities.
    expect(state.clientExtendedCaps).toBe(MARIADB_CLIENT_EXTENDED_TYPE_INFO);
    expect(rows).toEqual([{ j: jsonValue }]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("a truncated length in the extended metadata rejects the query", async () => {
  // kind byte, then a 0xfc lenenc prefix that promises 2 length bytes but
  // delivers 1: the value length itself cannot be decoded.
  const { server, port } = await mariadbMockServer({
    extendedCaps: 0x3d,
    extendedBlob: Buffer.from([0x01, 0xfc, 0x01]),
  });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const err = await sql`SELECT j`.then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );
    expect(err).toEqual({ code: "ERR_MYSQL_INVALID_ENCODED_INTEGER" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("an extended metadata length past the blob's end rejects the query", async () => {
  // kind byte, then a value length of 5 with a single byte following.
  const { server, port } = await mariadbMockServer({
    extendedCaps: 0x3d,
    extendedBlob: Buffer.from([0x01, 0x05, 0x61]),
  });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    // Text protocol; the truncated-length case above covers the prepared
    // path, and both share the decoder.
    const err = await sql`SELECT j`.simple().then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );
    expect(err).toEqual({ code: "ERR_MYSQL_INVALID_ENCODED_LENGTH" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// Real-server coverage. MariaDB negotiates extended metadata on every column
// definition once the capability is agreed on, so these also verify decode
// alignment for columns with empty / non-json extended metadata.
//
// Only attempt the container when something can actually provide it: an
// explicit BUN_TEST_SERVICE_mariadb_plain override (point it at any MariaDB
// 10.5+, e.g. 127.0.0.1:3306), the CI docker coordinator, or CI docker. A
// bare isDockerEnabled() is deliberately not enough to auto-start outside CI:
// a daemon that answers `docker info` but cannot pull or build images (seen
// on partially provisioned machines) would fail the suite instead of
// skipping it.
const mariadbProvided =
  !!process.env.BUN_TEST_SERVICE_mariadb_plain || !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled());
if (!mariadbProvided) {
  describe.todo("mariadb");
} else {
  describeWithContainer("mariadb", { image: "mariadb_plain" }, container => {
    test("JSON columns and JSON function results parse into objects", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE ${sql(table)} (id INT, doc JSON, name VARCHAR(32))`;
      await sql`INSERT INTO ${sql(table)} VALUES (1, ${JSON.stringify(jsonValue)}, 'alice'), (2, ${JSON.stringify([false, null, "x"])}, 'bob'), (3, NULL, 'carol')`;

      const expected = [
        { id: 1, doc: jsonValue, name: "alice" },
        { id: 2, doc: [false, null, "x"], name: "bob" },
        { id: 3, doc: null, name: "carol" },
      ];
      // Prepared → binary protocol; the surrounding columns prove the extended
      // metadata block is consumed without desyncing the row decoder.
      expect(await sql`SELECT id, doc, name FROM ${sql(table)} ORDER BY id`).toEqual(expected);
      // Re-running the same prepared statement re-decodes the column
      // definitions (the server resends them on every execute).
      expect(await sql`SELECT id, doc, name FROM ${sql(table)} ORDER BY id`).toEqual(expected);
      // `.simple()` → text protocol.
      expect(await sql`SELECT id, doc, name FROM ${sql(table)} ORDER BY id`.simple()).toEqual(expected);

      // JSON functions return LONGTEXT marked format=json, like MySQL's native
      // JSON results.
      expect(await sql`SELECT JSON_OBJECT('x', 1) AS j, JSON_EXTRACT(${jsonText}, '$.answer') AS n`).toEqual([
        { j: { x: 1 }, n: 42 },
      ]);

      // `.raw()` still returns the bytes, not parsed values.
      const [rawRow] = await sql`SELECT doc FROM ${sql(table)} WHERE id = 1`.raw();
      expect(JSON.parse(Buffer.from(rawRow[0] as Uint8Array).toString("utf-8"))).toEqual(jsonValue);
    });

    test("extended type info for non-JSON MariaDB types is skipped, values stay strings", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      // UUID and INET6 columns carry a kind-0 ("type") extended metadata entry;
      // they must keep decoding as plain strings.
      await sql`CREATE TEMPORARY TABLE ${sql(table)} (u UUID, addr INET6, note TEXT)`;
      await sql`INSERT INTO ${sql(table)} VALUES ('5f8b6b9c-6b6f-11ee-8c99-0242ac120002', '::1', 'hi')`;

      const expected = [{ u: "5f8b6b9c-6b6f-11ee-8c99-0242ac120002", addr: "::1", note: "hi" }];
      expect(await sql`SELECT u, addr, note FROM ${sql(table)}`).toEqual(expected);
      expect(await sql`SELECT u, addr, note FROM ${sql(table)}`.simple()).toEqual(expected);
    });
  });
}
