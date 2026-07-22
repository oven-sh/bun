// sql.begin() must not settle before its callback settles.
//
// When the transaction's backend dies mid-callback (failover, OOM, admin
// pg_terminate_backend), the pooled connection's onClose handler calls
// onTransactionDisconnected. That handler used to reject the *outer*
// begin() promise immediately, while `await callback(tx)` was still pending.
// The caller would observe "transaction failed" and move on, but the
// callback kept running and could still perform side effects on healthy
// pool connections: a caller/callback split-brain.
//
// Secondary: an ErrorResponse that arrives on an idle-in-transaction
// connection (no current request) was surfaced as the opaque
// ERR_POSTGRES_EXPECTED_REQUEST / "Failed to read data" instead of the
// server's actual FATAL.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("sql.begin() waits for its callback to settle when the tx connection dies", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 4, idleTimeout: 5 });
    await using adm = new SQL({ url: url(), max: 1, idleTimeout: 5 });

    const txReady = Promise.withResolvers<number>();
    const gate = Promise.withResolvers<void>();
    let callbackDone = false;

    const p = sql.begin(async tx => {
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      txReady.resolve(pid);
      // The callback is *not* touching `tx` here; it is doing other async
      // work while the backend is killed and the close event propagates.
      await gate.promise;
      callbackDone = true;
      return "done";
    });

    let caught: any;
    let settledBeforeCallback: boolean | undefined;
    const settled = p.then(
      () => {
        settledBeforeCallback = !callbackDone;
      },
      e => {
        settledBeforeCallback = !callbackDone;
        caught = e;
      },
    );

    const pid = await txReady.promise;
    await adm`select pg_terminate_backend(${pid})`;

    // Give the tx connection's socket time to observe the FATAL + close
    // and fire its onClose handler. On the buggy build p settles inside
    // this window; on the fixed build it stays pending.
    for (let i = 0; i < 50 && settledBeforeCallback === undefined; i++) {
      await new Promise<void>(r => setTimeout(r, 5));
    }

    gate.resolve();
    await settled;

    expect(callbackDone).toBe(true);
    expect(settledBeforeCallback).toBe(false);
    expect(caught).toBeDefined();
    // The rejection must carry the server's FATAL (57P01) or a
    // connection-closed identity, not the opaque "Failed to read data".
    expect(caught.code).not.toBe("ERR_POSTGRES_EXPECTED_REQUEST");
    expect(String(caught.message ?? "")).not.toContain("Failed to read data");
  });
});
