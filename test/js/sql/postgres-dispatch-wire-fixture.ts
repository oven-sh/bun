// Runs the scenarios in SCENARIOS (a JSON array of names) against a mock server in this process and
// prints, one line per scenario, the frontend messages that the client sent.
// It is a subprocess because a broken build aborts in these scenarios.
import { SQL } from "bun";
import type { Socket } from "node:net";
import {
  loopbackFence,
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgHold,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// The process stops before the timeout of its test, and it does not outlive a test run that was killed.
setTimeout(() => process.exit(124), 25_000).unref();

// A Bind is recorded with the parameter it carries, and its Execute answers with that parameter.
// So a query that resolves with its own parameter got its own reply.
let frames: string[] = [];
let bound = Buffer.alloc(0);
let parameterCount = 0;
let session: Socket;
const mock = await pgMockServer((type, body, socket) => {
  session = socket;
  switch (type) {
    case "P":
      frames.push("P");
      // Statement name, query, then the count of parameter types.
      parameterCount = body.readInt16BE(body.indexOf(0, body.indexOf(0) + 1) + 1);
      return pgParseComplete();
    case "D":
      frames.push("D");
      return [
        pgParameterDescription(Array(parameterCount).fill(25 /* text */)),
        pgRowDescription([{ name: "v", typeOid: 25 }]),
      ];
    case "B": {
      const params = pgBindParameters(body);
      bound = params[0] ?? Buffer.alloc(0);
      frames.push(`B(${params.map(String).join(",")})`);
      return String(bound) === "second" ? [pgHold, pgBindComplete()] : pgBindComplete();
    }
    case "E":
      frames.push("E");
      return [pgDataRow([bound]), pgCommandComplete("SELECT 1")];
    case "S":
      frames.push("S");
      return pgReadyForQuery();
    case "Q":
      frames.push("Q");
      return [
        pgRowDescription([{ name: "v", typeOid: 25 }]),
        pgDataRow([Buffer.from("simple")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ];
    default:
      frames.push(type);
  }
});

const text = (value: string) => ({ toString: () => value });
const settle = (promise: Promise<unknown>) =>
  promise.then(
    rows => ({ ok: [...(rows as unknown[])] }),
    (e: any) => ({ err: e?.code ?? e?.message ?? String(e) }),
  );

type Nested = "parameter" | "no parameter" | "simple";
async function run(options: { prepare?: boolean }, warmOuter: boolean, kind: Nested = "parameter") {
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, ...options });
  await sql`select ${"warm"} as v /* nested */`;
  if (warmOuter) await sql`select ${text("warm")} as v /* outer */`;
  frames = [];

  let nested!: Promise<unknown>;
  const param = {
    toString() {
      // Starts while the parameter of the outer query is converted. It must reach the wire behind it.
      nested = {
        "parameter": () => sql`select ${"nested"} as v /* nested */`,
        "no parameter": () => sql`select '' as v /* no parameter */`,
        "simple": () => sql.unsafe("select 'simple' as v"),
      }
        [kind]()
        .execute();
      return "outer";
    },
  };
  const outer = await settle(sql`select ${param} as v /* outer */`);
  return { outer, nested: await settle(nested), frames };
}

const connect = () => new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });

/** Bun.build() runs the event loop until an async setup() settles. */
function runEventLoop(until: Promise<unknown> = loopbackFence()) {
  const plugins = [{ name: "wait", setup: async () => void (await until) }];
  Bun.build({ entrypoints: ["/a.js"], files: { "/a.js": "" }, plugins });
}

/** `act` runs at the third read of the hole: for the types, for the conversion, for the Bind. */
async function withHole(act: (query: SQL.Query<any>, buffered?: Promise<unknown>) => void, ahead = false) {
  await using sql = connect();
  const statement = (values: unknown[]) => sql.unsafe("select $1 as v, $2, $3", values);
  await statement(["warm", "y", "1"]);
  frames = [];

  const query = statement(["x", , "1"]);
  let reads = 0;
  Object.defineProperty(Array.prototype, "1", {
    configurable: true,
    get() {
      if (this.length === 3 && this[0] === "x" && ++reads === 3) act(query, buffered);
      return "y";
    },
    set(value) {
      Object.defineProperty(this, "1", { value, writable: true, enumerable: true, configurable: true });
    },
  });
  const buffered = ahead ? settle(statement(["ahead", "y", "1"]).execute()) : undefined;
  const result = await settle(query);
  delete (Array.prototype as any)[1];
  const next = await settle(statement(["next", "y", "1"]));
  return { ahead: await buffered, result, next, frames };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  "prepared statement": () => run({}, true),
  "prepared statement, nested query without parameters": () => run({}, true, "no parameter"),
  "prepared statement, nested simple query": () => run({}, true, "simple"),
  "first execution": () => run({}, false),
  "prepare: false": () => run({ prepare: false }, false),
  "cancel() in the middle of a Bind": () => withHole(query => query.cancel()),
  "a Bind waits for the query ahead": () => withHole((_, buffered) => runEventLoop(buffered), true),
  "a Bind waits for the query ahead, then cancels its own": () =>
    withHole((query, buffered) => (runEventLoop(buffered), query.cancel()), true),
  "a Bind waits for the query ahead, then throws": () =>
    withHole((_, buffered) => {
      runEventLoop(buffered);
      throw new RangeError("boom");
    }, true),
  async "a ParameterDescription comes in during the conversion"() {
    await using sql = connect();
    await sql`select ${text("warm")} as v, ${text("y")}`;
    const param = {
      toString() {
        session.write(pgParameterDescription([25, 25]));
        runEventLoop();
        return "x";
      },
    };
    return { result: await settle(sql`select ${param} as v, ${text("y")}`) };
  },
  async "a reply comes in while the query ahead resolves"() {
    await using sql = connect();
    await sql`select ${"warm"} as v`;
    let armed = true;
    // Read when the promise of a query is resolved with its rows.
    Object.defineProperty(Array.prototype, "then", {
      configurable: true,
      get() {
        if (!armed || this[0]?.v !== "first") return;
        armed = false;
        mock.release();
        runEventLoop();
      },
    });
    const queries = [sql`select ${"first"} as v`.execute(), sql`select ${"second"} as v`.execute()];
    return { results: await Promise.all(queries.map(settle)) };
  },
};

for (const name of JSON.parse(process.env.SCENARIOS!) as string[]) {
  console.log(JSON.stringify(await scenarios[name]()));
}
mock.server.close();
