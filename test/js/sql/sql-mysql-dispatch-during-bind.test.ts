// A MySQL connection answers its requests in the order it got them, and a reply carries no
// request id. The client gives each reply to the request at the head of its queue, so the
// order on the wire must be the order in the queue.
//
// The adapter converts the parameters of a query when it writes COM_STMT_EXECUTE. The
// conversion runs user JS: toString(), a getter of the values. A query that this JS started
// with execute() was written ahead of the query it started from, and queued behind it. Each
// of the two then got the rows of the other, or the connection closed with
// ERR_MYSQL_UNEXPECTED_PACKET. User JS that runs inside a reply had the same effect (#32005).
//
// The wire tests need a mock: only the server sees the order on the wire. All wire-protocol
// bytes come from test/js/sql/wire-frames.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";
import {
  mysqlBinaryResultSet,
  mysqlExecuteStringParameters,
  mysqlLenencStr,
  mysqlMockServer,
  mysqlStmtPrepareResponse,
  mysqlTextResultSet,
} from "./wire-frames";

// A debug build needs seconds to start a subprocess and to connect.
const timeout = 30_000;
// A scenario that hangs ends with its subprocess: the assertion then shows the lines that are not there.
const subprocessTimeout = 20_000;

const kinds = ["prepared statement", "first execution"];
const ok = (...rows: unknown[]) => ({ ok: rows });
const boom = { err: "boom" };
const closed = { err: "ERR_MYSQL_CONNECTION_CLOSED" };

// Runs the scenarios in one subprocess. Gives what each scenario printed, by name.
async function run(fixture: string, scenarios: string[], env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, fixture)],
    env: { ...bunEnv, ...env, SCENARIOS: JSON.stringify(scenarios) },
    stdout: "pipe",
    stderr: "pipe",
    timeout: subprocessTimeout,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout.split("\n").filter(line => line !== "");
  // What is not JSON stays as it is, so that the assertion shows it.
  const parsed = (line: string) => {
    try {
      return JSON.parse(line);
    } catch {
      return line;
    }
  };
  return {
    printed: Object.fromEntries(lines.map((line, i) => [scenarios[i] ?? `line ${i}`, parsed(line)])),
    // stderr is here so that a failure shows it. A sanitizer build can write to it.
    stderr,
    exitCode,
    signalCode: proc.signalCode,
  };
}
const exited = { stderr: expect.any(String), exitCode: 0, signalCode: null };

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  async function server(scenarios: Record<string, unknown>, env: Record<string, string> = {}) {
    await container.ready;
    const MYSQL_URL = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
    const names = Object.keys(scenarios);
    expect(await run("sql-mysql-dispatch-during-bind-fixture.ts", names, { ...env, MYSQL_URL })).toEqual({
      printed: scenarios,
      ...exited,
    });
  }
  const each = (scenarios: (kind: string) => Record<string, unknown>) =>
    Object.assign({}, ...kinds.map(kind => scenarios(kind)));

  // Every query gets its own rows, each parameter is converted one time, and the connection
  // stays open.
  const own = { outer: ok({ x: "1" }), conversions: 1, sameConnection: true };
  const y = ok({ y: 2 });

  test.concurrent.each(kinds)(
    "%s",
    kind =>
      server({
        [`${kind}, the conversion starts a query`]: { ...own, dispatched: [y] },
        [`${kind}, the conversion starts three queries`]: { ...own, dispatched: [y, y, y] },
        [`${kind}, then a query in the same tick`]: { ...own, next: ok({ z: 3 }), dispatched: [y] },
        // The query of the first read goes ahead of the outer query, on the wire and in the queue.
        [`${kind}, a getter of the values starts a query`]: {
          ...own,
          reads: 2,
          dispatched: [ok({ read_1: 1 }), ok({ read_2: 2 })],
          conversions: 0,
        },
        // The limit of the defect: main passes this one.
        [`${kind}, the conversion starts a query with then()`]: { ...own, dispatched: [y] },
      }),
    timeout,
  );

  test.concurrent.each(kinds)(
    "%s, started queries of other kinds",
    kind =>
      server({
        [`${kind}, the started query is a simple query`]: { ...own, dispatched: [y] },
        [`${kind}, the started query has a prepared statement`]: { ...own, dispatched: [y] },
        [`${kind}, the started query shares the statement`]: { ...own, dispatched: [ok({ x: "2" })] },
        [`${kind}, the started query starts a query from its conversion`]: {
          ...own,
          dispatched: [ok({ x: "2" }), ok({ z: 3 })],
          conversions: 2,
        },
      }),
    timeout,
  );

  test.concurrent(
    "queue order",
    () =>
      server({
        ...each(kind => ({
          [`${kind}, three queries in one tick, each conversion starts a query`]: {
            outers: [ok({ x: "a" }), ok({ x: "b" }), ok({ x: "c" })],
            dispatched: [ok({ y: "aa" }), ok({ y: "bb" }), ok({ y: "cc" })],
            conversions: 3,
            sameConnection: true,
          },
        })),
        // On an idle connection that has the statement, the call that starts the query
        // converts its parameters: the conversion runs before execute() returns.
        "the conversion runs inside execute()": { ...own, insideExecute: true, dispatched: [] },
      }),
    timeout,
  );

  // The pool has its default size here. On main the transaction stores "other again".
  test.concurrent(
    "a transaction and a reserved connection",
    () =>
      server({
        ...each(kind => ({
          [`${kind}, inside a transaction, the conversion starts a query`]: { ...own, dispatched: [y] },
          [`${kind}, on a reserved connection, the conversion starts a query`]: { ...own, dispatched: [y] },
        })),
        "inside a transaction, what a query reads goes into the table": {
          dispatched: [ok({ v: "other" })],
          rows: ok({ v: "warm" }, { v: "warm again" }),
          conversions: 1,
        },
      }),
    timeout,
  );

  // The outer query fails with nothing sent. The queries that its conversion started run.
  test.concurrent(
    "the conversion throws",
    () =>
      server(
        each(kind => ({
          [`${kind}, the conversion throws after it started a query`]: { ...own, outer: boom, dispatched: [y] },
          [`${kind}, the conversion throws, then a query in the same tick`]: {
            ...own,
            outer: boom,
            next: ok({ z: 3 }),
            dispatched: [y],
          },
          [`${kind}, the conversion of the started query throws too`]: {
            ...own,
            outer: boom,
            dispatched: [{ err: "boom of the started query" }],
            conversions: 2,
          },
        })),
      ),
    timeout,
  );

  // The insert that the conversion started is on the wire before the ROLLBACK: the table has
  // the row it had before.
  const rolledBack = { dispatched: [ok()], rows: ok({ v: "warm" }), conversions: 1 };

  // main passes. Without the removal of the failed request from the queue, both kinds of rows hang.
  test.concurrent(
    "the conversion throws in a transaction, or after a handle ran again",
    () =>
      server({
        "inside a transaction, the conversion throws after it started an insert": { ...rolledBack, begin: boom },
        "inside a savepoint, the conversion throws after it started an insert": { ...rolledBack, begin: ok(boom) },
        "a handle that settled runs again, then the conversion throws after it started a query": {
          ...own,
          first: { err: "boom of the started query" },
          outer: boom,
          dispatched: [y],
        },
      }),
    timeout,
  );

  // No JS runs while a termination is pending, so the outer query never settles. The queries
  // that its conversion started run. main passes: both rows convert in the call that starts the query.
  test.concurrent(
    "a termination stops the conversion",
    () =>
      server({
        "node:vm timeout stops the conversion after it started a query": {
          thrown: "ERR_SCRIPT_EXECUTION_TIMEOUT",
          later: ok({ t: "later" }),
          dispatched: [y],
          conversions: 1,
          sameConnection: true,
        },
        "inside a transaction, node:vm timeout stops the conversion after it started an insert": {
          ...rolledBack,
          begin: { err: "ERR_SCRIPT_EXECUTION_TIMEOUT" },
        },
      }),
    timeout,
  );

  // On main the closed connection holds the request that closed it.
  const afterClose = { outer: closed, heldRequests: 0, afterwards: ok({ ok: 1 }) };

  test.concurrent(
    "close() from a conversion or from a getter of the values",
    () =>
      server({
        ...each(kind => ({
          [`close() from a conversion, ${kind}`]: afterClose,
          [`close() from a getter of the values, ${kind}`]: { ...afterClose, reads: 1 },
        })),
        "close() from a conversion, a query waits behind": { ...afterClose, behind: closed },
        // Without the check after the conversion, the request is "running" again and takes the reply of the next query.
        "close() from a conversion, then the handle runs again on another connection": {
          outer: closed,
          afterwards: ok({ ok: 1 }),
        },
      }),
    timeout,
  );

  // Nothing but the adapter holds the event loop here. Without the failure arm of do_run,
  // the process ends before the started queries settle, and prints nothing.
  test.concurrent(
    "the event loop waits for the queries that a failed conversion started",
    () =>
      server(
        Object.assign(
          {},
          ...["in the tick of a reply", "in a later tick"].map(tick => ({
            [`the conversion throws after it started a query, and no query follows, ${tick}`]: {
              outer: boom,
              dispatched: [y],
            },
            [`both conversions throw, and no query follows, ${tick}`]: {
              outer: boom,
              dispatched: [{ err: "boom of the started query" }],
            },
          })),
        ),
        { HOLD_EVENT_LOOP: "false" },
      ),
    timeout,
  );

  // Both requests leave the queue with nothing sent, so no reply comes for them. What
  // follows a reply has to follow their failure: the idle timer of the connection runs.
  // main passes. Without update_idle_state() after a failed start, the connection stays open.
  test.concurrent(
    "the idle timeout closes the connection when the outer and the started conversion both threw",
    () =>
      server(
        {
          "both conversions throw, then the connection is idle": {
            outer: boom,
            dispatched: [{ err: "boom of the started query" }],
            closed: true,
          },
        },
        { IDLE_TIMEOUT: "0.2" },
      ),
    timeout,
  );
});

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const v = [{ name: "v", type: 0xfd /* MYSQL_TYPE_VAR_STRING */ }];

// Answers a statement with its parameter and a simple query with its literal, and records
// what reached it: Q(literal), P(alias of the statement), E(parameter). `select 'record' as v`
// starts the record of a scenario and `select 'stop' as v` ends it.
async function recordingServer() {
  const records: string[][] = [];
  let record: string[] | undefined;
  const { server, port } = await mysqlMockServer(() => {
    const parameters = new Map<number, number>();
    return (command, payload) => {
      const text = payload.subarray(1).toString();
      switch (command) {
        case COM_QUERY: {
          const literal = /'(\w+)'/.exec(text)![1];
          if (literal === "record") records.push((record = []));
          else if (literal === "stop") record = undefined;
          // "wait" is the query of the second connection, which has no part in the order.
          else if (literal !== "wait") record?.push(`Q(${literal})`);
          return mysqlTextResultSet(1, v, [[literal]]);
        }
        case COM_STMT_PREPARE: {
          const id = parameters.size + 1;
          parameters.set(id, text.split("?").length - 1);
          record?.push(`P(${/ as (\w+)$/.exec(text)![1]})`);
          return mysqlStmtPrepareResponse(id, parameters.get(id)!, v);
        }
        case COM_STMT_EXECUTE: {
          const [parameter] = mysqlExecuteStringParameters(payload, parameters.get(payload.readUInt32LE(1))!);
          record?.push(`E(${parameter})`);
          return mysqlBinaryResultSet(1, v, [[mysqlLenencStr(parameter!)]]);
        }
      }
    };
  });
  return { records, port, [Symbol.dispose]: () => void server.close() };
}

async function wire(scenarios: Record<string, { frames: string[] } & Record<string, unknown>>) {
  using mock = await recordingServer();
  const names = Object.keys(scenarios);
  const ran = await run("sql-mysql-dispatch-during-bind-wire-fixture.ts", names, {
    MYSQL_MOCK_PORT: String(mock.port),
  });
  for (const [i, name] of names.entries()) {
    if (ran.printed[name]) ran.printed[name].frames = mock.records[i];
  }
  expect(ran).toEqual({ printed: scenarios, ...exited });
}

const outer = ok({ v: "outer" });
const nested = { outer, dispatched: [ok({ v: "nested" })], conversions: 1 };

test.concurrent(
  "wire order equals queue order: prepared statement",
  () =>
    wire({
      "prepared statement, the conversion starts a query with a prepared statement": {
        ...nested,
        frames: ["E(outer)", "E(nested)"],
      },
      "prepared statement, the conversion starts a query with a new statement": {
        ...nested,
        frames: ["E(outer)", "P(nested)", "E(nested)"],
      },
      "prepared statement, the conversion starts a simple query": {
        ...nested,
        frames: ["E(outer)", "Q(nested)"],
      },
      "prepared statement, the conversion starts a query with the statement of the outer query": {
        ...nested,
        frames: ["E(outer)", "E(nested)"],
      },
    }),
  timeout,
);

test.concurrent(
  "wire order equals queue order: first execution",
  () =>
    wire({
      "first execution, the conversion starts a query with a prepared statement": {
        ...nested,
        frames: ["P(outer)", "E(outer)", "E(nested)"],
      },
      "first execution, the conversion starts a query with a new statement": {
        ...nested,
        frames: ["P(outer)", "E(outer)", "P(nested)", "E(nested)"],
      },
      "first execution, the conversion starts a simple query": {
        ...nested,
        frames: ["P(outer)", "E(outer)", "Q(nested)"],
      },
      "first execution, the conversion starts a query with the statement of the outer query": {
        ...nested,
        frames: ["P(outer)", "E(outer)", "E(nested)"],
      },
    }),
  timeout,
);

test.concurrent(
  "wire order equals queue order: user code that runs between two requests",
  () =>
    wire({
      "a query starts while a request that failed to start is rejected": {
        failed: boom,
        behind: ok({ v: "behind" }),
        dispatched: [ok({ v: "started" })],
        conversions: 1,
        frames: ["P(failed)", "E(behind)", "E(started)"],
      },
      "a query starts while a reply resolves a query": {
        first: ok({ v: "first" }),
        behind: ok({ v: "behind" }),
        dispatched: [ok({ v: "started" })],
        conversions: 0,
        frames: ["E(first)", "E(behind)", "E(started)"],
      },
    }),
  timeout,
);
