// Runs the scenarios in SCENARIOS (a JSON array of names) against the server at DATABASE_URL, each
// on a new connection, and prints one line per scenario: what every query settled with.
// It is a subprocess because a broken build aborts or hangs in these scenarios.
import { SQL, type ReservedSQL } from "bun";
import { drainMicrotasks } from "bun:jsc";
import vm from "node:vm";

const url = process.env.DATABASE_URL!;
let sql!: SQL;

// A plain object goes out as text: the Bind encoder calls its toString().
const text = (value: string) => ({ toString: () => value });

let conversions = 0;
let dispatched: Promise<unknown>[] = [];
// close() waits for every query. A query that a termination stopped never settles.
let closeAtEnd = true;
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

/** Runs the event loop until `promise` settles: Bun.build() waits for an async plugin setup(). */
function waitInsideConversion(promise: Promise<unknown>) {
  const settled = promise.then(
    () => {},
    () => {},
  );
  Bun.build({
    entrypoints: [import.meta.path],
    target: "bun",
    plugins: [{ name: "wait", setup: () => settled }],
  }).catch(() => {});
}

/** The deferred flush has run: what was executed before is on the wire. */
const onTheWire = () => new Promise(resolve => setImmediate(resolve));

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

  // then() starts a query one microtask later. drainMicrotasks() runs that microtask at once.
  async "prepared statement, nested query started by drainMicrotasks()"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => {
        dispatched.push(sql`select 2 as y`.then(rows => rows));
        drainMicrotasks();
      })}::text as x`,
    );
  },

  // notify() starts its query with execute().
  async "prepared statement, nested notify()"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql.notify("dispatch_during_bind", "payload")))}::text as x`,
    );
  },

  async "first execution, conversion throws after dispatching"() {
    return throwAfterDispatching(sql, await backendPid(sql));
  },

  async "prepared statement, conversion throws after dispatching"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return throwAfterDispatching(sql, pid);
  },

  async "prepare: false, conversion throws after dispatching"() {
    await using unprepared = new SQL({ url, max: 1, idleTimeout: 30, prepare: false });
    return await throwAfterDispatching(unprepared, await backendPid(unprepared));
  },

  // The outer request is not at the head of the queue when its Bind fails.
  async "prepared statement behind an in-flight query, conversion throws after dispatching"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    const ahead = sql`select ${text("7")}::text as x`.execute();
    // Issues the outer query synchronously, while `ahead` is still in flight.
    const rest = throwAfterDispatching(sql, pid);
    return { ahead: await settle(ahead), ...(await rest) };
  },

  // The simple query is the first thing that the conversion dispatches: the connection looks idle.
  async "prepared statement, nested simple query"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    return report(
      sql,
      pid,
      sql`select ${dispatching("1", () => dispatched.push(sql.unsafe("select 'simple' as s").execute()))}::text as x`,
    );
  },

  // The outer request goes between the two requests in flight and the three that it dispatched.
  async "prepared statement behind two in-flight queries, nested burst"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    await sql`select ${"warm"}::text as t`;
    const ahead = [sql`select ${text("7")}::text as x`.execute(), sql`select ${"8"}::text as t`.execute()];
    const outer = sql`select ${dispatching("1", () => {
      dispatched.push(sql`select ${"a"}::text as t`.execute());
      dispatched.push(sql`select 3 as y`.execute());
      dispatched.push(sql`select ${text("2")}::text as x`.execute());
    })}::text as x`.execute();
    const later = [sql`select ${text("9")}::text as x`.execute(), sql`select ${"10"}::text as t`.execute()];
    return {
      ahead: await Promise.all(ahead.map(settle)),
      later: await Promise.all(later.map(settle)),
      ...(await report(sql, pid, outer)),
    };
  },

  // The reply of the request in flight is handled while the outer Bind is half written.
  async "prepared statement, a reply comes in during the conversion"() {
    return replyDuringConversion(1);
  },

  async "prepared statement, two replies come in during the conversion"() {
    return replyDuringConversion(2);
  },

  // advance() encodes `nested` when the reply of `first` comes in. `blocked` and `outer` are in
  // flight ahead of it, and their replies come in while the parameter of `nested` is converted.
  async "a request that advance() encodes, two replies come in during the conversion"() {
    const pid = await backendPid(sql);
    const key = process.pid;
    await using other = new SQL({ url, max: 1 });
    await sql`select ${text("0")}::text as x`;
    await sql`select pg_advisory_xact_lock(${text(String(key))}::text::bigint), ${text("0")}::text as x`;
    // `blocked` waits on the server until `other` releases the lock.
    await other`select pg_advisory_lock(${key})`;
    const first = settle(sql`select ${text("first")}::text as x`.execute());
    const blocked = settle(
      sql`select pg_advisory_xact_lock(${text(String(key))}::text::bigint), ${text("blocked")}::text as x`.execute(),
    );
    let nested!: Promise<unknown>;
    const waits = dispatching("nested", () =>
      waitInsideConversion(other`select pg_advisory_unlock(${key})`.then(() => Promise.all([blocked, outer]))),
    );
    const outer = settle(
      sql`select ${dispatching("outer", () => (nested = settle(sql`select ${waits}::text as x`.execute())))}::text as x`.execute(),
    );
    const later = settle(sql`select ${text("later")}::text as x`.execute());
    const result = {
      first: await first,
      blocked: await blocked,
      outer: await outer,
      nested: await nested,
      later: await later,
      conversions,
    };
    return { ...result, sameBackend: (await backendPid(sql)) === pid };
  },

  // The timeout of node:vm stops the conversion with a termination, after it dispatched a query.
  async "prepared statement, node:vm timeout stops the conversion after it dispatched"() {
    const pid = await backendPid(sql);
    await sql`select ${text("0")}::text as x`;
    const param = {
      toString() {
        conversions++;
        dispatched.push(sql`select 2 as y`.execute());
        for (;;) {}
      },
    };
    let thrown: unknown;
    closeAtEnd = false;
    (globalThis as any).run = () => sql`select ${param}::text as x`.execute();
    try {
      vm.runInThisContext("run()", { timeout: 50 });
    } catch (e: any) {
      thrown = e?.code;
    }
    return {
      thrown,
      dispatched: await Promise.all(dispatched.map(settle)),
      conversions,
      sameBackend: (await backendPid(sql)) === pid,
    };
  },

  // advance() rejects the request through the reject callback.
  async "prepare: false, conversion throws a value that is not an Error"() {
    await using unprepared = new SQL({ url, max: 1, idleTimeout: 30, prepare: false });
    const pid = await backendPid(unprepared);
    const thrown: unknown[] = [];
    for (const value of [undefined, null, 0, "text"]) {
      const param = {
        toString() {
          throw value;
        },
      };
      thrown.push(
        await unprepared`select ${param}::text as x`.then(
          () => "resolved",
          e => ({ rejected: e === undefined ? "undefined" : e }),
        ),
      );
    }
    return { thrown, sameBackend: (await backendPid(unprepared)) === pid };
  },
};

async function replyDuringConversion(inFlight: number) {
  const pid = await backendPid(sql);
  await sql`select ${text("0")}::text as x`;
  await sql`select pg_sleep(${text("0")}::text::float8), ${text("0")}::text as x`;
  // The server answers the first one after 0.2 s, so the replies are not here before the conversion.
  const ahead = Array.from({ length: inFlight }, (_, i) =>
    settle(
      sql`select pg_sleep(${text(i === 0 ? "0.2" : "0")}::text::float8), ${text(`ahead ${i}`)}::text as x`.execute(),
    ),
  );
  await onTheWire();
  const outer = sql`select ${dispatching("1", () => waitInsideConversion(Promise.all(ahead)))}::text as x`.execute();
  const later = settle(sql`select ${text("later")}::text as x`.execute());
  return { ahead: await Promise.all(ahead), later: await later, ...(await report(sql, pid, outer)) };
}

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

let aheadConverted = false;
/** The parameter of the request ahead of the one that closes. It records that its Bind was encoded. */
const ahead = {
  toString() {
    aheadConverted = true;
    return "2";
  },
};

/** The values of a query whose first value is read by a getter that closes the connection. */
function closingValues(reserved: ReservedSQL) {
  let closed = false;
  return Object.defineProperty([] as unknown[], 0, {
    enumerable: true,
    get() {
      if (!closed) {
        closed = true;
        reserved.close();
      }
      return "1";
    },
  });
}

async function closeScenario(options: { prepare?: boolean }, run: (reserved: ReservedSQL) => Promise<object>) {
  // Not closed at the end: a request left on the closed connection keeps the process alive.
  const db = new SQL({ url, max: 1, ...options });
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
      const first = reserved`select ${ahead}::text as x`.execute();
      const outer = reserved`select ${closing(reserved)}::text as x`.execute();
      return { ahead: await settle(first), outer: await settle(outer), aheadConverted };
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
      const first = reserved`select ${ahead}::text as x`.execute();
      const outer = reserved`select ${closing(reserved)}::text as x`.execute();
      return { ahead: await settle(first), outer: await settle(outer), aheadConverted };
    });
  },

  async "close() from a conversion, prepare: false"() {
    return closeScenario({ prepare: false }, async reserved => ({
      outer: await settle(reserved`select ${closing(reserved)}::text as x`),
    }));
  },

  // The getter runs when the statement's signature is made, before any Bind is encoded.
  async "close() from a getter of the values, first execution"() {
    return closeScenario({}, async reserved => ({
      outer: await settle(reserved.unsafe("select $1::text as x", closingValues(reserved))),
    }));
  },

  async "close() from a getter of the values, prepared statement"() {
    return closeScenario({}, async reserved => {
      await reserved.unsafe("select $1::text as x", ["0"]);
      return { outer: await settle(reserved.unsafe("select $1::text as x", closingValues(reserved))) };
    });
  },

  async "close() from a getter of the values, prepare: false"() {
    return closeScenario({ prepare: false }, async reserved => ({
      outer: await settle(reserved.unsafe("select $1::text as x", closingValues(reserved))),
    }));
  },
};

/** Issues the outer query synchronously. Everything after the first await is reporting. */
async function throwAfterDispatching(db: SQL, pid: number) {
  const param = {
    toString() {
      conversions++;
      dispatched.push(db`select 2 as y`.execute());
      throw new RangeError("boom");
    },
  };
  return report(db, pid, db`select ${param}::text as x`);
}

for (const name of JSON.parse(process.env.SCENARIOS!) as string[]) {
  const scenario = scenarios[name] ?? closeScenarios[name];
  if (!scenario) {
    console.log(JSON.stringify({ error: `unknown scenario ${name}` }));
    process.exit(1);
  }
  sql = new SQL({ url, max: 1, idleTimeout: 30 });
  await sql.connect();
  conversions = 0;
  dispatched = [];
  aheadConverted = false;
  closeAtEnd = true;
  console.log(JSON.stringify(await scenario()));
  if (closeAtEnd) await sql.close();
}
