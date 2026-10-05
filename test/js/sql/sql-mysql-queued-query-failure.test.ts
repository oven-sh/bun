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
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";

const thrown = new Error("boom from toJSON");
const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
const rejectedWith = (properties: object) => ({ rejected: expect.objectContaining(properties) });
const overflow = rejectedWith({ code: "ERR_MYSQL_OVERFLOW" });
const bigint = rejectedWith({ message: "JSON.stringify cannot serialize BigInt." });
const throwing = (value: unknown) => ({
  toJSON() {
    throw value;
  },
});

// Each parameter makes COM_STMT_EXECUTE fail on the client.
const failures: [name: string, parameter: () => unknown, outcome: unknown][] = [
  ["a parameter whose toJSON throws", () => throwing(thrown), { rejected: thrown }],
  ["a parameter that holds a BigInt", () => ({ id: 10n }), bigint],
  ["a parameter that holds itself", () => cyclic, rejectedWith({ message: expect.stringContaining("cyclic") })],
  ["a Date that DATETIME cannot hold", () => new Date(8.64e15), rejectedWith({ code: "ERR_INVALID_ARG_TYPE" })],
  ["a parameter too large for one packet", () => Buffer.alloc(0xffffff, 0x41), overflow],
];

// 1 command byte + 0xffffff bytes of text: one byte more than a packet holds.
const oversizedText = () => Buffer.alloc(0xffffff, "-").toString();

// The rows of SHOW SESSION STATUS as { name: number }. An outcome that is not
// rows stays as it is, so that the assertion shows it.
const counts = (rows: unknown) =>
  Array.isArray(rows) ? Object.fromEntries(rows.map(row => [row.Variable_name, Number(row.Value)])) : rows;

// Starts `queries` in one tick, in order, and closes the connection. close()
// waits until every query has settled, for five seconds at most, and then
// rejects the rest with ERR_MYSQL_CONNECTION_CLOSED. So a query that never
// settles fails the assertion of its test.
async function settle(sql: SQL, queries: (SQL.Query<any> | Promise<unknown>)[]) {
  const outcomes: unknown[] = queries.map(() => "pending");
  queries.forEach((query, i) =>
    ("execute" in query ? query.execute() : query).then(
      rows => (outcomes[i] = rows),
      reason => (outcomes[i] = { rejected: reason }),
    ),
  );
  await sql.close({ timeout: 5 });
  return outcomes;
}

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  const url = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;

  // `marker(n)` selects n, so a reply that goes to the wrong query is visible.
  // The connection has prepared the statement: every `marker(n)` is ready to
  // be written when its turn comes.
  async function connect() {
    await container.ready;
    const sql = new SQL({ url: url(), max: 1 });
    const marker = (n: number) => sql`SELECT ${n} AS marker`;
    await marker(0);
    // The commands that the server has received on this connection. A simple
    // query reads them, so the read does not count.
    const commands = () =>
      sql.unsafe("SHOW SESSION STATUS WHERE Variable_name IN ('Com_stmt_prepare', 'Com_stmt_execute')").simple();
    return { sql, marker, commands, before: counts(await commands()) };
  }

  test.each(failures)("%s rejects the query and the queries behind it run in order", async (_, parameter, rejected) => {
    const { sql, marker, commands, before } = await connect();
    const bad = () => sql`SELECT ${parameter()} AS v`;

    // The first `bad` prepares the statement and the second one shares it.
    // Both wait in the queue for the prepare.
    const [first, second, one, two, after] = await settle(sql, [bad(), bad(), marker(1), marker(2), commands()]);
    expect({ first, second, one, two, after: counts(after) }).toEqual({
      first: rejected,
      second: rejected,
      one: [{ marker: 1 }],
      two: [{ marker: 2 }],
      // One prepare for `bad`, and an execute for each marker only.
      after: { Com_stmt_prepare: before.Com_stmt_prepare + 1, Com_stmt_execute: before.Com_stmt_execute + 2 },
    });
  });

  test.each<[string, unknown]>([
    ["an Error", thrown],
    ["a string", "boom"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("a parameter whose toJSON throws %s rejects the query with that value", async (_, value) => {
    const { sql, marker } = await connect();

    const [outcome, next] = await settle(sql, [sql`SELECT ${throwing(value)} AS v`, marker(1)]);
    expect({ outcome, same: Object.is((outcome as { rejected?: unknown })?.rejected, value), next }).toEqual({
      outcome: { rejected: value },
      same: true,
      next: [{ marker: 1 }],
    });
  });

  test("a query text too large for one packet rejects the query and the queries behind it run in order", async () => {
    const { sql, marker } = await connect();

    // marker(1) is running, so the queries behind it wait in the queue. The
    // first oversized text goes out as COM_QUERY, the second one as
    // COM_STMT_PREPARE, which reports the failure with no code (#43993).
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
      rejectedWith({ message: expect.stringContaining("failed to prepare query") }),
      [{ marker: 2 }],
      [{ marker: 3 }],
    ]);
  });

  test("a failed prepare rejects every query that shares the statement", async () => {
    const { sql, marker } = await connect();
    const table = "no_such_table_" + randomUUIDv7("hex").replaceAll("-", "");
    const missing = () => sql`SELECT * FROM ${sql(table)} WHERE id = ${1}`;
    const noSuchTable = rejectedWith({ errno: 1146 });

    expect(await settle(sql, [missing(), missing(), missing(), marker(1), marker(2)])).toEqual([
      noSuchTable,
      noSuchTable,
      noSuchTable,
      [{ marker: 1 }],
      [{ marker: 2 }],
    ]);
  });

  test("a query that fails behind a running query does not take its reply", async () => {
    const { sql, marker } = await connect();
    const table = "no_such_table_" + randomUUIDv7("hex").replaceAll("-", "");
    const missing = () => sql`SELECT * FROM ${sql(table)} WHERE id = ${1}`;
    const noSuchTable = rejectedWith({ errno: 1146 });

    // marker(1) is written when the prepare has failed. The two queries that
    // share the failed statement fail behind it, while it is running.
    expect(await settle(sql, [missing(), marker(1), missing(), missing(), marker(2), marker(3)])).toEqual([
      noSuchTable,
      [{ marker: 1 }],
      noSuchTable,
      noSuchTable,
      [{ marker: 2 }],
      [{ marker: 3 }],
    ]);
  });

  test("a transaction whose query fails in the queue rejects, and the pool runs the next query", async () => {
    const { sql, marker } = await connect();

    expect(await settle(sql, [sql.begin(tx => tx`SELECT ${{ id: 10n }} AS v`), marker(1)])).toEqual([
      bigint,
      [{ marker: 1 }],
    ]);
  });

  test.each<[string, (sql: SQL) => SQL.Query<any>, unknown]>([
    ["a parameter too large for one packet", sql => sql`SELECT ${Buffer.alloc(0xffffff, 0x41)} AS v`, overflow],
    [
      "a wrong number of parameters",
      sql => sql.unsafe("SELECT ? AS a, ? AS b", [1]),
      rejectedWith({ code: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED" }),
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

  // The rejected queries send nothing, so no reply comes back after them.
  test("a script whose last queries were rejected in the queue exits on its own", async () => {
    await container.ready;
    const script = `
      const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
      const bad = () => sql\`SELECT \${{ id: 10n }} AS v\`.then(() => "resolved", e => e.message);
      console.log(JSON.stringify(await Promise.all([bad(), bad()])));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, MYSQL_URL: url() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is here so that a failure shows it. A sanitizer build can write to it.
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: JSON.stringify(Array(2).fill("JSON.stringify cannot serialize BigInt.")) + "\n",
      stderr: expect.any(String),
      exitCode: 0,
      signalCode: null,
    });
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
