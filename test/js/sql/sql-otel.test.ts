// OpenTelemetry spans for Bun.sql (PostgreSQL and MySQL).
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const spans: any[] = [];
function start() {
  Bun.otel.start({
    serviceName: "sql-otel-test",
    exporters: [{ export: (b: any[]) => spans.push(...b) }],
    instrumentations: { sql: "always" },
  });
}
async function collect() {
  await Bun.sleep(0);
  await Bun.otel.forceFlush();
  return spans
    .splice(0, spans.length)
    .filter(s => s.scope.name === "bun.sql")
    .sort((a, b) => a.startTime - b.startTime);
}
const tracer = Bun.otel.tracer("test");
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("query spans: operation name, parameterized text, SQLSTATE on error, nesting", async () => {
    await container.ready;
    start();
    await using sql = new SQL({ url: `postgres://postgres@${container.host}:${container.port}/postgres`, max: 1 });
    await sql`select 1 as x`;
    await sql`select ${2}::int as y`;
    await sql`selec typo`.catch(() => {});
    await tracer.startActiveSpan("parent", async span => {
      await sql`select 3`;
      span.end();
    });
    const got = await collect();
    expect(got.map(s => [s.name, s.attributes["db.query.text"], s.status.code])).toEqual([
      ["SELECT", "select 1 as x", 0],
      ["SELECT", expect.stringMatching(/^select \$1 ?::int as y$/), 0],
      ["postgresql", "selec typo", 2],
      ["SELECT", "select 3", 0],
    ]);
    expect(got[0]).toMatchObject({
      kind: 2,
      attributes: {
        "db.system.name": "postgresql",
        "db.namespace": "postgres",
        "server.address": container.host,
        "server.port": container.port,
        "db.operation.name": "SELECT",
      },
    });
    expect(got[2].attributes["db.response.status_code"]).toBe("42601");
    expect(got[2].attributes["error.type"]).toBe("42601");
    expect(got[3].parentSpanId).toEqual(expect.any(String));
    expect(got[0].parentSpanId).toBeUndefined();
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("query spans: operation name, parameterized text, error number on error", async () => {
    await container.ready;
    start();
    await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    await sql`select 1 as x`;
    await sql`select ${2} as y`;
    await sql`selec typo`.catch(() => {});
    const got = await collect();
    expect(got.map(s => [s.name, s.attributes["db.query.text"], s.status.code])).toEqual([
      ["SELECT", "select 1 as x", 0],
      ["SELECT", expect.stringMatching(/^select \?\s+as y$/), 0],
      ["mysql", "selec typo", 2],
    ]);
    expect(got[0]).toMatchObject({
      kind: 2,
      attributes: {
        "db.system.name": "mysql",
        "db.namespace": "bun_sql_test",
        "server.address": container.host,
        "server.port": container.port,
      },
    });
    expect(got[2].attributes["db.response.status_code"]).toBe("1064");
  });
});
