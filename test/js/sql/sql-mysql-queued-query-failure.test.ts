// A MySQL connection answers its queries in the order it received them, so the
// client keeps them in a queue and gives each reply to the query at the head.
// The queue also writes the queries that could not go out at once: a statement
// that waits for its COM_STMT_PREPARE, a query behind a query that is running.
//
// Writing a query can fail on the client: a parameter throws while it is
// serialized, the packet is too large to frame, the statement it shares failed
// to prepare. When that happened to a query in the queue:
// - its promise never settled, and
// - the queue skipped the query behind it and wrote the one after that. The
//   skipped query then got that query's reply, and that query got none.
import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  mysqlTextResultSet,
} from "./wire-frames";

const thrown = new Error("boom from toJSON");
const overflow = { rejected: expect.objectContaining({ code: "ERR_MYSQL_OVERFLOW" }) };

// Each parameter makes COM_STMT_EXECUTE fail on the client.
const failures: [name: string, parameter: () => unknown, outcome: unknown][] = [
  [
    "a parameter whose toJSON throws",
    () => ({
      toJSON() {
        throw thrown;
      },
    }),
    { rejected: thrown },
  ],
  ["a parameter too large for one packet", () => Buffer.alloc(0xffffff, 0x41), overflow],
];

// 1 command byte + 0xffffff bytes of text: one byte more than a packet holds.
const oversizedText = () => Buffer.alloc(0xffffff, "-").toString();

// Starts `queries` in one tick, in order, and closes the connection. close()
// waits until every query has settled, for five seconds at most, and then
// rejects the rest with ERR_MYSQL_CONNECTION_CLOSED. So a query that never
// settles fails the assertion of its test.
async function settle(sql: SQL, queries: SQL.Query<any>[]) {
  const outcomes: unknown[] = queries.map(() => "pending");
  queries.forEach((query, i) =>
    query.execute().then(
      rows => (outcomes[i] = rows),
      reason => (outcomes[i] = { rejected: reason }),
    ),
  );
  await sql.close({ timeout: 5 });
  return outcomes;
}

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  // `marker(n)` selects n, so a reply that goes to the wrong query is visible.
  // The connection has prepared the statement: every `marker(n)` is ready to
  // be written when its turn comes.
  async function connect() {
    await container.ready;
    const sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    const marker = (n: number) => sql`SELECT ${n} AS marker`;
    await marker(0);
    return { sql, marker };
  }

  test.each(failures)("%s rejects the query and the queries behind it run in order", async (_, parameter, rejected) => {
    const { sql, marker } = await connect();
    const bad = () => sql`SELECT ${parameter()} AS v`;

    // The first `bad` prepares the statement and the second one shares it.
    // Both wait in the queue for the prepare.
    expect(await settle(sql, [bad(), bad(), marker(1), marker(2)])).toEqual([
      rejected,
      rejected,
      [{ marker: 1 }],
      [{ marker: 2 }],
    ]);
  });

  test("a query text too large for one packet rejects the query and the queries behind it run in order", async () => {
    const { sql, marker } = await connect();

    // marker(1) is running, so the queries behind it wait in the queue. The
    // first oversized text goes out as COM_QUERY, the second one as
    // COM_STMT_PREPARE, which reports the failure with no code.
    expect(
      await settle(sql, [
        marker(1),
        sql.unsafe(oversizedText()),
        sql.unsafe(oversizedText(), [1]),
        marker(2),
        marker(3),
      ]),
    ).toEqual([
      [{ marker: 1 }],
      overflow,
      { rejected: expect.objectContaining({ message: expect.stringContaining("failed to prepare query") }) },
      [{ marker: 2 }],
      [{ marker: 3 }],
    ]);
  });

  test("a failed prepare rejects every query that shares the statement", async () => {
    const { sql, marker } = await connect();
    const table = "no_such_table_" + randomUUIDv7("hex").replaceAll("-", "");
    const missing = () => sql`SELECT * FROM ${sql(table)} WHERE id = ${1}`;
    const noSuchTable = { rejected: expect.objectContaining({ errno: 1146 }) };

    expect(await settle(sql, [missing(), missing(), missing(), marker(1), marker(2)])).toEqual([
      noSuchTable,
      noSuchTable,
      noSuchTable,
      [{ marker: 1 }],
      [{ marker: 2 }],
    ]);
  });

  test.each<[string, (sql: SQL) => SQL.Query<any>, unknown]>([
    ["a parameter too large for one packet", sql => sql`SELECT ${Buffer.alloc(0xffffff, 0x41)} AS v`, overflow],
    [
      "a wrong number of parameters",
      sql => sql.unsafe("SELECT ? AS a, ? AS b", [1]),
      { rejected: expect.objectContaining({ code: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED" }) },
    ],
  ])("%s rejects a lone query, and close() with no timeout returns", async (_, query, rejected) => {
    const { sql } = await connect();
    let outcome: unknown = "pending";
    query(sql)
      .execute()
      .then(
        () => (outcome = "resolved"),
        reason => (outcome = { rejected: reason }),
      );

    // close() with no timeout returns when every query has settled.
    await sql.close();
    expect(outcome).toEqual(rejected);
  });

  // Built-in JS runs a handle one time only. This test reaches the handle as
  // sql-mysql-clean-reentry.test.ts does and runs it again.
  test("a handle whose write failed in the call that started it is complete when it runs again", async () => {
    const { sql, marker } = await connect();
    const select = (parameter: Buffer) => sql`SELECT ${parameter} AS v`;
    // The statement is prepared and the connection is idle, so the call that
    // starts the next query writes it.
    await select(Buffer.alloc(1, 0x41));

    const query: any = select(Buffer.alloc(0xffffff, 0x41));
    query.raw(); // creates the handle
    const handle = query[Object.getOwnPropertySymbols(query).find(symbol => symbol.description === "handle")!];
    const run = Object.getPrototypeOf(handle).run;
    let connection: unknown;
    Object.defineProperty(handle, "run", {
      configurable: true,
      writable: true,
      value(...args: unknown[]) {
        connection = args[0];
        return run.apply(this, args);
      },
    });
    const first = await query.then(
      () => "resolved",
      (reason: unknown) => ({ rejected: reason }),
    );
    run.call(handle, connection, query);

    expect({ first, next: await settle(sql, [marker(1)]) }).toEqual({ first: overflow, next: [[{ marker: 1 }]] });
  });
});

// The mock shows what a real server cannot: the commands that reach the wire.
// A rejected query must send nothing.
describe("mysql (mock server)", () => {
  const commands: Record<number, string> = { 0x03: "COM_QUERY", 0x16: "COM_STMT_PREPARE", 0x17: "COM_STMT_EXECUTE" };

  // Prepares every statement with one parameter and no columns. Answers a
  // COM_QUERY with one row that holds the query text, so a reply that goes to
  // the wrong query is visible. Records the commands it receives.
  async function mockServer() {
    const received: string[] = [];
    const { port, server } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let authed = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            authed = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (mysqlAckSessionSetup(socket, payload)) return;
          const command = commands[payload[0]];
          received.push(command ?? `0x${payload[0].toString(16)}`);
          if (command === "COM_STMT_PREPARE") {
            socket.write(
              Buffer.concat([mysqlStmtPrepareOk(1, 1, 0, 1), mysqlColumnDefinition(2, { name: "?", type: 0xfd })]),
            );
          } else if (command === "COM_QUERY") {
            socket.write(mysqlTextResultSet(1, [{ name: "text", type: 0xfd }], [[payload.subarray(1).toString()]]));
          } else {
            socket.end();
          }
        });
      });
      socket.on("error", () => {});
    });
    return { port, server, received };
  }

  // A query with no parameters goes out as COM_QUERY.
  async function connect(port: number) {
    const sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const marker = (n: number) => sql.unsafe(`SELECT ${n}`);
    await marker(0);
    return { sql, marker };
  }

  test.each(failures)("%s rejects the query and sends no COM_STMT_EXECUTE", async (_, parameter, rejected) => {
    const { port, server, received } = await mockServer();
    try {
      const { sql, marker } = await connect(port);
      const bad = () => sql.unsafe("SELECT ?", [parameter()]);

      expect({ outcomes: await settle(sql, [bad(), bad(), marker(1), marker(2)]), received }).toEqual({
        outcomes: [rejected, rejected, [{ text: "SELECT 1" }], [{ text: "SELECT 2" }]],
        received: ["COM_QUERY", "COM_STMT_PREPARE", "COM_QUERY", "COM_QUERY"],
      });
    } finally {
      server.close();
    }
  });

  test.each<[string, unknown]>([
    ["an Error", new Error("boom")],
    ["a string", "boom"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("a parameter whose toJSON throws %s rejects the query with that value", async (_, thrown) => {
    const { port, server } = await mockServer();
    try {
      const { sql, marker } = await connect(port);
      const bad = sql.unsafe("SELECT ?", [
        {
          toJSON() {
            throw thrown;
          },
        },
      ]);

      const [outcome, next] = await settle(sql, [bad, marker(1)]);
      expect({ outcome, same: Object.is((outcome as { rejected?: unknown })?.rejected, thrown), next }).toEqual({
        outcome: { rejected: thrown },
        same: true,
        next: [{ text: "SELECT 1" }],
      });
    } finally {
      server.close();
    }
  });
});
