// `maxLifetime` is a connection-hygiene knob, not a query timeout. Every other
// pool (HikariCP: "in-use connections are never retired"; pgbouncer
// `server_lifetime`; postgres.js `max_lifetime`) retires a max-lifetime
// connection only once it is idle. Bun's native timer used to fire purely on
// connection age with no in-flight check, so a query that straddled the
// boundary was rejected with ERR_POSTGRES_LIFETIME_TIMEOUT even though the
// statement had already been executed on the server. For an INSERT or a
// transaction's COMMIT that is a data-integrity bug: the server applied the
// write while the client saw an error.
import { SQL } from "bun";
import { expect, mock, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // Before the fix `pg_sleep(1.5)` was torn down at t=1s and the await
  // rejected with ERR_POSTGRES_LIFETIME_TIMEOUT. With the fix the query runs
  // to completion and the connection is retired once it becomes idle.
  test("maxLifetime waits for an in-flight query to finish", async () => {
    await container.ready;
    const closed = Promise.withResolvers<any>();
    const onclose = mock((err: any) => closed.resolve(err));
    await using sql = new SQL({ url: url(), max: 1, maxLifetime: 1, onclose });

    // The first query opens the connection, so the 1s lifetime timer fires
    // while pg_sleep(1.5) is in flight.
    const [row] = await sql`SELECT pg_backend_pid() AS pid, pg_sleep(1.5)::text AS slept, 'ok' AS v`;
    expect(row.v).toBe("ok");

    // The connection must still be retired, just after the query settles.
    const err = await closed.promise;
    expect({ code: err?.code, called: onclose.mock.calls.length }).toEqual({
      code: "ERR_POSTGRES_LIFETIME_TIMEOUT",
      called: 1,
    });

    // The next query is routed to a fresh backend.
    const [next] = await sql`SELECT pg_backend_pid() AS pid`;
    expect(next.pid).not.toBe(row.pid);
  });

  // The retirement happens before the microtask drain that resumes the
  // caller's await, so back-to-back awaited queries still rotate the
  // connection at the lifetime boundary instead of pinning it forever.
  test("maxLifetime retires the connection between sequential awaited queries", async () => {
    await container.ready;
    const closeCodes: string[] = [];
    await using sql = new SQL({
      url: url(),
      max: 1,
      maxLifetime: 1,
      onclose: (err: any) => closeCodes.push(err?.code),
    });

    const pids = new Set<number>();
    for (let i = 0; i < 4; i++) {
      const [r] = await sql`SELECT pg_backend_pid() AS pid, pg_sleep(0.4)::text AS s`;
      pids.add(r.pid);
    }

    expect({
      rotated: pids.size >= 2,
      closed: closeCodes.includes("ERR_POSTGRES_LIFETIME_TIMEOUT"),
    }).toEqual({ rotated: true, closed: true });
  });
});
