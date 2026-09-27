// The enqueue-time fast path for an already-prepared statement wrote
// Bind+Execute whenever can_pipeline() was true. can_pipeline() only looked at
// WAITING_TO_PREPARE / backpressure / nonpipelinable counts, none of which are
// set for a request that was queued but whose bytes have not been emitted yet
// (a new statement text enqueued while another query is in flight). A later
// query reusing a prepared statement would therefore write its Bind+Execute
// ahead of that queued request, while reply attribution stays FIFO over the
// request queue: the queued request is silently fulfilled with the next
// query's rows (decoded under an empty column list), and the next query never
// settles, wedging the connection.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import net from "node:net";
import {
  listeningServer,
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgHold,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

/** One entry per query, in order: its rows, or the SQLSTATE (or the client's error code) it rejected with. */
async function settle(queries: PromiseLike<any>[]) {
  return (await Promise.allSettled(queries)).map(result =>
    result.status === "fulfilled" ? [...result.value] : (result.reason.errno ?? result.reason.code),
  );
}

// A TCP proxy in front of the real server. It passes every byte through, but
// what the server sends after an ErrorResponse it keeps back until `release()`.
async function holdAfterErrorResponse(host: string, port: number) {
  const sockets = new Set<net.Socket>();
  let held: Buffer[] | undefined;
  let release = () => {};
  const { port: proxyPort, server } = await listeningServer(client => {
    const upstream = net.connect({ host, port });
    sockets.add(client).add(upstream);
    release = () => {
      if (held?.length) client.write(Buffer.concat(held));
      held = undefined;
    };
    let buffered = Buffer.alloc(0);
    upstream.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      // Backend message: Byte1(type) Int32(length, type byte not counted) body.
      while (buffered.length >= 5 && buffered.length > buffered.readInt32BE(1)) {
        const message = buffered.subarray(0, 1 + buffered.readInt32BE(1));
        buffered = buffered.subarray(message.length);
        if (held) held.push(message);
        else client.write(message);
        if (message[0] === 0x45 /* 'E' ErrorResponse */) held ??= [];
      }
    });
    client.on("data", chunk => upstream.write(chunk));
    for (const socket of [client, upstream]) socket.on("error", () => {});
  });
  return {
    port: proxyPort,
    release: () => release(),
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // Before the fix: B's Parse is never sent. C's Bind+Execute is written
  // immediately after A's, so C's row is delivered to B (as [{}]) and C hangs
  // forever along with every later query on the connection.
  test("a prepared-statement execute does not jump a queued unwritten prepare", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`; // SELECT $1::text AS v is now prepared

    const a = sql`SELECT ${"A"}::text AS v`;
    const b = sql`SELECT ${"B"}::text AS v, ${1}::int AS w`;
    const c = sql`SELECT ${"C"}::text AS v`;
    const after = sql`SELECT ${"after"}::text AS v`;

    expect(await Promise.all([a, b, c, after])).toEqual([
      [{ v: "A" }],
      [{ v: "B", w: 1 }],
      [{ v: "C" }],
      [{ v: "after" }],
    ]);
  });

  // Same shape with two distinct new statement texts queued between two
  // prepared-statement executes.
  test("prepared executes do not jump multiple queued unwritten prepares", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const a = sql`SELECT ${"A"}::text AS v`;
    const b1 = sql`SELECT ${"B1"}::text AS v, ${1}::int AS w`;
    const b2 = sql`SELECT ${"B2"}::text AS v, ${2}::int AS w, ${3}::int AS x`;
    const c = sql`SELECT ${"C"}::text AS v`;

    expect(await Promise.all([a, b1, b2, c])).toEqual([
      [{ v: "A" }],
      [{ v: "B1", w: 1 }],
      [{ v: "B2", w: 2, x: 3 }],
      [{ v: "C" }],
    ]);
  });

  // Larger mixed burst: interleave reuses of one prepared statement with many
  // distinct new statement texts so the enqueue-time gate and advance()'s
  // pending bookkeeping are exercised across a longer queue.
  test("mixed burst of prepared and new statements returns every row in order", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const queries: Promise<any>[] = [];
    const expected: any[] = [];
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 1) {
        queries.push(sql.unsafe(`SELECT $1::text AS v, ${i}::int AS k${i}`, [String(i)]));
        expected.push([{ v: String(i), [`k${i}`]: i }]);
      } else {
        queries.push(sql`SELECT ${String(i)}::text AS v`);
        expected.push([{ v: String(i) }]);
      }
    }

    expect(await Promise.all(queries)).toEqual(expected);
  });

  // Sibling: a simple-protocol query queued while a prepared execute is in
  // flight also sits Pending without bumping nonpipelinable_requests, so the
  // same fast path would jump it.
  test("a prepared-statement execute does not jump a queued unwritten simple query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 30 });

    await sql`SELECT ${"warm"}::text AS v`;

    const a = sql`SELECT ${"A"}::text AS v`;
    const b = sql`SELECT 'B'::text AS v`.simple();
    const c = sql`SELECT ${"C"}::text AS v`;

    expect(await Promise.all([a, b, c])).toEqual([[{ v: "A" }], [{ v: "B" }], [{ v: "C" }]]);
  });

  // The server sends an ErrorResponse at once and the ReadyForQuery of the
  // failed batch after it, in two writes. On a network the two arrive in two
  // reads, and the catch handler of the failed query runs between them. The
  // proxy makes that certain. What the handler issues must get its own rows.
  // Before the fix: the new statement got the row of the prepared one (its
  // text read as an int4, its int4 read as text), and the prepared one rejected.
  test("queries issued between an ErrorResponse and its ReadyForQuery get their own rows", async () => {
    await container.ready;
    const proxy = await holdAfterErrorResponse(container.host, container.port);
    const sql = new SQL({
      url: `postgres://bun_sql_test@127.0.0.1:${proxy.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 30,
    });
    try {
      const known = (i: number) => sql`select ${"t" + i}::text as tag, ${i}::int as k`;
      const divide = (by: number) => sql`select 10 / ${by}::int as q`;
      await known(1);
      await divide(1);

      // Both are prepared, so they are pipelined. The second one fails.
      let issued!: PromiseLike<any>[];
      const rejection = await Promise.all([known(2), divide(0)]).then(
        () => "resolved",
        (err: any) => {
          issued = [sql`select ${1000}::int as id, ${"fresh"}::text as why`.execute(), known(101).execute()];
          proxy.release();
          return err.errno;
        },
      );
      expect({ rejection, results: await settle(issued) }).toEqual({
        rejection: "22012",
        results: [[{ id: 1000, why: "fresh" }], [{ tag: "t101", k: 101 }]],
      });
    } finally {
      // The proxy first: a request that never settles would hold `sql.close()`.
      proxy.close();
      await sql.close();
    }
  });
});

// The same window on a mock, for three ways a statement fails and three pairs
// of requests that the catch handler issues. Before the fix: the ReadyForQuery
// of an earlier pipelined request had marked the connection ready, and the
// failed request counted as finished at its ErrorResponse. So the Parse of a
// new statement went out at once, the late ReadyForQuery of the failed batch
// was taken for the end of that Parse, and the request behind the new
// statement was written ahead of its Bind. Replies go to the requests in queue
// order: each of the two got the other's row, or neither settled.
//
// The mock speaks the extended protocol for `select $1 as <column>` and the
// simple protocol for `select '<text>' as <column>`, and answers with the text
// in one row. It answers the bound text "fail at bind" with an ErrorResponse,
// and "fail at sync" with a row, a CommandComplete and then an ErrorResponse
// (a deferred constraint fails when the Sync commits). From the ErrorResponse
// on it keeps back every message, first of all the ReadyForQuery of the failed
// batch, until `release()`. `wire` lists the Parse, Bind and Query messages the
// mock received, in order, and `received(count)` resolves with them once there
// are `count`.
async function echoServer() {
  type Connection = { statements: Map<string, string>; column: string; bound: string; discard: boolean };
  const connections = new WeakMap<net.Socket, Connection>();
  const sockets = new Set<net.Socket>();
  const wire: string[] = [];
  let waiting: { count: number; resolve: (wire: string[]) => void } | undefined;
  const record = (message: string) => {
    wire.push(message);
    if (waiting && wire.length >= waiting.count) waiting.resolve([...wire]);
  };
  const cstring = (body: Buffer, at: number) => body.subarray(at, body.indexOf(0, at)).toString();
  const columnOf = (query: string) => /as (\w+)/.exec(query)![1];

  const mock = await pgMockServer((type, body, socket) => {
    let connection = connections.get(socket);
    if (!connection) {
      connection = { statements: new Map(), column: "", bound: "", discard: false };
      connections.set(socket, connection);
      sockets.add(socket);
    }
    // After an error the server discards every message up to the Sync.
    if (connection.discard && type !== "S") return;
    switch (type) {
      case "P": {
        const name = cstring(body, 0);
        const query = cstring(body, name.length + 1);
        connection.statements.set(name, query);
        record(`Parse ${columnOf(query)}`);
        return pgParseComplete();
      }
      case "D": {
        const column = columnOf(connection.statements.get(cstring(body, 1))!);
        return [pgParameterDescription([25 /* text */]), pgRowDescription([{ name: column, typeOid: 25 }])];
      }
      case "B": {
        const portal = cstring(body, 0);
        connection.column = columnOf(connection.statements.get(cstring(body, portal.length + 1))!);
        connection.bound = pgBindParameters(body)[0]!.toString();
        record(`Bind ${connection.column} ${connection.bound}`);
        if (connection.bound === "fail at bind") {
          connection.discard = true;
          return [pgErrorResponse({ S: "ERROR", C: "22012", M: "division by zero" }), pgHold];
        }
        return pgBindComplete();
      }
      case "E":
        return [pgDataRow([Buffer.from(connection.bound)]), pgCommandComplete("SELECT 1")];
      case "Q": {
        const query = cstring(body, 0);
        record(`Query ${columnOf(query)}`);
        return [
          pgRowDescription([{ name: columnOf(query), typeOid: 25 }]),
          pgDataRow([Buffer.from(/'(\w+)'/.exec(query)![1])]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ];
      }
      case "S": {
        const failed = connection.bound === "fail at sync";
        connection.discard = false;
        connection.bound = "";
        if (!failed) return pgReadyForQuery();
        const error = { S: "ERROR", C: "23505", M: "duplicate key value violates unique constraint" };
        return [pgErrorResponse(error), pgHold, pgReadyForQuery()];
      }
      case "X":
        socket.end();
    }
  });
  return {
    ...mock,
    wire,
    received: (count: number) =>
      new Promise<string[]>(resolve => {
        if (wire.length >= count) resolve([...wire]);
        else waiting = { count, resolve };
      }),
    close() {
      for (const socket of sockets) socket.destroy();
      mock.server.close();
    },
  };
}

describe.concurrent("postgres mock, the ReadyForQuery of a failed statement arrives after its ErrorResponse", () => {
  type Echo = (text: string) => SQL.Query<any>;
  type Mock = Awaited<ReturnType<typeof echoServer>>;

  // `known` and `failing` are prepared before the failure. `issue` runs in the
  // catch handler of the failure, so between its ErrorResponse and its
  // ReadyForQuery. `check` gets what `issue` returned.
  async function afterFailure(
    failure: { sqlstate: string; run: (known: Echo, failing: Echo, release: () => void) => Promise<any> },
    issue: (sql: SQL, known: Echo) => PromiseLike<any>[],
    check: (issued: PromiseLike<any>[], mock: Mock) => Promise<void>,
  ) {
    const mock = await echoServer();
    const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
    try {
      const known: Echo = text => sql`select ${text} as known`;
      const failing: Echo = text => sql`select ${text} as failing`;
      await known("k1");
      await failing("f1");

      let issued!: PromiseLike<any>[];
      const rejection = await failure.run(known, failing, mock.release).then(
        () => "resolved",
        (err: any) => {
          mock.wire.length = 0;
          issued = issue(sql, known);
          mock.release();
          return err.errno;
        },
      );
      expect(rejection).toBe(failure.sqlstate);
      await check(issued, mock);
    } finally {
      // The mock first: a request that never settles would hold `sql.close()`.
      mock.close();
      await sql.close();
    }
  }

  const failures: Record<string, Parameters<typeof afterFailure>[0]> = {
    "at its Bind, behind another request": {
      sqlstate: "22012",
      run: (known, failing) => Promise.all([known("k2"), failing("fail at bind")]),
    },
    "at its Sync, behind another request": {
      sqlstate: "23505",
      run: (known, failing) => Promise.all([known("k2"), failing("fail at sync")]),
    },
    "twice in a row": {
      sqlstate: "22012",
      run: (_known, failing, release) =>
        failing("fail at bind").catch(() => {
          const again = failing("fail at bind").execute();
          release();
          return again;
        }),
    },
  };

  for (const [how, failure] of Object.entries(failures)) {
    test(`a statement fails ${how}: a new statement and a prepared one get their own rows`, async () => {
      await afterFailure(
        failure,
        (sql, known) => [sql`select ${"n1"} as fresh`.execute(), known("k101").execute()],
        async (issued, mock) => {
          expect({ wire: await mock.received(3), results: await settle(issued) }).toEqual({
            wire: ["Parse fresh", "Bind fresh n1", "Bind known k101"],
            results: [[{ fresh: "n1" }], [{ known: "k101" }]],
          });
        },
      );
    });

    test(`a statement fails ${how}: a new statement and a simple query get their own rows`, async () => {
      await afterFailure(
        failure,
        sql => [sql`select ${"n1"} as fresh`.execute(), sql`select 's1' as simple`.simple().execute()],
        async (issued, mock) => {
          expect({ wire: await mock.received(3), results: await settle(issued) }).toEqual({
            wire: ["Parse fresh", "Bind fresh n1", "Query simple"],
            results: [[{ fresh: "n1" }], [{ simple: "s1" }]],
          });
        },
      );
    });

    test(`a statement fails ${how}: two new statements both settle`, async () => {
      await afterFailure(
        failure,
        sql => [sql`select ${"a1"} as a`.execute(), sql`select ${"b1"} as b`.execute()],
        async (issued, mock) => {
          // Neither settled: the second Parse went out ahead of the first
          // Bind, and the first request took the reply to it.
          expect(await mock.received(3)).toEqual(["Parse a", "Bind a a1", "Parse b"]);
          expect({ wire: await mock.received(4), results: await settle(issued) }).toEqual({
            wire: ["Parse a", "Bind a a1", "Parse b", "Bind b b1"],
            results: [[{ a: "a1" }], [{ b: "b1" }]],
          });
        },
      );
    });
  }
});
