// The MySQL adapter matches server replies to requests in request-queue order,
// so query packets must reach the wire in that same order.
//
// Binding a prepared statement's parameters runs user JS (index getters on the
// values array passed to sql.unsafe(), toJSON()/toString() of a value, ...).
// If that JS synchronously dispatches another query on the same connection,
// the nested query used to be written to the wire before the query that was
// still being bound: the pipelining gates were checked before bind() ran the
// user JS, the nested query saw an idle connection, and the packet of the
// outer query was appended afterwards. The two requests then received each
// other's replies: swapped rows, rows decoded against the wrong column set, or
// ERR_MYSQL_UNEXPECTED_PACKET tearing the connection down.
//
// Every combination below must leave each query with exactly its own result.
// Pre-fix, 4 of the 6 pool shapes and the transaction shape misbehave; the
// remaining 2 only pass because both packets happened to be written in queue
// order.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

type OuterShape = "first execution" | "cached statement";
type NestedShape = "uncached prepared" | "simple" | "cached prepared";

const outerShapes: OuterShape[] = ["first execution", "cached statement"];
const nestedShapes: NestedShape[] = ["uncached prepared", "simple", "cached prepared"];

function settle(query: Promise<unknown>) {
  return query.then(
    rows => ({ ok: true as const, rows: Array.from(rows as Iterable<unknown>) }),
    err => ({ ok: false as const, code: (err as any)?.code, message: String((err as any)?.message ?? err) }),
  );
}

interface Issuer {
  unsafe(text: string, values?: unknown[]): Promise<unknown>;
}

// Prepares whatever the shape says is already cached on this connection, then
// runs `outer` whose first parameter dispatches `nested` from inside bind().
async function issue(db: Issuer, tag: string, outerShape: OuterShape, nestedShape: NestedShape) {
  const outerText = `select ? as outer_param, '${tag}' as outer_tag`;
  const nestedPreparedText = `select ? as nested_param, '${tag}' as nested_tag`;
  const nestedSimpleText = `select 'nested' as nested_param, '${tag}' as nested_tag`;

  if (outerShape === "cached statement") await db.unsafe(outerText, [0]);
  if (nestedShape === "cached prepared") await db.unsafe(nestedPreparedText, ["warm"]);

  let nested: Promise<unknown> | undefined;
  let reads = 0;
  const values: unknown[] = [0];
  Object.defineProperty(values, "0", {
    enumerable: true,
    configurable: true,
    get() {
      // The adapter reads the values array twice: once to derive the
      // statement signature (parameter types) and once in bind(). The second
      // read is the one that happens after the pipelining gates were checked.
      if (++reads === 2) {
        nested = nestedShape === "simple" ? db.unsafe(nestedSimpleText) : db.unsafe(nestedPreparedText, ["nested"]);
        (nested as any).execute();
      }
      return 42;
    },
  });

  const outer = await settle(db.unsafe(outerText, values));
  const nestedResult = nested === undefined ? "nested query was never dispatched" : await settle(nested);
  const after = await settle(db.unsafe("select 'after' as after_col"));
  return { outer, nested: nestedResult, after };
}

function expected(tag: string) {
  return {
    outer: { ok: true, rows: [{ outer_param: 42, outer_tag: tag }] },
    nested: { ok: true, rows: [{ nested_param: "nested", nested_tag: tag }] },
    after: { ok: true, rows: [{ after_col: "after" }] },
  };
}

describeWithContainer("mysql", { image: "mysql_plain", concurrent: true }, container => {
  const options = () => ({
    url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
    max: 1,
  });

  for (const outerShape of outerShapes) {
    for (const nestedShape of nestedShapes) {
      test(`${outerShape} outer, ${nestedShape} nested dispatched during bind`, async () => {
        await container.ready;
        await using sql = new SQL(options());
        const tag = `${outerShape} / ${nestedShape}`;
        expect(await issue(sql, tag, outerShape, nestedShape)).toEqual(expected(tag));
      });
    }
  }

  test("query dispatched during bind inside a transaction", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const tag = "transaction";
    let observed: Awaited<ReturnType<typeof issue>> | undefined;
    await sql.begin(async tx => {
      observed = await issue(tx, tag, "first execution", "uncached prepared");
    });
    expect(observed).toEqual(expected(tag));
  });
});
