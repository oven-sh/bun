// A result row can be framed correctly and still hold a value this client
// cannot turn into a JS value: a JSON column whose text `JSON.parse` refuses
// (MariaDB accepts some), a binary DATE with a length no server sends. That is
// the failure of the query that asked for the row, and the server keeps
// answering that query: more rows, the terminator, further result sets of a
// CALL or a multi-statement string.
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
const moreResults = MYSQL_SERVER_STATUS_AUTOCOMMIT | MYSQL_SERVER_MORE_RESULTS_EXISTS;

/** One result set with one column: its name, then one cell per row. A number is a LONG, a string is the text of a JSON column. */
type ResultSet = [column: string, ...cells: (number | string)[]];

/**
 * One response: result sets back to back, over the text protocol (`simple`) or
 * the binary one. Every terminator but the last says that another result set
 * follows. With `serverError` they all say so, and an ERR packet ends the
 * response, as when a later statement of a CALL fails.
 */
function response(simple: boolean, sets: ResultSet[], serverError = false): Buffer {
  let seq = 1;
  const frames = sets.map(([name, ...cells], i) => {
    const columns = [{ name, type: typeof cells[0] === "number" ? MYSQL_TYPE_LONG : MYSQL_TYPE_JSON }];
    const statusFlags = serverError || i + 1 < sets.length ? moreResults : undefined;
    const startSeq = seq;
    seq += 3 + cells.length; // the column count, the column, the rows, the terminator
    return simple
      ? mysqlTextResultSet(
          startSeq,
          columns,
          cells.map(cell => [String(cell)]),
          statusFlags,
        )
      : mysqlBinaryResultSet(
          startSeq,
          columns,
          cells.map(cell => [typeof cell === "number" ? mysqlBinaryLong(cell) : mysqlLenencStr(cell)]),
          statusFlags,
        );
  });
  if (serverError) frames.push(mysqlErrPacket(seq, 1146, "42S02", "Table 'db.missing' doesn't exist"));
  return Buffer.concat(frames);
}

/** The response to `select <n> as n`. */
const numberRow = (n: number, simple = false) => [response(simple, [["n", n]])];

const date = [{ name: "d", type: MYSQL_TYPE_DATE }];
// The length byte of a binary DATE is 0, 4, 7 or 11.
const undecodableDate = mysqlBinaryDate(2024, 6, 15, 5);
// A CALL whose first result set has a row the client cannot decode between two
// rows it can. A second result set follows: 3 rows + 3 sequence ids later.
const callBad = Buffer.concat([
  mysqlBinaryResultSet(
    1,
    date,
    [[mysqlBinaryDate(2024, 6, 14)], [undecodableDate], [mysqlBinaryDate(2024, 6, 16)]],
    moreResults,
  ),
  mysqlBinaryResultSet(7, [{ name: "leftover", type: MYSQL_TYPE_LONG }], [[mysqlBinaryLong(777)]]),
]);
const undecodable = { name: "MySQLError", code: "ERR_MYSQL_INVALID_BINARY_VALUE", message: expect.any(String) };
const notJson = { name: "SyntaxError", message: "JSON Parse error: Expected '}'" };

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

  test("result sets that arrive after the rejection stay with the rejected query", async () => {
    const mock = await mockServer({
      "call bad()": [
        mysqlBinaryResultSet(1, date, [[undecodableDate]], moreResults),
        response(false, [["leftover", 777]]),
      ],
      "select 3 as n": numberRow(3),
      "select 4 as n": numberRow(4),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
      await sql`select 3 as n`;

      // execute() sends a query at once, so these two are pipelined in this order.
      const bad = sql`call bad()`.execute();
      const next = sql`select 3 as n`.execute();
      // `bad` rejects while the server still holds its second result set. The
      // handler queues a statement that is not prepared yet, then lets the
      // server continue. The held result set must not go to `next`, which is
      // the request behind the rejected one.
      let unprepared!: PromiseLike<any>;
      const rejection = await bad.catch((err: any) => {
        unprepared = sql`select 4 as n`.execute();
        mock.release();
        return err.code;
      });

      expect({
        rejection,
        results: await settle([next, unprepared]),
        connections: mock.connections(),
      }).toEqual({
        rejection: "ERR_MYSQL_INVALID_BINARY_VALUE",
        results: [[{ n: 3 }], [{ n: 4 }]],
        connections: 1,
      });
    } finally {
      mock.server.close();
    }
  });

  // The binary protocol (a prepared statement) and the text protocol (`.simple()`)
  // decode a row in different code, and count a running request differently.
  describe.each([
    ["prepared", false],
    ["simple", true],
  ] as const)("%s query", (_, simple) => {
    const run = (query: any) => (simple ? query.simple() : query);
    // Three queries behind `call docs()`. The first is already prepared, so a
    // prepared `call docs()` has it pipelined right behind. The other two can
    // only start when the connection no longer counts a request as in flight.
    const responses = {
      "select 5 as n": numberRow(5),
      "select 6 as n": numberRow(6),
      "select 7 as n": numberRow(7, true),
    };
    const others = (sql: SQL) => [sql`select 5 as n`, sql`select 6 as n`, sql`select 7 as n`.simple()];
    const ownRows = [[{ n: 5 }], [{ n: 6 }], [{ n: 7 }]];

    test("a JSON column that is not JSON rejects alone", async () => {
      const docs = response(simple, [
        ["doc", '{"a":1}', "{not json", '{"b":2}'],
        ["leftover", 777],
      ]);
      const mock = await mockServer({ "call docs()": [docs], ...responses });
      try {
        await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
        await sql`select 5 as n`;

        const results = await settle([run(sql`call docs()`), ...others(sql)]);
        results.push([...(await sql`select 5 as n`)]);
        expect({ results, connections: mock.connections() }).toEqual({
          results: [notJson, ...ownRows, [{ n: 5 }]],
          connections: 1,
        });
      } finally {
        mock.server.close();
      }
    });

    test("a bad row in the second of three result sets rejects alone", async () => {
      const docs = response(simple, [
        ["first", 1],
        ["doc", "{not json"],
        ["leftover", 777],
      ]);
      const mock = await mockServer({ "call docs()": [docs], ...responses });
      try {
        await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
        await sql`select 5 as n`;

        expect({
          results: await settle([run(sql`call docs()`), ...others(sql)]),
          connections: mock.connections(),
        }).toEqual({ results: [notJson, ...ownRows], connections: 1 });
      } finally {
        mock.server.close();
      }
    });

    test("a server error that ends the rejected query's response is not delivered", async () => {
      const mock = await mockServer({ "call docs()": [response(simple, [["doc", "{not json"]], true)], ...responses });
      try {
        await using sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });
        await sql`select 5 as n`;

        expect({
          results: await settle([run(sql`call docs()`), ...others(sql)]),
          connections: mock.connections(),
        }).toEqual({ results: [notJson, ...ownRows], connections: 1 });
      } finally {
        mock.server.close();
      }
    });
  });
});

// MariaDB has no JSON type. A JSON column is LONGTEXT with a JSON_VALID check
// constraint, and JSON_VALID accepts escapes that JSON.parse refuses. So a
// healthy MariaDB with default settings can send a JSON column that this client
// cannot parse. The gate on the container is the one in sql-mariadb-json.test.ts.
const mariadbProvided =
  !!process.env.BUN_TEST_SERVICE_mariadb_plain || !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled());
if (!mariadbProvided) {
  describe.todo("mariadb");
} else {
  describeWithContainer("mariadb", { image: "mariadb_plain" }, container => {
    test("a JSON column that JSON.parse refuses rejects only the query that reads it", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      const table = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
      await sql`CREATE TEMPORARY TABLE ${sql(table)} (id INT, doc JSON)`;
      for (const [id, doc] of ['{"a":1}', `{"name":"O\\'Brien"}`, '{"b":2}'].entries()) {
        await sql`INSERT INTO ${sql(table)} VALUES (${id + 1}, ${doc})`;
      }
      const refused = { name: "SyntaxError", message: "JSON Parse error: Invalid escape character '" };

      // One statement text. After this first run it is prepared, so the three
      // executions below are all written before the first reply arrives.
      const from = (id: number) => sql`SELECT id, doc FROM ${sql(table)} WHERE id >= ${id} ORDER BY id`;
      await from(3);
      expect(await settle([from(3), from(1), from(3)])).toEqual([
        [{ id: 3, doc: { b: 2 } }],
        refused,
        [{ id: 3, doc: { b: 2 } }],
      ]);

      // The same over the text protocol, where nothing is pipelined.
      expect(
        await settle([
          sql`SELECT id, doc FROM ${sql(table)} ORDER BY id`.simple(),
          sql`SELECT id, doc FROM ${sql(table)} WHERE id = 3`.simple(),
        ]),
      ).toEqual([refused, [{ id: 3, doc: { b: 2 } }]]);

      // A temporary table lives and dies with its connection.
      expect([...(await from(3))]).toEqual([{ id: 3, doc: { b: 2 } }]);
    });
  });
}
