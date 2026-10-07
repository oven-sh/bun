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

  // A connection has one query on the wire at a time. The queries behind it
  // wait in the queue, and nothing of them is written. cancel() rejects such a
  // query and the connection never writes it. cancel() used to do nothing: the
  // query was written when its turn came, and it resolved with its rows.
  const cancelled = rejectedWith({ code: "ERR_MYSQL_QUERY_CANCELLED", message: "Query cancelled" });

  // A table that only this connection sees. Its rows show which INSERTs the
  // server ran. The connection has prepared the statement of `insert(id)`.
  async function connectWithTable() {
    const { sql, marker } = await connect();
    const table = "cancel_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(`CREATE TEMPORARY TABLE ${table} (id INT PRIMARY KEY)`);
    const insert = (id: number) => sql`INSERT INTO ${sql(table)} (id) VALUES (${id})`;
    await insert(0);
    const rows = () => sql.unsafe(`SELECT id FROM ${table} ORDER BY id`);
    return { sql, marker, table, insert, rows };
  }

  // An INSERT of row 1, and the first command that the connection writes for it.
  const kinds: [name: string, command: string, start: (sql: SQL, table: string) => SQL.Query<any>][] = [
    ["a simple query", "COM_QUERY", (sql, table) => sql.unsafe(`INSERT INTO ${table} (id) VALUES (1)`)],
    [
      "a query on a prepared statement",
      "COM_STMT_EXECUTE",
      (sql, table) => sql`INSERT INTO ${sql(table)} (id) VALUES (${1})`,
    ],
    [
      "a query on a statement that is not prepared",
      "COM_STMT_PREPARE",
      (sql, table) => sql`INSERT INTO ${sql(table)} (id) VALUES (${1} + 0)`,
    ],
  ];

  test.each(kinds)(
    "cancel() rejects %s that waits in the queue, and the server never runs it",
    async (_, __, start) => {
      const { sql, marker, table, insert, rows } = await connectWithTable();
      const order: string[] = [];
      const note = (name: string) => () => void order.push(name);

      // `running` is on the wire, and `query` waits behind it.
      const running = marker(1).execute();
      const query = start(sql, table).execute();
      running.then(note("running"), note("running"));
      query.then(note("cancelled"), note("cancelled"));
      expect(query.cancel()).toBe(query);

      const [first, outcome, next, inserted] = await settle(sql, [running, query, insert(2), rows()]);
      expect({ cancelled: query.cancelled, first, outcome, next, inserted, order }).toEqual({
        cancelled: true,
        first: [{ marker: 1 }],
        outcome: cancelled,
        next: [],
        inserted: [{ id: 0 }, { id: 2 }],
        // The query rejects at once. It does not wait for its turn.
        order: ["cancelled", "running"],
      });
    },
  );

  // The connection is idle, so the call that starts a query writes that
  // command. MySQL stops a query that it has only with KILL QUERY on a second
  // connection.
  test.each(kinds)("cancel() does not stop %s that wrote its %s", async (_, __, start) => {
    const { sql, marker, table, rows } = await connectWithTable();

    const query = start(sql, table).execute();
    query.cancel();

    const [outcome, next, inserted] = await settle(sql, [query, marker(1), rows()]);
    expect({ cancelled: query.cancelled, outcome, next, inserted }).toEqual({
      cancelled: true,
      outcome: [],
      next: [{ marker: 1 }],
      inserted: [{ id: 0 }, { id: 1 }],
    });
  });

  // The first query writes the COM_STMT_PREPARE of a statement. A second query
  // with the same text shares the statement, and writes nothing until the
  // server answers.
  test("cancel() rejects a query that waits for a statement that another query prepares", async () => {
    const { sql, table, rows } = await connectWithTable();
    const insert = (id: number) => sql`INSERT INTO ${sql(table)} (id) VALUES (${id} + 0)`;
    const order: string[] = [];
    const note = (name: string) => () => void order.push(name);

    const first = insert(1).execute();
    const second = insert(2).execute();
    first.then(note("first"), note("first"));
    second.then(note("cancelled"), note("cancelled"));
    second.cancel();

    const [one, two, inserted] = await settle(sql, [first, second, rows()]);
    expect({ one, two, inserted, order }).toEqual({
      one: [],
      two: cancelled,
      inserted: [{ id: 0 }, { id: 1 }],
      order: ["cancelled", "first"],
    });
  });

  // The connection reads the values of a query when it looks for the statement
  // of the query, and again when it writes the COM_STMT_EXECUTE. Each read runs
  // the getters of the values. The connection is encoding the query then, and
  // writes it next, so cancel() from a getter does nothing.
  test.each([
    ["looks for its statement", { prepared: false, cancelAt: 1, inFront: 0 }],
    ["writes it in the call that starts it", { prepared: true, cancelAt: 2, inFront: 0 }],
    ["writes it from the queue", { prepared: true, cancelAt: 2, inFront: 1 }],
  ])(
    "cancel() from a getter of the values of a query does nothing when the connection %s",
    async (_, { prepared, cancelAt, inFront }) => {
      const { sql, marker } = await connect();
      if (prepared) await sql.unsafe("SELECT ? AS v", [1]);

      let reads = 0;
      const values = Object.defineProperty([], 0, {
        get() {
          if (++reads === cancelAt) query.cancel();
          return 1;
        },
      });
      const query: SQL.Query<any> = sql.unsafe("SELECT ? AS v", values);
      const front = inFront ? [marker(1)] : [];
      const outcomes = await settle(sql, [...front, query, marker(2)]);
      const [outcome, next] = outcomes.slice(front.length);
      expect({ cancelled: query.cancelled, outcome, next, reads }).toEqual({
        cancelled: true,
        outcome: [{ v: 1 }],
        next: [{ marker: 2 }],
        reads: 2,
      });
    },
  );

  test("a cancelled query of a transaction does not run, and the transaction commits the other queries", async () => {
    const { sql, table, rows } = await connectWithTable();
    const insert = (tx: SQL, id: number) => tx`INSERT INTO ${tx(table)} (id) VALUES (${id})`;

    const outcomes = await sql.begin(async tx => {
      const first = insert(tx, 1).execute();
      const second = insert(tx, 2).execute();
      second.cancel();
      return [await first, await second.catch(reason => ({ rejected: reason })), await insert(tx, 3)];
    });
    expect({ outcomes, inserted: await rows() }).toEqual({
      outcomes: [[], cancelled, []],
      inserted: [{ id: 0 }, { id: 1 }, { id: 3 }],
    });
    await sql.close();
  });

  const settled = (promise: Promise<unknown>) =>
    promise.then(
      value => ({ resolved: value }),
      reason => ({ rejected: reason }),
    );

  // `hold(sql)` starts a query that stays on the wire: the server waits in
  // GET_LOCK for a lock that a second connection holds, until `release()`.
  async function lock() {
    await container.ready;
    const holder = new SQL({ url: url(), max: 1 });
    const name = randomUUIDv7("hex").replaceAll("-", "");
    await holder.unsafe(`SELECT GET_LOCK('${name}', 0)`);
    return {
      hold: (sql: SQL) => void settled(sql.unsafe(`SELECT GET_LOCK('${name}', 10)`).execute()),
      release: () => holder.unsafe(`SELECT RELEASE_LOCK('${name}')`),
      // Every promise reaction that was ready before this round trip has run when it resolves.
      roundTrip: () => holder.unsafe("SELECT 1"),
      [Symbol.asyncDispose]: () => holder.close(),
    };
  }
  const insertInto = (table: string) => (tx: SQL, id: number) =>
    tx.unsafe(`INSERT INTO ${table} (id) VALUES (?)`, [id]);

  // begin() sends BEGIN, COMMIT and ROLLBACK by itself. They are queries of the
  // transaction, and they wait in the queue like the queries of the caller.
  // close() cancels the queries of the caller and leaves those. begin() gives
  // the connection back to the pool when its COMMIT or ROLLBACK settles, and a
  // cancelled one settles with the connection still inside the transaction.
  const failure = new Error("from the callback");
  test.each<[string, () => string, unknown, { id: number }[]]>([
    ["COMMIT", () => "returned", { resolved: "returned" }, [{ id: 0 }, { id: 1 }, { id: 100 }]],
    [
      "ROLLBACK",
      () => {
        throw failure;
      },
      { rejected: failure },
      [{ id: 0 }, { id: 100 }],
    ],
  ])("close() of a transaction does not cancel the %s of begin()", async (_, end, outcome, inserted) => {
    const { sql, table, insert, rows } = await connectWithTable();
    await using gate = await lock();
    const ended = Promise.withResolvers<() => Promise<void>>();

    const transaction = settled(
      sql.begin(async tx => {
        await insertInto(table)(tx, 1);
        // On the wire when the callback ends: the COMMIT or ROLLBACK of begin() waits behind it.
        gate.hold(tx);
        ended.resolve(() => tx.close());
        return end();
      }),
    );
    const close = await ended.promise;
    // Another caller. The pool has one connection, and the transaction holds it.
    const other = insert(100).execute();
    await gate.roundTrip();
    const closed = close();
    await gate.release();

    expect({ outcome: await transaction, other: await other, closed: await closed, inserted: await rows() }).toEqual({
      outcome,
      other: [],
      closed: undefined,
      // The INSERT of the other caller ran after the transaction ended.
      inserted,
    });
    await sql.close();
  });

  test("close({ timeout }) of a transaction cancels the queries of the caller, and not the COMMIT of begin()", async () => {
    const { sql, table, rows } = await connectWithTable();
    await using gate = await lock();
    const insert = insertInto(table);
    const queued = Promise.withResolvers<unknown>();
    const closed = Promise.withResolvers<unknown>();

    const outcome = settled(
      sql.begin(async tx => {
        await insert(tx, 1);
        gate.hold(tx);
        // Waits behind the held query.
        queued.resolve(settled(insert(tx, 2).execute()));
        // Not awaited. The callback returns, and the COMMIT of begin() is in the
        // queue when the timer fires.
        closed.resolve(tx.close({ timeout: 0.001 }));
        return "returned";
      }),
    );

    // The timer has fired when the query of the caller rejects.
    expect(await queued.promise).toEqual(cancelled);
    await gate.release();
    expect({ outcome: await outcome, closed: await closed.promise, inserted: await rows() }).toEqual({
      outcome: { resolved: "returned" },
      closed: undefined,
      inserted: [{ id: 0 }, { id: 1 }],
    });
    await sql.close();
  });

  test("close() of a transaction does not cancel a COMMIT that begin() has made and not started", async () => {
    const { sql, table, rows } = await connectWithTable();
    const returned = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<{ close: () => Promise<void>; inserted: Promise<unknown> }>();

    // Not an async function: begin() waits for `returned.promise` itself, so
    // the reaction of begin() is the first one on it.
    const outcome = settled(
      sql.begin(tx => {
        entered.resolve({ close: () => tx.close(), inserted: insertInto(table)(tx, 1).execute() });
        return returned.promise;
      }),
    );
    const { close, inserted } = await entered.promise;
    await inserted;
    // This reaction runs after the one of begin(). begin() has made its COMMIT,
    // and the COMMIT has not reached the connection.
    const closed = returned.promise.then(close);
    returned.resolve("returned");

    expect({ outcome: await outcome, closed: await closed, inserted: await rows() }).toEqual({
      outcome: { resolved: "returned" },
      closed: undefined,
      inserted: [{ id: 0 }, { id: 1 }],
    });
    await sql.close();
  });

  // Runs `script` in a process of its own. stderr is here so that a failure
  // shows it. A sanitizer build can write to it.
  async function run(script: string, env: Record<string, string> = {}) {
    await container.ready;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, MYSQL_URL: url(), ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }
  const exited = (stdout: unknown) => ({
    stdout: JSON.stringify(stdout) + "\n",
    stderr: expect.any(String),
    exitCode: 0,
    signalCode: null,
  });

  // close() cancels the queries of its scope, at once or when its timeout
  // ends. The caller handles the rejection of every query here, so the process
  // has no unhandled rejection and exits with 0.
  const closeScript = `
    const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
    const holder = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
    const lock = "('" + process.env.LOCK + "'";
    const options = process.env.TIMEOUT ? { timeout: Number(process.env.TIMEOUT) } : undefined;
    const settled = query => query.execute().then(() => "resolved", error => error.code);
    await holder.unsafe("SELECT GET_LOCK" + lock + ", 0)");

    // One query on the wire until the lock is free, and one query behind it.
    async function close(scope) {
      const held = settled(scope.unsafe("SELECT GET_LOCK" + lock + ", 10)"));
      const queued = settled(scope.unsafe("SELECT 1"));
      const closed = scope.close(options);
      const outcome = await queued;
      await holder.unsafe("SELECT RELEASE_LOCK" + lock + ")");
      await closed;
      return [await held, outcome];
    }
    let outcomes;
    if (process.env.SCOPE === "reserved") outcomes = await close(await sql.reserve());
    else await sql.begin(async tx => void (outcomes = await close(tx))).catch(() => {});
    console.log(JSON.stringify(outcomes));
    await Promise.all([sql.close(), holder.close()]);
  `;
  const afterRollback = ["resolved", "ERR_MYSQL_QUERY_CANCELLED"];
  const afterDisconnect = ["ERR_MYSQL_CONNECTION_CLOSED", "ERR_MYSQL_QUERY_CANCELLED"];
  test.each([
    ["close() of a transaction", { SCOPE: "transaction", TIMEOUT: "" }, afterRollback],
    ["close({ timeout }) of a transaction", { SCOPE: "transaction", TIMEOUT: "0.001" }, afterRollback],
    ["close() of a reserved connection", { SCOPE: "reserved", TIMEOUT: "" }, afterDisconnect],
    ["close({ timeout }) of a reserved connection", { SCOPE: "reserved", TIMEOUT: "0.001" }, afterDisconnect],
  ])("%s rejects the query that waits in the queue, and the script exits with 0", async (_, env, outcomes) => {
    const LOCK = randomUUIDv7("hex").replaceAll("-", "");
    expect(await run(closeScript, { ...env, LOCK })).toEqual(exited(outcomes));
  });

  // The cancelled query sends nothing, so no reply comes back for it.
  test("a script whose last query was cancelled in the queue exits on its own", async () => {
    const script = `
      const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
      const value = n => sql\`SELECT \${n} AS value\`;
      await value(0);
      const running = value(1).execute();
      const last = value(2).execute();
      last.cancel();
      console.log(JSON.stringify([await running, await last.catch(error => error.code)]));
    `;
    expect(await run(script)).toEqual(exited([[{ value: 1 }], "ERR_MYSQL_QUERY_CANCELLED"]));
  });
});
