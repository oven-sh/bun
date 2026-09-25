// Runs the scenarios in SCENARIOS (a JSON array of names) against a mock server in this process and
// prints, one line per scenario, the frontend messages that the client sent.
// It is a subprocess because a broken build aborts in these scenarios.
import { SQL } from "bun";
import {
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgDataRow,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// A broken build hangs in these scenarios. The process must not outlive the test that started it.
setTimeout(() => process.exit(124), 30_000).unref();

// A Bind is recorded with the parameter it carries, and its Execute answers with that parameter.
// So a query that resolves with its own parameter got its own reply.
let frames: string[] = [];
let bound = Buffer.alloc(0);
let parameterCount = 0;
const mock = await pgMockServer((type, body) => {
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
      return pgBindComplete();
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
      // Starts while the outer Bind is encoded. It must reach the wire behind it.
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

const scenarios: Record<string, () => Promise<unknown>> = {
  "prepared statement": () => run({}, true),
  "prepared statement, nested query without parameters": () => run({}, true, "no parameter"),
  "prepared statement, nested simple query": () => run({}, true, "simple"),
  "first execution": () => run({}, false),
  "prepare: false": () => run({ prepare: false }, false),
};

for (const name of JSON.parse(process.env.SCENARIOS!) as string[]) {
  console.log(JSON.stringify(await scenarios[name]()));
}
mock.server.close();
