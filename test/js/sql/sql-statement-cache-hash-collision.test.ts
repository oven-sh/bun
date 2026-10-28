// https://github.com/oven-sh/bun/issues/32741
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// STEER leaves lane 0 of `Bun.hash.wyhash(bytes, 0n)` equal to KILL, so the round FREE + KILL + FILL mixes to 0 for every FREE.
// STEER and KILL came from the search in test/cli/install/wyhash-std-collision.ts (prefix "SELECT '", alphanumeric charset).
const PAD = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const STEER = "qnbaaaaakryFMT07";
const KILL = "sLwJ3mc5";
const FILL = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";

// BAD_FREE closes the string literal early and follows it with "}", which neither server can parse.
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

// The hashed bytes: the query text + one suffix per bound parameter.
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
  /** Number of statements this session has prepared on the server so far. */
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

// Returns the rejection of the second bad run.
async function expectFailedPrepareKeepsCachedStatement(
  sql: SQL,
  { placeholder, prepares, describeError, syntaxError }: Backend,
): Promise<unknown> {
  const { queryA: good, rowA: goodRow, queryB: bad } = collidingQueries(placeholder, BAD_FREE);
  const control = `SELECT 'CONTROL' AS v, ${placeholder} AS p`;
  const run = (query: string) => sql.unsafe(query, [null]);

  expect(await run(good)).toEqual([goodRow]);
  const first = await rejection(run(bad));
  expect(first).toBeInstanceOf(SQL.SQLError);
  expect(describeError(first)).toEqual(syntaxError);
  const second = await rejection(run(bad));
  expect(describeError(second)).toEqual(syntaxError);

  // Taken after both bad runs: the driver may have prepared the bad query once or twice.
  const prepared = await prepares(sql);

  Bun.gc(true);

  expect(await run(good)).toEqual([goodRow]);
  expect(await prepares(sql)).toBe(prepared);
  expect(await run(control)).toEqual([controlRow]);
  expect(await prepares(sql)).toBe(prepared + 1);
  return second;
}

const mysql: Backend = {
  placeholder: "?",
  // Counts rejected prepares too. `.simple()` keeps the status query from counting itself.
  prepares: async sql => Number((await sql.unsafe("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'").simple())[0].Value),
  describeError: (err: any) => ({
    name: err.name,
    code: err.code,
    errno: err.errno,
    sqlState: err.sqlState,
    message: err.message,
  }),
  syntaxError: {
    name: "MySQLError",
    code: "ERR_MYSQL_SYNTAX_ERROR",
    errno: 1064,
    sqlState: "42000",
    message: expect.stringMatching(/^You have an error in your SQL syntax; .* near '}/),
  },
};

const postgres: Backend = {
  placeholder: "$1",
  // A rejected Parse creates no statement.
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
    expect(await expectFailedPrepareKeepsCachedStatement(sql, mysql)).toBeInstanceOf(SQL.MySQLError);
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
    expect(await expectFailedPrepareKeepsCachedStatement(sql, postgres)).toBeInstanceOf(SQL.PostgresError);

    const { queryA: good, queryB: bad } = collidingQueries(postgres.placeholder, BAD_FREE);
    const statements = await sql.unsafe("SELECT statement FROM pg_prepared_statements").simple();
    expect(statements.map(row => row.statement).filter(text => text === good || text === bad)).toEqual([good]);
  });
});
