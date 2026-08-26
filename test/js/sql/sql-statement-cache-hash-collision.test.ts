// https://github.com/oven-sh/bun/issues/32741
//
// The per-connection prepared-statement cache was keyed on a wyhash of
// `signature.name` (= query text + one suffix per bound param), so two
// distinct queries whose names collide under that hash shared one server-side
// statement. The cache now keys on the name bytes themselves; these are the
// constructed colliding inputs that broke the old key.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// The old key was std.hash.Wyhash with seed 0, which is `Bun.hash.wyhash(bytes, 0n)`.
// It consumes its input in 48-byte rounds of three 16-byte lanes; each lane
// becomes mix(word0 ^ secret, word1 ^ lane). The two names below are:
//
//   round 1  "SELECT '" + PAD                   shared
//   round 2  STEER + FILL                       shared, leaves lane 0 == KILL
//   round 3  FREE + KILL + FILL                 FREE differs
//   tail     "' AS v, <placeholder> AS p.null"  shared
//
// In round 3 lane 0 is mix(FREE ^ secret, KILL ^ KILL) = mix(FREE ^ secret, 0),
// which is 0 for every FREE, so the hashes match for any FREE and any tail.
// STEER and KILL came from the brute-force search in
// test/cli/install/wyhash-std-collision.ts (prefix "SELECT '", alphanumeric
// charset). They stay valid until the hash itself changes; the first test
// below checks them on every platform.
const PAD = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const STEER = "qnbaaaaakryFMT07";
const KILL = "sLwJ3mc5";
const FILL = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";

// FREE sits inside a string literal, so query A selects a value that contains
// "AAAAAAAA" and query B one that contains "BBBBBBBB". BAD_FREE closes the
// literal early and follows it with "}", which neither server can parse.
const FREE_A = "AAAAAAAA";
const FREE_B = "BBBBBBBB";
const BAD_FREE = "'}}}}}}}";

function collidingQueries(placeholder: string, freeB: string) {
  const literal = (free: string) => PAD + STEER + FILL + free + KILL + FILL;
  const query = (free: string) => `SELECT '${literal(free)}' AS v, ${placeholder} AS p`;
  return {
    queryA: query(FREE_A),
    rowA: { v: literal(FREE_A), p: null },
    queryB: query(freeB),
    rowB: { v: literal(freeB), p: null },
  };
}

// signature.name of a query with one null-bound parameter.
const signatureName = (query: string) => new TextEncoder().encode(query + ".null");

test.each([
  ["?", FREE_B],
  ["?", BAD_FREE],
  ["$1", FREE_B],
  ["$1", BAD_FREE],
])("the stored queries collide under Bun.hash.wyhash (placeholder %s, free word %p)", (placeholder, freeB) => {
  const { queryA, queryB } = collidingQueries(placeholder, freeB);
  expect(queryA).not.toBe(queryB);
  expect(Bun.hash.wyhash(signatureName(queryA), 0n)).toBe(Bun.hash.wyhash(signatureName(queryB), 0n));
});

type Backend = {
  placeholder: string;
  // Number of statements this session has prepared on the server so far.
  prepares: (sql: SQL) => Promise<number>;
  describeError: (err: unknown) => Record<string, unknown>;
  syntaxError: Record<string, unknown>;
};

const controlRow = { v: "CONTROL", p: null };
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (err: unknown) => err,
  );

// Query A populates the statement cache. Query B is byte-distinct but
// hash-colliding, so it must prepare its own statement and return its own
// row; before the fix it reused A's statement and returned rowA. The re-runs,
// in the other order, must hit the cached statements without a new prepare.
async function expectDistinctStatements(sql: SQL, { placeholder, prepares }: Backend) {
  const { queryA, rowA, queryB, rowB } = collidingQueries(placeholder, FREE_B);
  const control = `SELECT 'CONTROL' AS v, ${placeholder} AS p`;
  const run = (query: string) => sql.unsafe(query, [null]);

  const prepared = await prepares(sql);
  expect(await Promise.all([run(queryA), run(queryB), run(control)])).toEqual([[rowA], [rowB], [controlRow]]);
  expect(await prepares(sql)).toBe(prepared + 3);
  expect(await Promise.all([run(queryB), run(queryA)])).toEqual([[rowB], [rowA]]);
  expect(await prepares(sql)).toBe(prepared + 3);
}

// The bad query's free word closes the string literal early, so the server
// rejects it at prepare time. Its name collides with the good query's, which
// is the input that made the old cache hand the good statement to the bad
// query. The good statement must stay cached and usable, the failure is cached
// under the bad query's own key, and the connection stays usable.
async function expectFailedPrepareKeepsCachedStatement(
  sql: SQL,
  { placeholder, prepares, describeError, syntaxError }: Backend,
) {
  const { queryA: good, rowA: goodRow, queryB: bad } = collidingQueries(placeholder, BAD_FREE);
  const control = `SELECT 'CONTROL' AS v, ${placeholder} AS p`;
  const run = (query: string) => sql.unsafe(query, [null]);

  expect(await run(good)).toEqual([goodRow]);
  // Before the fix this resolved with goodRow instead of rejecting.
  const err = await rejection(run(bad));
  expect(err).toBeInstanceOf(SQL.SQLError);
  expect(describeError(err)).toEqual(syntaxError);
  const prepared = await prepares(sql);

  Bun.gc(true);

  expect(await run(good)).toEqual([goodRow]);
  expect(describeError(await rejection(run(bad)))).toEqual(syntaxError);
  expect(await prepares(sql)).toBe(prepared);
  expect(await run(control)).toEqual([controlRow]);
  expect(await prepares(sql)).toBe(prepared + 1);
}

const mysql: Backend = {
  placeholder: "?",
  // Counts every COM_STMT_PREPARE of this session, including rejected ones.
  // `.simple()` runs the status query over the text protocol, so it does not
  // count itself.
  prepares: async sql => Number((await sql.unsafe("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'").simple())[0].Value),
  describeError: (err: any) => ({ code: err.code, errno: err.errno, sqlState: err.sqlState, message: err.message }),
  syntaxError: {
    code: "ERR_MYSQL_SYNTAX_ERROR",
    errno: 1064,
    sqlState: "42000",
    // MySQL and MariaDB name themselves in the middle of this message.
    message: expect.stringMatching(/^You have an error in your SQL syntax; .* near '}/),
  },
};

const postgres: Backend = {
  placeholder: "$1",
  // Statements that exist in this session. A rejected Parse creates none.
  prepares: async sql =>
    Number((await sql.unsafe("SELECT count(*)::int AS n FROM pg_prepared_statements").simple())[0].n),
  describeError: (err: any) => ({ name: err.name, code: err.code, errno: err.errno, message: err.message }),
  syntaxError: {
    name: "PostgresError",
    code: "ERR_POSTGRES_SYNTAX_ERROR",
    errno: "42601",
    message: 'syntax error at or near "}"',
  },
};

describeWithContainer("mysql", { image: "mysql_plain", concurrent: true }, container => {
  const connect = () =>
    new SQL({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test("MySQL: hash-colliding prepared statements are not confused", async () => {
    await container.ready;
    await using sql = connect();
    await expectDistinctStatements(sql, mysql);
  });

  test("MySQL: a hash-colliding query that fails to prepare does not evict or free the cached statement", async () => {
    await container.ready;
    await using sql = connect();
    await expectFailedPrepareKeepsCachedStatement(sql, mysql);
  });
});

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test("Postgres: hash-colliding prepared statements are not confused", async () => {
    await container.ready;
    await using sql = connect();
    await expectDistinctStatements(sql, postgres);
  });

  test("Postgres: a hash-colliding query that fails to parse does not evict or free the cached statement", async () => {
    await container.ready;
    await using sql = connect();
    await expectFailedPrepareKeepsCachedStatement(sql, postgres);

    // The server holds exactly one statement with the good query's text (it was
    // not re-prepared) and none with the bad query's text.
    const { queryA: good, queryB: bad } = collidingQueries(postgres.placeholder, BAD_FREE);
    const statements = await sql.unsafe("SELECT statement FROM pg_prepared_statements").simple();
    expect(statements.map(row => row.statement).filter(text => text === good || text === bad)).toEqual([good]);
  });
});
