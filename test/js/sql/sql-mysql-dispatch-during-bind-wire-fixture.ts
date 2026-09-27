// Runs in a subprocess of sql-mysql-dispatch-during-bind.test.ts, against the mock server of
// that test at MYSQL_MOCK_PORT. The mock records every command that reaches it, in order.
// Each scenario named in SCENARIOS gets a pool of one connection and prints one line of JSON.
// The script has no top-level await, no close() and no exit(): the process ends when nothing
// holds the event loop.
//
// The mock answers a statement with its parameter, and a simple query with its literal, in a
// column "v". So each request selects its own name, and the reply shows whose it is.
import { SQL } from "bun";

const url = `mysql://root@127.0.0.1:${process.env.MYSQL_MOCK_PORT}/db`;

type Outcome = { ok: unknown } | { err: string };

const outcome = (query: PromiseLike<unknown>): Promise<Outcome> =>
  Promise.resolve(query).then(
    rows => ({ ok: JSON.parse(JSON.stringify(rows)) }),
    error => ({ err: String(error?.code ?? error?.message ?? error) }),
  );

class Scenario {
  conversions = 0;
  dispatched: Promise<Outcome>[] = [];

  constructor(readonly sql: SQL) {}

  // "select ? as outer": the alias tells the statements apart, the parameter tells the requests apart.
  statement(name: string, parameter: unknown = name) {
    return this.sql.unsafe(`select ? as ${name}`, [parameter]);
  }

  simple(name: string) {
    return this.sql.unsafe(`select '${name}' as v`).simple();
  }

  // A query reaches the connection in the call that starts it, which is `execute()`.
  start(query: SQL.Query<any>): Promise<Outcome> {
    return outcome(query.execute());
  }

  // Starts a query from inside a conversion.
  dispatch(query: SQL.Query<any>) {
    this.dispatched.push(this.start(query));
  }

  // A string parameter. The adapter calls `toString` to convert it, and at no other time.
  text(value: string, convert: () => void): String {
    return Object.assign(new String(value), {
      toString: () => {
        this.conversions++;
        convert();
        return value;
      },
    });
  }

  // Prepares the statements, then tells the mock to record from here.
  async record(...prepared: string[]) {
    for (const name of prepared) await this.statement(name, "warm");
    await this.simple("record");
  }

  // Waits for every query, then tells the mock that the record ends here.
  async report(outcomes: Record<string, unknown>) {
    const dispatched = await Promise.all(this.dispatched);
    await this.simple("stop");
    return { ...outcomes, dispatched, conversions: this.conversions };
  }
}

const scenarios: Record<string, (s: Scenario) => Promise<unknown>> = {};

const started: Record<string, { prepared: string[]; query(s: Scenario): SQL.Query<any> }> = {
  "a query with a prepared statement": { prepared: ["nested"], query: s => s.statement("nested") },
  "a query with a new statement": { prepared: [], query: s => s.statement("nested") },
  "a simple query": { prepared: [], query: s => s.simple("nested") },
  "a query with the statement of the outer query": { prepared: [], query: s => s.statement("outer", "nested") },
};
for (const [kind, prepare] of [
  ["prepared statement", true],
  ["first execution", false],
] as const) {
  for (const [what, { prepared, query }] of Object.entries(started)) {
    scenarios[`${kind}, the conversion starts ${what}`] = async s => {
      await s.record(...prepared, ...(prepare ? ["outer"] : []));
      const outer = s.start(
        s.statement(
          "outer",
          s.text("outer", () => s.dispatch(query(s))),
        ),
      );
      return s.report({ outer: await outer });
    };
  }
}

// The reply to COM_STMT_PREPARE converts the parameter of "failed", which throws. "behind"
// waits in the queue, not written. Built-in JS reads the message of what was thrown to make
// the error of the query: that read starts "started".
scenarios["a query starts while a request that failed to start is rejected"] = async s => {
  await s.record("behind", "started");
  const thrown = {
    get message() {
      if (s.dispatched.length === 0) s.dispatch(s.statement("started"));
      return "boom";
    },
  };
  const failed = s.start(
    s.statement(
      "failed",
      s.text("failed", () => {
        throw thrown;
      }),
    ),
  );
  const behind = s.start(s.statement("behind"));
  return s.report({ failed: await failed, behind: await behind });
};

// The reply of "first" resolves its query with an array. To resolve a promise with an object,
// JS reads its `then`: a getter on Array.prototype runs inside the reply. "behind" waits in
// the queue, not written.
scenarios["a query starts while a reply resolves a query"] = async s => {
  await s.record("first", "behind", "started");
  Object.defineProperty(Array.prototype, "then", {
    configurable: true,
    get(this: { v?: string }[]) {
      if (this[0]?.v === "first" && s.dispatched.length === 0) s.dispatch(s.statement("started"));
      return undefined;
    },
  });
  try {
    const first = s.start(s.statement("first"));
    const behind = s.start(s.statement("behind"));
    return await s.report({ first: await first, behind: await behind });
  } finally {
    delete (Array.prototype as { then?: unknown }).then;
  }
};

async function main() {
  for (const name of JSON.parse(process.env.SCENARIOS!) as string[]) {
    console.log(JSON.stringify(await scenarios[name](new Scenario(new SQL({ url, max: 1 })))));
  }
}
main();
