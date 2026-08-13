// Fixture for postgres-dispatch-during-bind.test.ts. Runs one scenario (named
// by SCENARIO) against the server at DATABASE_URL in its own process, because
// before the fix several of these scenarios abort the process (panic in the
// Bind encoder) or wedge the connection instead of failing a single assertion.
// The test kills a wedged fixture when it times out.
//
// Every scenario binds a parameter whose conversion (valueOf(), or toString()
// where the parameter goes out in text format) dispatches more queries on the
// same (max: 1) connection while the outer query's Bind message is being
// encoded, and reports what each query settled with plus how many times the
// parameter was converted. One conversion per query is the observable side of
// "one Bind message per request".
import { SQL } from "bun";

const sql = new SQL({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 30 });
await sql.connect();

// The int4 parameters below are all plain objects, so within a scenario the
// warm-up query and the outer query map to the same prepared statement (the
// statement name encodes the parameters' JS types). `::int4` makes the server
// type the parameter as int4, which is what gets valueOf() called while the
// Bind is encoded.
const int = (n: number) => ({ valueOf: () => n });

let conversions = 0;
const dispatched: Promise<unknown>[] = [];
/** int4 parameter whose first conversion runs `dispatch` (synchronously, inside the Bind encoder). */
function dispatching(value: number, dispatch: () => void) {
  let fired = false;
  return {
    valueOf() {
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
    ok => ({ ok }),
    (e: any) => ({ err: e?.code ?? e?.message ?? String(e) }),
  );
}

async function report(outer: Promise<unknown>) {
  return {
    outer: await settle(outer),
    dispatched: await Promise.all(dispatched.map(settle)),
    conversions,
  };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // First execution of the statement: Parse round trip first, then the Bind is
  // written from advance() in the ReadyForQuery handler. The nested query is a
  // new statement text, so it is enqueued and tries to drain the queue itself.
  async "first execution, nested new statement"() {
    return report(sql`select ${dispatching(1, () => dispatched.push(sql`select 2 as y`.execute()))}::int4 as x`);
  },

  // Same outer shape; the nested query reuses a statement prepared earlier, the
  // shape that writes its Bind at enqueue time.
  async "first execution, nested prepared statement"() {
    await sql`select ${"warm"}::text as t`;
    return report(
      sql`select ${dispatching(1, () => dispatched.push(sql`select ${"nested"}::text as t`.execute()))}::int4 as x`,
    );
  },

  // Outer statement already prepared: its Bind is written at enqueue time, from
  // run(), with the request not yet in the queue. The nested query is a new
  // statement text.
  async "prepared statement, nested new statement"() {
    await sql`select ${int(0)}::int4 as x`;
    return report(sql`select ${dispatching(1, () => dispatched.push(sql`select 2 as y`.execute()))}::int4 as x`);
  },

  // Both outer and nested take the enqueue-time path; the nested one is the
  // very same statement.
  async "prepared statement, nested same statement"() {
    await sql`select ${int(0)}::int4 as x`;
    return report(
      sql`select ${dispatching(1, () => dispatched.push(sql`select ${int(2)}::int4 as x`.execute()))}::int4 as x`,
    );
  },

  // One conversion dispatches a burst: prepared statements, a new statement
  // text and a simple-protocol query. All of them have to come back in order.
  async "prepared statement, nested burst"() {
    await sql`select ${int(0)}::int4 as x`;
    await sql`select ${"warm"}::text as t`;
    return report(
      sql`select ${dispatching(1, () => {
        dispatched.push(sql`select ${"a"}::text as t`.execute());
        dispatched.push(sql`select ${int(2)}::int4 as x`.execute());
        dispatched.push(sql`select 3 as y`.execute());
        dispatched.push(sql.unsafe("select 'simple' as s").execute());
        dispatched.push(sql`select ${"b"}::text as t`.execute());
      })}::int4 as x`,
    );
  },

  // The nested query's own parameter dispatches yet another query when its
  // Bind is encoded in turn.
  async "nested query dispatches again from its own bind"() {
    const third = dispatching(3, () => {});
    const second = dispatching(2, () => dispatched.push(sql`select ${third}::int4 as x`.execute()));
    return report(
      sql`select ${dispatching(1, () => dispatched.push(sql`select ${second}::int4 as x`.execute()))}::int4 as x`,
    );
  },

  // Inside a transaction the nested query goes straight to the reserved
  // connection.
  async "inside a transaction"() {
    let nested: Promise<unknown> | undefined;
    const rows = await settle(
      sql.begin(async tx => {
        const outer = await tx`select ${dispatching(1, () => (nested = tx`select 2 as y`.execute()))}::int4 as x`;
        return [outer, await nested];
      }),
    );
    return { rows, conversions };
  },

  // prepare: false sends Parse+Bind+Execute in one batch from advance(); the
  // parameter is sent in text format there, so the conversion hook is
  // toString() rather than valueOf().
  async "unnamed statements (prepare: false)"() {
    await using unprepared = new SQL({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 30, prepare: false });
    const param = {
      toString() {
        conversions++;
        if (dispatched.length === 0) {
          dispatched.push(unprepared`select 2 as y`.execute());
          dispatched.push(unprepared`select ${"nested"}::text as t`.execute());
        }
        return "1";
      },
    };
    // Awaited here so that `unprepared` is not disposed before the queries settle.
    const result = await report(unprepared`select ${param}::int4 as x`);
    return result;
  },

  // The conversion dispatches a query and then throws. The outer query rejects
  // with that error; the dispatched one was only enqueued and must still be
  // dispatched afterwards rather than sit in the queue forever. (It currently
  // rejects: the aborted Bind leaves a torn message in the write buffer, which
  // makes the server drop the connection. Only its settling is asserted.)
  async "prepared statement, conversion throws after dispatching"() {
    await sql`select ${int(0)}::int4 as x`;
    const param = {
      valueOf() {
        conversions++;
        dispatched.push(sql`select 2 as y`.execute());
        throw new RangeError("boom");
      },
    };
    const outer = await settle(sql`select ${param}::int4 as x`);
    const settled = await Promise.all(dispatched.map(settle));
    // The pool reconnects if the torn message cost it the connection.
    const afterwards = await settle(sql`select 3 as z`);
    return { outer, dispatchedSettled: settled.length, afterwards, conversions };
  },
};

const scenario = scenarios[process.env.SCENARIO!];
if (!scenario) {
  console.log(JSON.stringify({ error: `unknown scenario ${process.env.SCENARIO}` }));
  process.exit(1);
}
console.log(JSON.stringify(await scenario()));
await sql.close();
