// Fixture for postgres-close-during-bind.test.ts. Runs the scenario named by
// SCENARIO against the server at DATABASE_URL in its own process, because
// before the fix every scenario aborts the process (panic in the Bind encoder)
// rather than failing an assertion.
//
// Each scenario binds a parameter whose conversion hook closes the reserved
// connection it is being sent on, i.e. close() runs while that query's Bind
// message is half encoded. `::int4` makes the server type the parameter as
// int4, so with a prepared statement the parameter is sent in binary format
// and the hook that runs is valueOf(); with prepare: false it is sent as text
// and the hook is toString(). The scenario reports how every query settled and
// which hook ran, then lets the process exit on its own: a request left
// enqueued on the dead connection would keep the event loop alive and the
// test would time out instead of seeing the exit.
import { SQL, type ReservedSQL } from "bun";

const url = process.env.DATABASE_URL!;

function settle(promise: Promise<unknown>) {
  return promise.then(
    ok => ({ ok }),
    (e: any) => ({ err: e?.code ?? e?.message ?? String(e) }),
  );
}

let closedFrom: string | null = null;
/** int4 parameter whose conversion closes `reserved`. */
function closing(reserved: ReservedSQL) {
  const close = (hook: string) => {
    if (closedFrom === null) {
      closedFrom = hook;
      reserved.close();
    }
  };
  return {
    valueOf() {
      close("valueOf");
      return 1;
    },
    toString() {
      close("toString");
      return "1";
    },
  };
}

let aheadConverted = false;
/** int4 parameter of the query dispatched ahead of the closing one; records that its Bind was encoded. */
const ahead = {
  valueOf() {
    aheadConverted = true;
    return 2;
  },
};

// Every parameter above is a plain object, so all the queries of a scenario
// share one prepared statement: the statement name is derived from the query
// text plus the parameters' JS types.
const warm = { valueOf: () => 0 };

async function scenario(options: { prepare?: boolean }, run: (reserved: ReservedSQL) => Promise<object>) {
  const sql = new SQL({ url, max: 1, ...options });
  const reserved = await sql.reserve();
  const result = await run(reserved);
  // The pool hands out a fresh connection in place of the closed one.
  const afterwards = await settle(sql`select 1 as ok`);
  return { ...result, closedFrom, afterwards };
}

const scenarios: Record<string, () => Promise<object>> = {
  // First execution of the statement: Parse round trip first, then the Bind is
  // encoded from advance() while handling the server's ReadyForQuery.
  async "first execution"() {
    return scenario({}, async reserved => ({
      outer: await settle(reserved`select ${closing(reserved)}::int4 as x`),
    }));
  },

  // Same, with a second query on the statement queued ahead of the closing
  // one: advance() encodes the first query's Bind, then the closing one, so
  // close() finds one request already encoded in the queue and one being
  // encoded behind it.
  async "first execution, request queued ahead"() {
    return scenario({}, async reserved => {
      const first = reserved`select ${ahead}::int4 as x`.execute();
      const outer = reserved`select ${closing(reserved)}::int4 as x`.execute();
      return { ahead: await settle(first), outer: await settle(outer), aheadConverted };
    });
  },

  // Statement already prepared: the Bind is encoded at dispatch time, from
  // run(), before the request is enqueued.
  async "prepared statement"() {
    return scenario({}, async reserved => {
      await reserved`select ${warm}::int4 as x`;
      return { outer: await settle(reserved`select ${closing(reserved)}::int4 as x`) };
    });
  },

  // Same, with another execution of the statement dispatched synchronously
  // before it, so its Bind is still sitting unflushed in the write buffer when
  // close() runs inside the second one's encoder.
  async "prepared statement, request buffered ahead"() {
    return scenario({}, async reserved => {
      await reserved`select ${warm}::int4 as x`;
      const first = reserved`select ${ahead}::int4 as x`.execute();
      const outer = reserved`select ${closing(reserved)}::int4 as x`.execute();
      return { ahead: await settle(first), outer: await settle(outer), aheadConverted };
    });
  },

  // prepare: false encodes Parse+Bind+Execute in one batch from advance(); the
  // parameter goes out in text format, so the hook that closes is toString().
  async "unnamed statement (prepare: false)"() {
    return scenario({ prepare: false }, async reserved => ({
      outer: await settle(reserved`select ${closing(reserved)}::int4 as x`),
    }));
  },
};

const run = scenarios[process.env.SCENARIO!];
if (!run) {
  console.log(JSON.stringify({ error: `unknown scenario ${process.env.SCENARIO}` }));
  process.exit(1);
}
console.log(JSON.stringify(await run()));
