// The wire order is in sql-handles.test.ts.
import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

const outcome = (promise: PromiseLike<unknown>): Promise<any> =>
  promise.then(
    value => (value === undefined || Array.isArray(value) ? "resolved" : value),
    err => err?.code ?? err?.message ?? err,
  );

function parked() {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  return { entered: entered.promise, enter: entered.resolve, gate: gate.promise, go: gate.resolve };
}

const insert = (handle: any, n: number) => handle.unsafe(`INSERT INTO t VALUES (${n})`);
const rows = async (sql: SQL) => (await sql.unsafe("SELECT n FROM t ORDER BY n")).map((row: any) => Number(row.n));

async function task(handle: any, n: number, fails: boolean, goOn: Promise<void> | undefined) {
  await insert(handle, n);
  if (fails) throw new Error("task failed");
  await goOn;
  await insert(handle, n + 1);
  await insert(handle, n + 2);
}
/**
 * Without `goOn` the two tasks that do not fail go on as soon as they can. Which of their statements still go out
 * ahead of the rollback depends on how the answers of the server fall into reads, so only the table can be pinned.
 */
function threeTasks(handle: any, tasks: Promise<string>[], goOn?: Promise<void>) {
  const running = [task(handle, 10, false, goOn), task(handle, 20, true, goOn), task(handle, 30, false, goOn)];
  tasks.push(...running.map(outcome));
  return Promise.all(running);
}

function whatStaysInTheTable(prefix: string, connect: () => Promise<SQL>) {
  const endedCode = `ERR_${prefix}_INVALID_TRANSACTION_STATE`;
  const closedCode = `ERR_${prefix}_CONNECTION_CLOSED`;
  const cancelledCode = `ERR_${prefix}_QUERY_CANCELLED`;
  async function open() {
    const sql = await connect();
    await sql.unsafe("CREATE TEMPORARY TABLE t (n INT PRIMARY KEY)");
    return sql;
  }

  const described = (result: any) => [result.constructor.name, result.count, result.command, [...result]];
  test.each([
    ["a query", (handle: any, n: number) => insert(handle, n)],
    ["an awaited result", async (handle: any, n: number) => await insert(handle, n)],
  ])("%s that the callback returns is what begin() and savepoint() resolve with", async (_, run) => {
    await using sql = await open();
    const direct = described(await insert(sql, 0));
    expect(direct.slice(0, 2)).toEqual(["SQLResultArray", 1]);
    expect(described(await sql.begin(tx => run(tx, 1)))).toEqual(direct);
    expect(described(await sql.begin(tx => tx.savepoint((sp: any) => run(sp, 2))))).toEqual(direct);

    const pipeline = await sql.begin(tx => [insert(tx, 3), insert(tx, 4)]);
    expect([pipeline.constructor.name, ...pipeline.map(described)]).toEqual(["Array", direct, direct]);
    expect((await sql.begin(async tx => [insert(tx, 5), insert(tx, 6)])).map(described)).toEqual([direct, direct]);
    expect(await rows(sql)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("a rejected begin() keeps no row of the tasks that go on after one failed", async () => {
    await using sql = await open();
    const racing: Promise<string>[] = [];
    expect(await outcome(sql.begin(tx => threeTasks(tx, racing)))).toBe("task failed");
    await Promise.all(racing);
    expect(await rows(sql)).toEqual([]);

    const tasks: Promise<string>[] = [];
    const rolledBack = Promise.withResolvers<void>();
    const transaction = await outcome(sql.begin(tx => threeTasks(tx, tasks, rolledBack.promise)));
    rolledBack.resolve();
    expect({ transaction, tasks: await Promise.all(tasks), rows: await rows(sql) }).toEqual({
      transaction: "task failed",
      tasks: [endedCode, "task failed", endedCode],
      rows: [],
    });
  });

  test("a rolled-back savepoint keeps no row of the tasks that go on after one failed", async () => {
    await using sql = await open();
    const racing: Promise<string>[] = [];
    const tasks: Promise<string>[] = [];
    const rolledBack = Promise.withResolvers<void>();
    const savepoint = await sql.begin(async tx => {
      await insert(tx, 1);
      expect(await outcome(tx.savepoint(sp => threeTasks(sp, racing)))).toBe("task failed");
      await Promise.all(racing);
      const savepoint = await outcome(tx.savepoint(sp => threeTasks(sp, tasks, rolledBack.promise)));
      rolledBack.resolve();
      await Promise.all(tasks);
      await insert(tx, 2);
      return savepoint;
    });
    expect({ savepoint, tasks: await Promise.all(tasks), rows: await rows(sql) }).toEqual({
      savepoint: "task failed",
      tasks: [endedCode, "task failed", endedCode],
      rows: [1, 2],
    });
  });

  test("a job that outlives its transaction writes nothing, not even inside the next transaction", async () => {
    await using sql = await open();
    const timeout = Promise.withResolvers<never>();
    const next = parked();
    let job!: Promise<void>;
    let lazy!: PromiseLike<unknown>;
    const timedOut = sql.begin(tx => {
      lazy = insert(tx, 3);
      job = (async () => {
        await insert(tx, 1);
        timeout.reject(new Error("timed out"));
        await next.entered;
        await insert(tx, 2);
      })();
      return Promise.race([job, timeout.promise]);
    });
    const late = sql.begin(async tx => {
      await insert(tx, 10);
      next.enter();
      const late = [await outcome(job), await outcome(lazy)];
      await insert(tx, 11);
      return late;
    });
    expect({ transaction: await outcome(timedOut), late: await late, rows: await rows(sql) }).toEqual({
      transaction: "timed out",
      late: [endedCode, endedCode],
      rows: [10, 11],
    });
  });

  test("a savepoint that returns an array rejects with the error of the query that failed, and keeps no row", async () => {
    await using sql = await open();
    const [duplicate, savepoint] = await sql.begin(async tx => {
      await insert(tx, 1);
      const duplicate = await outcome(tx.savepoint(sp => insert(sp, 1)));
      const savepoint = await outcome(tx.savepoint(sp => [insert(sp, 2), insert(sp, 2)]));
      await insert(tx, 3);
      return [duplicate, savepoint];
    });
    expect(typeof duplicate).toBe("string");
    expect({ savepoint, rows: await rows(sql) }).toEqual({ savepoint: duplicate, rows: [1, 3] });
  });

  test("tx.close() that nobody awaits: begin() rejects and nothing is stored", async () => {
    await using sql = await open();
    const transaction = sql.begin(async tx => {
      await insert(tx, 1);
      tx.close();
    });
    expect({ transaction: await outcome(transaction), rows: await rows(sql) }).toEqual({
      transaction: closedCode,
      rows: [],
    });
  });

  test("a query that is cancelled before it runs rejects, and does not run", async () => {
    await using sql = await open();
    const transaction = sql.begin(tx => [insert(tx, 1), insert(tx, 2).cancel()]);
    expect({
      pool: await outcome(insert(sql, 3).cancel()),
      executed: await outcome(insert(sql, 4).cancel().execute()),
      transaction: await outcome(transaction),
      rows: await rows(sql),
    }).toEqual({ pool: cancelledCode, executed: cancelledCode, transaction: cancelledCode, rows: [] });
  });

  return { open, closedCode };
}

function reservations({ open, closedCode }: ReturnType<typeof whatStaysInTheTable>) {
  test("release() under a running reserved.begin() does not let its COMMIT commit the work of the next caller", async () => {
    await using sql = await open();
    const reserved = await sql.reserve();
    const nested = parked();
    const transaction = reserved.begin(async tx => {
      await insert(tx, 1);
      nested.enter();
      await nested.gate;
      await insert(tx, 2);
    });
    await nested.entered;
    reserved.release();
    const other = sql.begin(async tx => {
      await insert(tx, 3);
      throw new Error("rolled back");
    });
    nested.go();
    expect([await outcome(transaction), await outcome(other), await rows(sql)]).toEqual([
      "resolved",
      "rolled back",
      [1, 2],
    ]);
  });

  test("the connection of a beginDistributed() that was prepared stays in the pool", async () => {
    await using sql = await open();
    await insert(sql, 1);
    const name = `handles_${randomUUIDv7("hex")}`;
    try {
      await sql.beginDistributed(name, tx => tx`SELECT 1`);
      await sql.commitDistributed(name);
    } finally {
      await outcome(sql.rollbackDistributed(name));
    }
    // The temporary table lives as long as the connection.
    expect(await rows(sql)).toEqual([1]);
  });

  test("two reserved.begin() at once are two transactions", async () => {
    await using sql = await open();
    await using reserved = await sql.reserve();
    const first = parked();
    const transactions = [
      reserved.begin(async tx => {
        await insert(tx, 1);
        await first.gate;
        throw new Error("rolled back");
      }),
      reserved.begin(async tx => {
        await insert(tx, 2);
        first.go();
      }),
    ].map(outcome);
    // The second one starts when the first is over, so the first must not wait for it.
    first.go();
    expect([await Promise.all(transactions), await rows(reserved)]).toEqual([["rolled back", "resolved"], [2]]);
  });

  test("a query that leaves a `using` block or a `finally` without an await is rejected", async () => {
    await using sql = await open();
    const leftUsing = async () => {
      await using reserved = await sql.reserve();
      return insert(reserved, 1);
    };
    const leftFinally = async () => {
      const reserved = await sql.reserve();
      try {
        return insert(reserved, 2);
      } finally {
        reserved.release();
      }
    };
    expect([await outcome(leftUsing()), await outcome(leftFinally()), await rows(sql)]).toEqual([
      closedCode,
      closedCode,
      [],
    ]);
  });

  test("a call on a released handle is what it is on an open one", async () => {
    await using sql = await open();
    const reserved = await sql.reserve();
    expect(reserved instanceof SQL).toBe(true);
    await reserved.release();
    const query = reserved`SELECT 1 AS x`;
    expect(query).toBeInstanceOf(sql`SELECT 1`.constructor);
    expect(query.values()).toBe(query);
    expect(await outcome(query)).toBe(closedCode);
    expect(reserved({ n: 1 })).toBeInstanceOf(sql({ n: 1 }).constructor);
    await sql`INSERT INTO t ${reserved({ n: 1 })}`;
    expect(await sql`SELECT n FROM t WHERE ${reserved`n = ${1}`}`).toEqual([{ n: 1 }]);
    let thrown: any;
    try {
      reserved("a\0b");
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.code).toBe("ERR_INVALID_ARG_VALUE");
  });
}

// The pool calls a queued begin() back from a socket event, or from whoever gives the connection up.
function asyncContext({ open }: ReturnType<typeof whatStaysInTheTable>, connect: () => Promise<SQL>) {
  const context = new AsyncLocalStorage<string>();

  test("the callback of begin() runs in the async context of its caller: a cold pool", async () => {
    await using sql = await connect();
    const seen: unknown[] = [];
    await context.run("cold", () =>
      sql.begin(async tx => {
        seen.push(context.getStore());
        await tx`SELECT 1`;
        seen.push(context.getStore());
      }),
    );
    const rollback = new Error("roll back");
    await using distributed = await connect();
    const transaction = context.run("distributed", () =>
      distributed.beginDistributed(`als_${randomUUIDv7("hex")}`, async () => {
        seen.push(context.getStore());
        throw rollback;
      }),
    );
    expect(await outcome(transaction)).toBe("roll back");
    expect(seen).toEqual(["cold", "cold", "distributed"]);
  });

  test("the callback of begin() runs in the async context of its caller: behind the transaction of another caller", async () => {
    await using sql = await open();
    const seen: Record<string, unknown> = {};
    await Promise.all([
      context.run("first", () => sql.begin(async () => void (seen.first = context.getStore()))),
      context.run("second", () =>
        sql.begin(async tx => {
          seen.second = context.getStore();
          await tx`SELECT 1`;
          seen.secondAfterQuery = context.getStore();
          await tx.savepoint(async () => void (seen.savepoint = context.getStore()));
        }),
      ),
      context.exit(() => sql.begin(async () => void (seen.outside = context.getStore()))),
    ]);
    expect(seen).toEqual({
      first: "first",
      second: "second",
      secondAfterQuery: "second",
      savepoint: "second",
      outside: undefined,
    });
  });

  // What a disposed graph awaits never comes, so a transaction that runs as the graph would keep the connection of the host.
  test("a Bun.ModuleGraph that is disposed during its queued begin() does not keep the connection", async () => {
    using dir = tempDir("sql-handles-graph", { "app.mjs": "export const call = fn => fn();" });
    await using sql = await open();
    const graph = new Bun.ModuleGraph();
    const app = await graph.import(join(String(dir), "app.mjs"));
    const holder = parked();
    const inTransaction = parked();
    const holding = sql.begin(() => holder.gate);
    graph.run(() =>
      app.call(() => {
        void sql.begin(async tx => {
          await tx`SELECT 1`;
          inTransaction.enter();
          // An immediate of a disposed graph never runs.
          await new Promise(resolve => setImmediate(resolve));
        });
      }),
    );
    holder.go();
    await holding;
    await inTransaction.entered;
    graph.dispose();
    expect(await sql.begin(async tx => (await tx`SELECT 1 AS x`)[0].x)).toBe(1);
  });
}

// Some programs define the hook so that `instanceof Array` holds for the arrays of another realm. A result is an Array.
async function withHasInstanceOfArray(url: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Object.defineProperty(Array, Symbol.hasInstance, { value: Array.isArray });
      const sql = new Bun.SQL(process.env.SQL_URL, { max: 1 });
      await sql.unsafe("CREATE TEMPORARY TABLE t (n INT PRIMARY KEY)");
      await sql.begin(tx => [tx.unsafe("INSERT INTO t VALUES (1)"), tx.unsafe("INSERT INTO t VALUES (2)")]);
      const pipeline = await sql.unsafe("SELECT n FROM t ORDER BY n");
      const statements = await sql.unsafe("SELECT 1 AS x; SELECT 2 AS x; SELECT 3 AS x").simple();
      console.log(JSON.stringify({ pipeline, statements }));
      await sql.close();
      `,
    ],
    env: { ...bunEnv, SQL_URL: url },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout && JSON.parse(stdout), stderr, exitCode };
}
const stored = [{ n: 1 }, { n: 2 }];

const servers = [
  { image: "postgres_plain", prefix: "POSTGRES", scheme: "postgres://bun_sql_test" },
  { image: "mysql_plain", prefix: "MYSQL", scheme: "mysql://root" },
  { image: "mariadb_plain", prefix: "MYSQL", scheme: "mariadb://root" },
];
for (const { image, prefix, scheme } of servers) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    const connect = async () => {
      await container.ready;
      return new SQL(`${scheme}@${container.host}:${container.port}/bun_sql_test`, { max: 1 });
    };
    const shared = whatStaysInTheTable(prefix, connect);
    reservations(shared);
    asyncContext(shared, connect);

    test("Array[Symbol.hasInstance] of the program makes no array of queries or of results a result", async () => {
      await container.ready;
      expect(await withHasInstanceOfArray(`${scheme}@${container.host}:${container.port}/bun_sql_test`)).toEqual({
        stdout: { pipeline: stored, statements: [[{ x: 1 }], [{ x: 2 }], [{ x: 3 }]] },
        stderr: "",
        exitCode: 0,
      });
    });
  });
}

describe.concurrent("sqlite", () => {
  whatStaysInTheTable("SQLITE", async () => new SQL("sqlite://:memory:"));

  test("Array[Symbol.hasInstance] of the program makes no array of queries a result", async () => {
    expect(await withHasInstanceOfArray("sqlite://:memory:")).toEqual({
      stdout: { pipeline: stored, statements: [{ x: 1 }] },
      stderr: "",
      exitCode: 0,
    });
  });
});

// Not concurrent: they wait for the collector.
describeWithContainer("a reservation that is dropped without release()", { image: "postgres_plain" }, container => {
  const connect = async (onclose?: () => void) => {
    await container.ready;
    return new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1, onclose });
  };
  async function collectUntil(done: () => boolean) {
    for (let i = 0; i < 50 && !done(); i++) {
      Bun.gc(true);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  function waitForTheConnection(sql: SQL) {
    const state = { served: false };
    const query = sql`SELECT 1 AS x`.then(rows => ((state.served = true), rows));
    return { state, query };
  }

  test.each([false, true])(
    "its connection goes back to the pool when it is collected (signal: %p)",
    async withSignal => {
      const sql = await connect();
      const controller = new AbortController();
      try {
        await (async () => void (await sql.reserve(withSignal ? { signal: controller.signal } : undefined)))();
        const { state, query } = waitForTheConnection(sql);
        await collectUntil(() => state.served);
        expect(state.served).toBe(true);
        expect(await query).toEqual([{ x: 1 }]);
      } finally {
        await sql.close({ timeout: 0 });
      }
    },
  );

  test("a handle that was released, or lost its connection, gives nothing back when it is collected", async () => {
    const closed = Promise.withResolvers<void>();
    await using sql = await connect(closed.resolve);
    await using admin = await connect();
    let collected = 0;
    const observer = new FinalizationRegistry(() => void collected++);
    await (async () => {
      const lost = await sql.reserve();
      observer.register(lost, undefined);
      const [{ pid }] = await lost`SELECT pg_backend_pid() AS pid`;
      await admin`SELECT pg_terminate_backend(${pid})`;
      await closed.promise;
      const released = await sql.reserve();
      observer.register(released, undefined);
      released.release();
    })();
    // A second release() would put the connection back under this reservation, and the query would run on it at once.
    const reserved = await sql.reserve();
    await collectUntil(() => collected === 2);
    expect(collected).toBe(2);
    const { state, query } = waitForTheConnection(sql);
    await reserved`SELECT 2`;
    expect(state.served).toBe(false);
    reserved.release();
    expect(await query).toEqual([{ x: 1 }]);
  });

  test("the connection goes back after the transaction that runs on it, and a kept `tx` does not hold it", async () => {
    const sql = await connect();
    const callback = parked();
    try {
      let kept: unknown;
      let servedInTransaction: boolean | undefined;
      const transaction = (async () =>
        (await sql.reserve()).begin(async tx => {
          kept = tx;
          await tx`SELECT 1`;
          callback.enter();
          await callback.gate;
          // A query that was served on this connection was written before this statement, so it is answered by now.
          await tx`SELECT 2`;
          servedInTransaction = state.served;
        }))();
      await callback.entered;
      const { state, query } = waitForTheConnection(sql);
      let passes = 0;
      await collectUntil(() => ++passes > 5);
      callback.go();
      await transaction;
      await collectUntil(() => state.served);
      expect({ servedInTransaction, served: state.served, kept: typeof kept }).toEqual({
        servedInTransaction: false,
        served: true,
        kept: "function",
      });
      await query;
    } finally {
      callback.go();
      await sql.close({ timeout: 0 });
    }
  });
});
