// A result row can be framed correctly and still hold a value this client
// cannot turn into a JS value: a binary DATE with a length no server sends, a
// JSON column whose text is not JSON. That is the failure of the query that
// asked for the row, and the server keeps answering that query: more rows, the
// terminator, further result sets of a CALL or a multi-statement string.
//
// The connection marked the query failed at once. The request queue then
// dropped it at the next terminator, and the rest of its response went to the
// query queued behind it. When the value failed only while it was turned into a
// JS value (the JSON case), the connection closed instead, and every query on it
// rejected with that one query's error.
import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, isCI, isDockerEnabled } from "harness";
import {
  MYSQL_SERVER_MORE_RESULTS_EXISTS,
  MYSQL_SERVER_STATUS_AUTOCOMMIT,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlBinaryDate,
  mysqlBinaryLong,
  mysqlBinaryResultSet,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlLenencStr,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  mysqlTextResultSet,
} from "./wire-frames";

/** One entry per query, in order: its rows, or the error it rejected with. */
async function settle(queries: PromiseLike<any>[]) {
  return (await Promise.allSettled(queries)).map(result =>
    result.status === "fulfilled"
      ? [...result.value]
      : { name: result.reason.name, code: result.reason.code, message: result.reason.message },
  );
}

const notJson = { name: "SyntaxError", message: "JSON Parse error: Expected '}'" };

// Fault-injection tests: a healthy server does not send a DATE of 5 bytes, and
// it does not stop in the middle of a response on demand. DO NOT COPY THIS
// PATTERN: anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts.
//
// The mock answers each statement text with its entry in `responses`, over both
// protocols. An entry is a list of chunks. The first chunk is sent at once. The
// mock keeps back the other chunks, and everything it sends after them, until
// `release()`.
async function mockServer(responses: Record<string, Buffer[]>) {
  let connections = 0;
  let release = () => {};
  const { port, server } = await listeningServer(socket => {
    connections++;
    let buffered = Buffer.alloc(0);
    let authed = false;
    let held: Buffer[] | undefined;
    const prepared: string[] = [];
    const send = (chunks: Buffer[]) => {
      chunks.forEach((chunk, i) => {
        if (i > 0) held ??= [];
        if (held) held.push(chunk);
        else socket.write(chunk);
      });
    };
    release = () => {
      if (!held) return;
      socket.write(Buffer.concat(held));
      held = undefined;
    };
    socket.write(mysqlHandshakeV10());
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        if (mysqlAckSessionSetup(socket, payload)) return;
        switch (payload[0]) {
          case 0x16: // COM_STMT_PREPARE: Int<1>(0x16) String<EOF>(query)
            // No columns at prepare time, which is what a server says for a
            // CALL. The client takes the columns from each result set.
            prepared.push(payload.subarray(1).toString());
            return send([mysqlStmtPrepareOk(1, prepared.length, 0, 0)]);
          case 0x17: // COM_STMT_EXECUTE: Int<1>(0x17) Int<4>(statement_id) ...
            return send(responses[prepared[payload.readUInt32LE(1) - 1]]);
          case 0x03: // COM_QUERY: Int<1>(0x03) String<EOF>(query)
            return send(responses[payload.subarray(1).toString()]);
        }
      });
    });
  });
  return { port, server, release: () => release(), connections: () => connections };
}

const MYSQL_TYPE_LONG = 0x03;
const MYSQL_TYPE_DATE = 0x0a;
const MYSQL_TYPE_JSON = 0xf5;
const date = [{ name: "d", type: MYSQL_TYPE_DATE }];
const doc = [{ name: "doc", type: MYSQL_TYPE_JSON }];
const leftover = [{ name: "leftover", type: MYSQL_TYPE_LONG }];
const moreResults = MYSQL_SERVER_STATUS_AUTOCOMMIT | MYSQL_SERVER_MORE_RESULTS_EXISTS;
// The length byte of a binary DATE is 0, 4, 7 or 11.
const undecodableDate = mysqlBinaryDate(2024, 6, 15, 5);
/** The response to `select <n> as n`. */
const numberRow = (n: number, text = false) => [
  text
    ? mysqlTextResultSet(1, [{ name: "n", type: MYSQL_TYPE_LONG }], [[String(n)]])
    : mysqlBinaryResultSet(1, [{ name: "n", type: MYSQL_TYPE_LONG }], [[mysqlBinaryLong(n)]]),
];
// A CALL whose first result set has a row the client cannot decode between two
// rows it can. A second result set follows: 3 rows + 3 sequence ids later.
const callBad = Buffer.concat([
  mysqlBinaryResultSet(
    1,
    date,
    [[mysqlBinaryDate(2024, 6, 14)], [undecodableDate], [mysqlBinaryDate(2024, 6, 16)]],
    moreResults,
  ),
  mysqlBinaryResultSet(7, leftover, [[mysqlBinaryLong(777)]]),
]);
const undecodable = { name: "MySQLError", code: "ERR_MYSQL_INVALID_BINARY_VALUE", message: expect.any(String) };

describe.concurrent("mysql mock", () => {
  test("a pipelined query with a row the client cannot decode rejects alone", async () => {
    const mock = await mockServer({ "call bad()": [callBad], "select 1 as n": numberRow(1) });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
      // After this first run the statement is prepared, so its second run is
      // written right behind `call bad()`, before the first reply arrives.
      await sql`select 1 as n`;

      const results = await settle([sql`call bad()`, sql`select 1 as n`]);
      results.push([...(await sql`select 1 as n`)]);
      expect({ results, connections: mock.connections() }).toEqual({
        results: [undecodable, [{ n: 1 }], [{ n: 1 }]],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });

  test("a statement that is not prepared yet runs after the rejected query's response", async () => {
    const mock = await mockServer({ "call bad()": [callBad], "select 2 as n": numberRow(2) });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

      // A prepare cannot be pipelined. `select 2 as n` waits until the
      // connection no longer counts `call bad()` as in flight.
      expect({
        results: await settle([sql`call bad()`, sql`select 2 as n`]),
        connections: mock.connections(),
      }).toEqual({ results: [undecodable, [{ n: 2 }]], connections: 1 });
    } finally {
      mock.server.close();
    }
  });

  test("a pipelined query with a JSON column that is not JSON rejects alone", async () => {
    const mock = await mockServer({
      "select doc from t": [
        mysqlBinaryResultSet(1, doc, [
          [mysqlLenencStr('{"a":1}')],
          [mysqlLenencStr("{not json")],
          [mysqlLenencStr("2")],
        ]),
      ],
      "select 3 as n": numberRow(3),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
      await sql`select 3 as n`;

      const results = await settle([sql`select doc from t`, sql`select 3 as n`]);
      results.push([...(await sql`select 3 as n`)]);
      expect({ results, connections: mock.connections() }).toEqual({
        results: [notJson, [{ n: 3 }], [{ n: 3 }]],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });

  test("a simple query with a JSON column that is not JSON rejects alone", async () => {
    const mock = await mockServer({
      // Two statements in one string. The second result set starts 1 row + 3
      // sequence ids later.
      "select doc from t; select 777 as leftover": [
        Buffer.concat([
          mysqlTextResultSet(1, doc, [["{not json"]], moreResults),
          mysqlTextResultSet(5, leftover, [["777"]]),
        ]),
      ],
      "select 4 as n": numberRow(4, true),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

      expect({
        results: await settle([sql`select doc from t; select 777 as leftover`.simple(), sql`select 4 as n`.simple()]),
        connections: mock.connections(),
      }).toEqual({ results: [notJson, [{ n: 4 }]], connections: 1 });
    } finally {
      mock.server.close();
    }
  });

  test("a server error that ends the rejected query's response is not delivered", async () => {
    const mock = await mockServer({
      // The CALL fails after its first result set: 1 row + 3 sequence ids later.
      "call bad()": [
        Buffer.concat([
          mysqlBinaryResultSet(1, date, [[undecodableDate]], moreResults),
          mysqlErrPacket(5, 1146, "42S02", "Table 'db.missing' doesn't exist"),
        ]),
      ],
      "select 5 as n": numberRow(5),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
      await sql`select 5 as n`;

      expect({
        results: await settle([sql`call bad()`, sql`select 5 as n`]),
        connections: mock.connections(),
      }).toEqual({ results: [undecodable, [{ n: 5 }]], connections: 1 });
    } finally {
      mock.server.close();
    }
  });

  test("result sets that arrive after the rejection stay with the rejected query", async () => {
    const mock = await mockServer({
      "call bad()": [
        mysqlBinaryResultSet(1, date, [[undecodableDate]], moreResults),
        mysqlBinaryResultSet(5, leftover, [[mysqlBinaryLong(777)]]),
      ],
      "select 6 as n": numberRow(6),
      "select 7 as n": numberRow(7),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
      await sql`select 6 as n`;

      // execute() sends a query at once, so these two are pipelined in this order.
      const bad = sql`call bad()`.execute();
      const next = sql`select 6 as n`.execute();
      // `bad` rejects while the server still holds its second result set. The
      // handler queues a statement that is not prepared yet, then lets the
      // server continue. The held result set must not go to `next`, which is
      // the request behind the rejected one.
      let unprepared!: PromiseLike<any>;
      const rejection = await bad.catch((err: any) => {
        unprepared = sql`select 7 as n`.execute();
        mock.release();
        return err.code;
      });

      expect({
        rejection,
        results: await settle([next, unprepared]),
        connections: mock.connections(),
      }).toEqual({
        rejection: "ERR_MYSQL_INVALID_BINARY_VALUE",
        results: [[{ n: 6 }], [{ n: 7 }]],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });
});

// MariaDB has no JSON type. A JSON column is LONGTEXT with a JSON_VALID check
// constraint, and a session can switch check constraints off. So a healthy
// MariaDB can send a JSON column that is not JSON. The gate on the container is
// the one in sql-mariadb-json.test.ts.
const mariadbProvided =
  !!process.env.BUN_TEST_SERVICE_mariadb_plain || !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled());
if (!mariadbProvided) {
  describe.todo("mariadb");
} else {
  describeWithContainer("mariadb", { image: "mariadb_plain" }, container => {
    test("a JSON column that is not JSON rejects only the query that reads it", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE ${sql(table)} (id INT, doc JSON)`;
      await sql`SET SESSION check_constraint_checks = 0`.simple();
      await sql`INSERT INTO ${sql(table)} VALUES (1, '{"a":1}'), (2, '{not json'), (3, '{"b":2}')`;

      // One statement text. After this first run it is prepared, so the three
      // executions below are all written before the first reply arrives.
      const from = (id: number) => sql`SELECT id, doc FROM ${sql(table)} WHERE id >= ${id} ORDER BY id`;
      await from(3);
      expect(await settle([from(3), from(1), from(3)])).toEqual([
        [{ id: 3, doc: { b: 2 } }],
        notJson,
        [{ id: 3, doc: { b: 2 } }],
      ]);

      // The same over the text protocol, where nothing is pipelined.
      expect(
        await settle([
          sql`SELECT id, doc FROM ${sql(table)} ORDER BY id`.simple(),
          sql`SELECT id, doc FROM ${sql(table)} WHERE id = 3`.simple(),
        ]),
      ).toEqual([notJson, [{ id: 3, doc: { b: 2 } }]]);

      // A temporary table lives and dies with its connection.
      expect([...(await from(3))]).toEqual([{ id: 3, doc: { b: 2 } }]);
    });
  });
}
