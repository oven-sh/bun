// Runs one scenario (SCENARIO) against the server at DATABASE_URL and prints what every query
// settled with. It is a subprocess because a broken build aborts or hangs in these scenarios.
import { SQL, type ReservedSQL } from "bun";

const url = process.env.DATABASE_URL!;
const sql = new SQL({ url, max: 1, idleTimeout: 30 });
await sql.connect();

// A plain object goes out as text: the Bind encoder calls its toString().
const text = (value: string) => ({ toString: () => value });

let conversions = 0;
const dispatched: Promise<unknown>[] = [];
/** A text parameter whose first conversion runs `dispatch`, from inside the Bind encoder. */
function dispatching(value: string, dispatch: () => void) {
  let fired = false;
  return {
    toString() {
      conversions++;
      if (!fired) {
        fired = true;
        dispatch();
      }
      return value;
    },
  };
}

function settle(promise: Promise<unknown>) {
  return promise.then(
    rows => ({ ok: [...(rows as unknown[])] }),
    (e: any) => ({ err: e?.code ?? e?.message ?? String(e) }),
  );
}

const backendPid = async (db: SQL) => (await db`select pg_backend_pid() as pid`)[0].pid;

async function report(db: SQL, pid: number, outer: Promise<unknown>) {
  const result = {
    outer: await settle(outer),
    dispatched: await Promise.all(dispatched.map(settle)),
    conversions,
  };
  // A later query on the same backend: the connection was not lost.
  return { ...result, sameBackend: (await backendPid(db)) === pid };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // First execution: the Bind is written from advance(), after the Parse round trip.
  async "first execution, nested new statement"() {
    const pid = await backendPid(sql);
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql`select 2 as y`.execute()))}::text as x`,
    );
  },

  async "first execution, nested prepared statement"() {
    const pid = await backendPid(sql);
    await sql`select ${"warm"}::text as t`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql`select ${"nested"}::text as t`.execute()))}::text as x`,
    );
  },

  // Outer statement already prepared: run() writes its Bind before the request is queued.
  async "prepared statement, nested new statement"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql`select 2 as y`.execute()))}::text as x`,
    );
  },

  async "prepared statement, nested same statement"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql`select ${text("2")}::text as x`.execute()))}::text as x`,
    );
  },

  // Prepared statements, a new statement and a simple query from one conversion.
  async "prepared statement, nested burst"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    await sql`select ${"warm"}::text as t`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => {
        dispatched.push(sql`select ${"a"}::text as t`.execute());
        dispatched.push(sql`select ${text("2")}::text as x`.execute());
        dispatched.push(sql`select 3 as y`.execute());
        dispatched.push(sql.unsafe("select 'simple' as s").execute());
        dispatched.push(sql`select ${"b"}::text as t`.execute());
      })}::text as x`,
    );
  },

  async "nested query dispatches again from its own bind"() {
    const pid = await backendPid(sql);
    const third = dispatching("3", () => {});
    const second = dispatching("2", () => dispatched.push(sql`select ${third}::text as x`.execute()));
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql`select ${second}::text as x`.execute()))}::text as x`,
    );
  },

  async "inside a transaction"() {
    let nested: Promise<unknown> | undefined;
    const rows = await settle(
      sql.begin(async tx => {
        const outer = await tx`select ${dispatching("1", () => (nested = tx`select 2 as y`.execute()))}::text as x`;
        return [[...outer], [...((await nested) as unknown[])]];
      }),
    );
    return { rows, conversions };
  },

  // prepare: false sends Parse, Bind and Execute as one batch from advance().
  async "prepare: false"() {
    await using unprepared = new SQL({ url, max: 1, idleTimeout: 30, prepare: false });
    const pid = await backendPid(unprepared);
    const param = dispatching("1", () => {
      dispatched.push(unprepared`select 2 as y`.execute());
      dispatched.push(unprepared`select ${"nested"}::text as t`.execute());
    });
    // Awaited here, so that `unprepared` is not disposed before the queries settle.
    return await report(unprepared, pid, unprepared`select ${param}::text as x`);
  },

  async "prepared statement, conversion throws after dispatching"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return throwAfterDispatching(pid);
  },

  // The outer request is not at the head of the queue when its Bind fails.
  async "prepared statement behind an in-flight query, conversion throws after dispatching"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    const ahead = sql`select ${text("7")}::text as x`.execute();
    // Issues the outer query synchronously, while `ahead` is still in flight.
    const rest = throwAfterDispatching(pid);
    return { ahead: await settle(ahead), ...(await rest) };
  },
};

/** A text parameter whose conversion closes the connection that its query is written to. */
function closing(reserved: ReservedSQL) {
  let closed = false;
  return {
    toString() {
      if (!closed) {
        closed = true;
        reserved.close();
      }
      return "1";
    },
  };
}

async function closeScenario(options: { prepare?: boolean }, run: (reserved: ReservedSQL) => Promise<object>) {
  await using db = new SQL({ url, max: 1, ...options });
  const reserved = await db.reserve();
  const result = await run(reserved);
  // The pool opens a new connection in place of the closed one.
  return { ...result, afterwards: await settle(db`select 1 as ok`) };
}

const closeScenarios: Record<string, () => Promise<unknown>> = {
  async "close() from a conversion, first execution"() {
    return closeScenario({}, async reserved => ({
      outer: await settle(reserved`select ${closing(reserved)}::text as x`),
    }));
  },

  // advance() encodes the first request, then the one that closes.
  async "close() from a conversion, request queued ahead"() {
    return closeScenario({}, async reserved => {
      const ahead = reserved`select ${text("2")}::text as x`.execute();
      const outer = reserved`select ${closing(reserved)}::text as x`.execute();
      return { ahead: await settle(ahead), outer: await settle(outer) };
    });
  },

  async "close() from a conversion, prepared statement"() {
    return closeScenario({}, async reserved => {
      await reserved`select ${text("0")}::text as x`;
      return { outer: await settle(reserved`select ${closing(reserved)}::text as x`) };
    });
  },

  // The first request's Bind is still in the write buffer when the second one closes.
  async "close() from a conversion, request buffered ahead"() {
    return closeScenario({}, async reserved => {
      await reserved`select ${text("0")}::text as x`;
      const ahead = reserved`select ${text("2")}::text as x`.execute();
      const outer = reserved`select ${closing(reserved)}::text as x`.execute();
      return { ahead: await settle(ahead), outer: await settle(outer) };
    });
  },

  async "close() from a conversion, prepare: false"() {
    return closeScenario({ prepare: false }, async reserved => ({
      outer: await settle(reserved`select ${closing(reserved)}::text as x`),
    }));
  },
};

/** Issues the outer query synchronously. Everything after the first await is reporting. */
async function throwAfterDispatching(pid: number) {
  const param = {
    toString() {
      conversions++;
      dispatched.push(sql`select 2 as y`.execute());
      throw new RangeError("boom");
    },
  };
  return report(sql, pid, sql`select ${param}::text as x`);
}

const scenario = scenarios[process.env.SCENARIO!] ?? closeScenarios[process.env.SCENARIO!];
if (!scenario) {
  console.log(JSON.stringify({ error: `unknown scenario ${process.env.SCENARIO}` }));
  process.exit(1);
}
console.log(JSON.stringify(await scenario()));
await sql.close();
