import { SQL } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// https://github.com/oven-sh/bun/issues/28819
//
// Pre-stringified JSON values bound as template literal parameters were being
// JSON.stringified a second time before being sent to Postgres, so json/jsonb
// columns always stored the value as a JSON string rather than the intended
// object/array/number.

function runJsonBindingTests(getUrl: () => string) {
  test("strings bound to ::json are not double-encoded", async () => {
    await using sql = new SQL(getUrl());

    await sql`DROP TABLE IF EXISTS test_json_28819`;
    await sql`CREATE TABLE test_json_28819 (id serial PRIMARY KEY, value json)`;

    try {
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify({ hello: "world" })}::json)`;
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify([1, 2, 3])}::json)`;
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(42)}::json)`;
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify("bare string")}::json)`;
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(null)}::json)`;
      await sql`INSERT INTO test_json_28819 (value) VALUES (${JSON.stringify(true)}::json)`;

      const rows = await sql`SELECT id, value, json_typeof(value) as type FROM test_json_28819 ORDER BY id`;
      expect(rows).toEqual([
        { id: 1, value: { hello: "world" }, type: "object" },
        { id: 2, value: [1, 2, 3], type: "array" },
        { id: 3, value: 42, type: "number" },
        { id: 4, value: "bare string", type: "string" },
        { id: 5, value: null, type: "null" },
        { id: 6, value: true, type: "boolean" },
      ]);
    } finally {
      await sql`DROP TABLE IF EXISTS test_json_28819`;
    }
  });

  test("strings bound to ::jsonb are not double-encoded", async () => {
    await using sql = new SQL(getUrl());

    await sql`DROP TABLE IF EXISTS test_jsonb_28819`;
    await sql`CREATE TABLE test_jsonb_28819 (id serial PRIMARY KEY, value jsonb)`;

    try {
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify({ hello: "world" })}::jsonb)`;
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify([1, 2, 3])}::jsonb)`;
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(42)}::jsonb)`;
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify("bare string")}::jsonb)`;
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(null)}::jsonb)`;
      await sql`INSERT INTO test_jsonb_28819 (value) VALUES (${JSON.stringify(true)}::jsonb)`;

      const rows = await sql`SELECT id, value, jsonb_typeof(value) as type FROM test_jsonb_28819 ORDER BY id`;
      expect(rows).toEqual([
        { id: 1, value: { hello: "world" }, type: "object" },
        { id: 2, value: [1, 2, 3], type: "array" },
        { id: 3, value: 42, type: "number" },
        { id: 4, value: "bare string", type: "string" },
        { id: 5, value: null, type: "null" },
        { id: 6, value: true, type: "boolean" },
      ]);
    } finally {
      await sql`DROP TABLE IF EXISTS test_jsonb_28819`;
    }
  });

  test("non-string values bound to ::json are still serialized", async () => {
    await using sql = new SQL(getUrl());

    // Objects and arrays should still be JSON.stringified when passed directly.
    const obj = (await sql`SELECT ${{ a: "hello", b: 42 }}::json as x`)[0].x;
    expect(obj).toEqual({ a: "hello", b: 42 });

    const arr = (await sql`SELECT ${[1, 2, 3]}::json as x`)[0].x;
    expect(arr).toEqual([1, 2, 3]);
  });
}

// Check once at module load whether a local postgres is reachable. This lets
// the gate / local dev runs exercise the fix without needing Docker.
async function checkLocal(url: string): Promise<boolean> {
  try {
    const sql = new SQL({ url, connectionTimeout: 2, max: 1, idleTimeout: 1 });
    try {
      await sql`SELECT 1`;
      return true;
    } finally {
      await sql.end().catch(() => {});
    }
  } catch {
    return false;
  }
}

const localUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgres://postgres@localhost:5432/postgres";
const dockerAvailable = isDockerEnabled();
const localReachable = !dockerAvailable ? await checkLocal(localUrl) : false;

if (dockerAvailable) {
  describeWithContainer(
    "issue 28819 (docker)",
    {
      image: "postgres_plain",
      env: {},
      concurrent: false,
      args: [],
    },
    container => {
      beforeAll(async () => {
        await container.ready;
      });
      runJsonBindingTests(() => `postgres://postgres@${container.host}:${container.port}/postgres`);
    },
  );
} else if (localReachable) {
  describe("issue 28819 (local)", () => {
    runJsonBindingTests(() => localUrl);
  });
} else {
  describe.todo("issue 28819 (no postgres available)");
}
