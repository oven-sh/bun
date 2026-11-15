// Runs the scenarios in SCENARIOS (a JSON array of names) against a mock server in this process and
// prints, one line per scenario, the frontend messages that the client sent.
// It is a subprocess because a broken build aborts in these scenarios.
import { SQL } from "bun";
import {
  pgBackendKeyData,
  pgBindComplete,
  pgBindParameters,
  pgCancelRequest,
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

// The process stops before the timeout of its test, and it does not outlive a test run that was killed.
setTimeout(() => process.exit(124), 25_000).unref();

// A Bind is recorded with the parameter it carries, and its Execute answers with that parameter.
// So a query that resolves with its own parameter got its own reply.
let frames: string[] = [];
let bound = Buffer.alloc(0);
let parameterCount = 0;
let parameterType = 25; // text
let refused = false;
let refuseNextBind = false;
const mock = await pgMockServer((type, body) => {
  switch (type) {
    case "P":
      frames.push("P");
      // Statement name, query, then the count of parameter types.
      parameterCount = body.readInt16BE(body.indexOf(0, body.indexOf(0) + 1) + 1);
      return [pgBackendKeyData(1, 2), pgParseComplete()];
    case "D":
      frames.push("D");
      return [
        pgParameterDescription(Array(parameterCount).fill(parameterType)),
        pgRowDescription([{ name: "v", typeOid: 25 }]),
      ];
    case "B": {
      const params = pgBindParameters(body);
      bound = params[0] ?? Buffer.alloc(0);
      frames.push(`B(${params.map(String).join(",")})`);
      refused = refuseNextBind;
      refuseNextBind = false;
      if (refused) return pgErrorResponse({ S: "ERROR", C: "26000", M: "prepared statement does not exist" });
      return String(bound) === "held" ? [pgBindComplete(), pgHold] : pgBindComplete();
    }
    case "E":
      frames.push("E");
      return refused ? [] : [pgDataRow([bound]), pgCommandComplete("SELECT 1")];
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

mock.server.on("connection", socket =>
  socket.once("data", (startup: Buffer) => {
    if (!startup.equals(pgCancelRequest(1, 2))) return;
    frames.push("CancelRequest");
    mock.release();
  }),
);

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

type Query = SQL.Query<unknown>;
type Action = "cancel" | "throw" | "close" | "cancel the running query";
async function getter(action: Action, prepare: boolean, nthRead: number) {
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, prepare });
  const query = (values: unknown[]) => sql.unsafe("select $1 as v, $2", values);
  await query(["warm", "-"]);
  frames = [];

  // With prepare: true it is still in the write buffer when the next Bind is written, unless it is held.
  const before: Query = query([action === "cancel the running query" ? "held" : "before", "-"]).execute();
  if (action === "cancel the running query") await mock.held();

  // unsafe() copies its values with slice(), so Symbol.species decides which array the client reads them from.
  const copy: unknown[] = [];
  const species = function () {
    return copy;
  };
  const outer: Query = query(Object.assign(["outer", "-"], { constructor: { [Symbol.species]: species } }));
  let reads = 0;
  Object.defineProperty(copy, 1, {
    get() {
      if (++reads !== nthRead) return "-";
      if (action === "throw") throw new Error("boom");
      if (action === "close") sql.close({ timeout: 0 });
      else (action === "cancel" ? outer : before).cancel();
      return "-";
    },
  });
  outer.execute();
  const [, result, after] = await Promise.all([before, outer, query(["after", "-"])].map(settle));
  return { outer: result, after, frames };
}

async function toStringAfterReprepare() {
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
  // As bytea an Int32Array goes out as its bytes, so nothing converts it before the first Bind.
  parameterType = 17;
  await sql`select ${Int32Array.of(0x41414141)} as v`;
  parameterType = 25;
  refuseNextBind = true;
  frames = [];
  const param = Object.assign(Int32Array.of(0x41414141), {
    toString() {
      sql.close({ timeout: 0 });
      return "outer";
    },
  });
  return { outer: await settle(sql`select ${param} as v`), frames };
}

async function rowSetter() {
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
  await sql`select ${"warm"} as v`;
  frames = [];
  let nested!: Promise<unknown>;
  Object.defineProperty(Array.prototype, 0, {
    configurable: true,
    set(value) {
      if (value?.v === "outer") {
        delete (Array.prototype as any)[0];
        nested = sql`select ${"nested"} as v`.execute();
      }
      Object.defineProperty(this, 0, { value, writable: true, enumerable: true, configurable: true });
    },
  });
  const outer = await settle(sql`select ${"outer"} as v`);
  return { outer, nested: await settle(nested), frames };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  "prepared statement": () => run({}, true),
  "prepared statement, nested query without parameters": () => run({}, true, "no parameter"),
  "prepared statement, nested simple query": () => run({}, true, "simple"),
  "first execution": () => run({}, false),
  "prepare: false": () => run({ prepare: false }, false),
  "toString() after the statement was prepared again": toStringAfterReprepare,
  "a setter on Array.prototype": rowSetter,
};
for (const action of ["cancel", "throw", "close", "cancel the running query"] as const) {
  for (const prepare of [true, false]) {
    for (const nthRead of [1, 2, 3, 4, 5]) {
      scenarios[`${action}, prepare: ${prepare}, read ${nthRead}`] = () => getter(action, prepare, nthRead);
    }
  }
}

for (const name of JSON.parse(process.env.SCENARIOS!) as string[]) {
  console.log(JSON.stringify(await scenarios[name]()));
}
mock.server.close();
