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
import {
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgHold,
  pgHoldingProxy,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

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
});

// A query that fails is answered with ErrorResponse, then with the
// ReadyForQuery of its Sync. The two can arrive in two reads, and the rejection
// runs user code between them. The failed request released its place in the
// connection at the ErrorResponse, so a statement issued in that gap wrote its
// Parse at once, and the late ReadyForQuery was taken for the answer to that
// Parse: advance() then wrote the Bind of the next request first. Replies go to
// the requests in queue order, so each query resolved with the rows of another
// one. With equal column types nothing fails to decode and nothing rejects.
//
// Now the failed request keeps the head of the queue until its ReadyForQuery,
// and advance() writes nothing past a request whose statement is being parsed.
const alice = { owner: "alice", secret: "alice-secret" };
const bob = { owner: "bob", secret: "bob-secret" };
const carol = { owner: "carol", secret: "carol-secret" };
const errno = (err: any) => err.errno;

/** `sql`, a reserved connection or a transaction. */
type Handle = InstanceType<typeof SQL>;
const ofBob = (q: Handle) => q`select owner, secret from swap_b where id = ${1}`;
const divide = (q: Handle, by: number) => q`select 10 / ${by}::int as q`;
/** A statement with a parameter that is new to the connection: Parse, then Bind in a second batch. */
const fresh = (q: Handle, table: string, columns = "owner, secret") =>
  q.unsafe(`select ${columns} from swap_${table} where id = $1`, [1]);
/** A statement without parameters that is new to the connection: Parse and Bind in one batch. */
const freshOfCarol = (q: Handle) => q`select owner, secret from swap_c where id = 1`;
const simpleOfBob = (q: Handle) => q.unsafe(`select owner, secret from swap_b where id = 1`);

type Proxy = Awaited<ReturnType<typeof pgHoldingProxy>>;
/** Resolves when the query has rejected. The proxy then holds the ReadyForQuery of that query. */
type Failure = (q: Handle, proxy: Proxy) => PromiseLike<unknown>;
/** What is issued before the proxy lets that ReadyForQuery through. */
type Gap = (q: Handle) => PromiseLike<unknown>[];

// The statements of ofBob and divide are prepared, so these are written when
// they are issued, and the first ReadyForQuery arrives with the second owed.
const failsBehindAnother: Failure = (q, proxy) => {
  proxy.holdAfterError();
  return Promise.all([ofBob(q), divide(q, 0)]).catch(errno);
};
const failsAloneTwice: Failure = async (q, proxy) => {
  proxy.holdAfterError();
  const first = await divide(q, 0).catch(errno);
  const second = divide(q, 0).catch(errno);
  proxy.holdAfterError();
  proxy.release();
  return [first, await second];
};

const gaps: [name: string, issue: Gap, rows: unknown[]][] = [
  ["a new statement, a prepared one", q => [fresh(q, "a"), ofBob(q)], [[alice], [bob]]],
  [
    "a new statement with other column types, a prepared one",
    q => [fresh(q, "a", "id, owner"), ofBob(q)],
    [[{ id: 1, owner: "alice" }], [bob]],
  ],
  [
    "a new statement, a prepared one, through execute()",
    q => [fresh(q, "a").execute(), ofBob(q).execute()],
    [[alice], [bob]],
  ],
  ["a new statement, a simple query", q => [fresh(q, "a"), simpleOfBob(q)], [[alice], [bob]]],
  ["two new statements", q => [fresh(q, "a"), fresh(q, "c")], [[alice], [carol]]],
  ["two new statements, a prepared one", q => [fresh(q, "a"), fresh(q, "c"), ofBob(q)], [[alice], [carol], [bob]]],
  [
    "a new statement without parameters, a new statement, a prepared one",
    q => [freshOfCarol(q), fresh(q, "a"), ofBob(q)],
    [[carol], [alice], [bob]],
  ],
  [
    "a new statement without parameters, a new statement, a simple query",
    q => [freshOfCarol(q), fresh(q, "a"), simpleOfBob(q)],
    [[carol], [alice], [bob]],
  ],
];

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  async function run(failure: Failure, gap: Gap, reserve = false) {
    await container.ready;
    const proxy = await pgHoldingProxy(container.host, container.port);
    try {
      await using sql = new SQL({
        url: `postgres://bun_sql_test@127.0.0.1:${proxy.port}/bun_sql_test`,
        max: reserve ? 10 : 1,
        idleTimeout: 30,
      });
      await using reserved = reserve ? await sql.reserve() : undefined;
      const q: Handle = reserved ?? sql;
      await q.unsafe(`
        create temp table swap_a (id int, owner text, secret text);
        create temp table swap_b (id int, owner text, secret text);
        create temp table swap_c (id int, owner text, secret text);
        insert into swap_a values (1, 'alice', 'alice-secret');
        insert into swap_b values (1, 'bob', 'bob-secret');
        insert into swap_c values (1, 'carol', 'carol-secret');
      `);
      const warm: unknown[] = await Promise.all([ofBob(q), divide(q, 1)]);

      const failed = await failure(q, proxy);
      const reads = Promise.all(gap(q));
      proxy.release();
      return { warm, failed, reads: await reads, after: await ofBob(q) };
    } finally {
      proxy.server.close();
    }
  }
  const ran = (failed: unknown, reads: unknown[]) => ({ warm: [[bob], [{ q: 10 }]], failed, reads, after: [bob] });

  describe.each([
    ["behind another query", failsBehindAnother, "22012"],
    ["alone, twice in a row", failsAloneTwice, ["22012", "22012"]],
  ] as const)("before the ReadyForQuery of a query that failed %s", (_, failure, failed) => {
    test.each(gaps)("%s resolve with their own rows", async (_, gap, rows) => {
      expect(await run(failure, gap)).toEqual(ran(failed, rows));
    });
  });

  // A reserved handle keeps its queries on one connection, whatever the size of the pool.
  test("on a connection reserved from a pool of 10, a new statement and a prepared one resolve with their own rows", async () => {
    expect(await run(failsBehindAnother, gaps[0][1], true)).toEqual(ran("22012", [[alice], [bob]]));
  });

  test("a transaction that begins before that ReadyForQuery reads its own rows", async () => {
    const gap: Gap = q => [q.begin(tx => Promise.all([fresh(tx, "a"), ofBob(tx)]))];
    expect(await run(failsBehindAnother, gap)).toEqual(ran("22012", [[[alice], [bob]]]));
  });

  // These failing queries are written with nothing else in flight. Each one
  // keeps the head of the queue until its ReadyForQuery in its own way: a
  // simple query holds nonpipelinable_requests, a statement that fails in its
  // Parse stays Pending, a first execution without parameters holds no counter.
  test.each([
    ["a simple query", q => q.unsafe(`select 10 / 0 as q`), "22012"],
    ["a new statement that fails in its Parse", q => fresh(q, "none"), "42P01"],
    ["a new statement without parameters that fails in its Parse", q => q`select owner from swap_none`, "42P01"],
    ["a new statement without parameters that fails after its Parse", q => q`select 10 / 0 as q`, "22012"],
  ] as [string, (q: Handle) => PromiseLike<unknown>, string][])(
    "before the ReadyForQuery of %s, a new statement and a prepared one resolve with their own rows",
    async (_, fails, failed) => {
      const failure: Failure = (q, proxy) => {
        proxy.holdAfterError();
        return fails(q).then(undefined, errno);
      };
      expect(await run(failure, gaps[0][1])).toEqual(ran(failed, [[alice], [bob]]));
    },
  );
});

// PostgreSQL sends nothing but the ReadyForQuery after an ErrorResponse, and one
// ReadyForQuery for each Sync. With such a server, either of the two rules alone
// gives each query its own rows. Each mock below sends what PostgreSQL does not,
// so each rule has a test that fails without it.
describe.concurrent("postgres mock", () => {
  type Reply = (Buffer | typeof pgHold)[] | undefined;
  /** Answers `select $1 as v` with the bound text as the row. `quirk` can replace the reply to a message. */
  async function echoServer(quirk: (type: string, body: Buffer, bound: string | undefined) => Reply) {
    const bound = new WeakMap<object, string>();
    const binds: string[] = [];
    const mock = await pgMockServer((type, body, socket) => {
      const reply = quirk(type, body, bound.get(socket));
      if (reply) return reply;
      switch (type) {
        case "P":
          return pgParseComplete();
        case "D":
          return [pgParameterDescription([25 /* text */]), pgRowDescription([{ name: "v", typeOid: 25 }])];
        case "B":
          bound.set(socket, pgBindParameters(body)[0]!.toString());
          binds.push(bound.get(socket)!);
          return pgBindComplete();
        case "E":
          return [pgDataRow([Buffer.from(bound.get(socket)!)]), pgCommandComplete("SELECT 1")];
        case "S":
          return pgReadyForQuery();
        case "X":
          socket.end();
      }
    });
    return { ...mock, binds };
  }
  const settle = async (queries: PromiseLike<any>[]) =>
    (await Promise.allSettled(queries)).map(result =>
      result.status === "fulfilled" ? [...result.value] : { code: result.reason.code, errno: result.reason.errno },
    );

  // The failed request keeps the head of the queue until its ReadyForQuery. If
  // it left at the ErrorResponse, the enqueue of `fresh` would write a Parse at
  // once, and the held row would go to `fresh`.
  test("frames that arrive after an ErrorResponse stay with the failed query when it failed behind another one", async () => {
    const mock = await echoServer((type, _, bound) =>
      type === "E" && bound === "fail"
        ? [
            pgErrorResponse({ S: "ERROR", C: "22012", M: "division by zero" }),
            pgHold,
            pgDataRow([Buffer.from("late")]),
            pgCommandComplete("SELECT 1"),
          ]
        : undefined,
    );
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
      const echo = (text: string) => sql`select ${text} as v`;
      await echo("warm");

      // execute() sends a query at once, so these two are written before the first reply.
      const first = echo("first").execute();
      const failed = echo("fail").execute();
      let fresh!: PromiseLike<any>;
      const rejection = await failed.catch((err: any) => {
        fresh = sql`select ${"fresh"} as v -- not prepared yet`.execute();
        mock.release();
        return err.errno;
      });

      expect({ rejection, results: await settle([first, fresh, echo("after")]), binds: mock.binds }).toEqual({
        rejection: "22012",
        results: [[{ v: "first" }], [{ v: "fresh" }], [{ v: "after" }]],
        binds: ["warm", "first", "fail", "fresh", "after"],
      });
    } finally {
      mock.server.close();
    }
  });

  // These are the frames of pgdog 0.1.60 with its query parser on, for a
  // statement that pgdog rejects itself: ErrorResponse and ReadyForQuery at the
  // Flush, then one more ReadyForQuery at the Sync. The second one arrives when
  // the Parse of `fresh` is on the wire. advance() must stop at `fresh`. If it
  // stepped over it, the Bind of `prepared` would be written first.
  test("a second ReadyForQuery for one Sync lets nothing pass a statement that is being parsed", async () => {
    let rejecting = false;
    const mock = await echoServer((type, body) => {
      if (type === "P" && body.includes("rejected by the pooler")) rejecting = true;
      if (!rejecting) return;
      if (type === "H") return [pgErrorResponse({ S: "ERROR", C: "42601", M: "syntax error" }), pgReadyForQuery()];
      if (type !== "S") return [];
      rejecting = false;
      return [pgReadyForQuery()];
    });
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
      const echo = (text: string) => sql`select ${text} as v`;
      await echo("warm");

      const rejected = sql`select 1 as v -- rejected by the pooler`.execute();
      const fresh = sql`select ${"fresh"} as v -- not prepared yet`.execute();
      const prepared = echo("prepared").execute();

      expect({ results: await settle([rejected, fresh, prepared, echo("after")]), binds: mock.binds }).toEqual({
        results: [
          { code: "ERR_POSTGRES_SYNTAX_ERROR", errno: "42601" },
          [{ v: "fresh" }],
          [{ v: "prepared" }],
          [{ v: "after" }],
        ],
        binds: ["warm", "fresh", "prepared", "after"],
      });
    } finally {
      mock.server.close();
    }
  });
});
