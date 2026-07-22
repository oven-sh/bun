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

    const txReady = Promise.withResolvers<{ tx: any; pid: number }>();
    const gate = Promise.withResolvers<void>();
    let callbackDone = false;

    const p = sql.begin(async tx => {
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      txReady.resolve({ tx, pid });
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

    p.catch(txReady.reject);
    const { tx, pid } = await txReady.promise;
    try {
      await adm`select pg_terminate_backend(${pid})`;

      // Wait until the terminated backend has exited (observed via adm on a
      // separate connection). By the time it is gone from pg_stat_activity the
      // server has already sent FATAL + FIN to the tx socket, and the adm
      // round-trip yields to the event loop so the tx socket's readable event
      // delivers the FATAL through the idle-connection ErrorResponse path.
      let gone = false;
      for (let i = 0; i < 500 && !gone; i++) {
        const [{ n }] = await adm`select count(*)::int as n from pg_stat_activity where pid = ${pid}`;
        gone = n === 0;
        if (!gone) await new Promise<void>(r => setTimeout(r, 5));
      }
      expect(gone).toBe(true);

      // Positive precondition: onTransactionDisconnected has fired (state is
      // closed) so tx`...` rejects. Fail loudly if the disconnect never
      // reached the tx handle before the ordering check below.
      let txClosed = false;
      for (let i = 0; i < 500 && !txClosed; i++) {
        txClosed = await tx`select 1`.then(
          () => false,
          () => true,
        );
        if (!txClosed) await new Promise<void>(r => setTimeout(r, 5));
      }
      expect(txClosed).toBe(true);
    } finally {
      gate.resolve();
    }
    await settled;

    expect(callbackDone).toBe(true);
    expect(settledBeforeCallback).toBe(false);
    expect(caught).toBeDefined();
    // The rejection must carry the server's FATAL (57P01) or a
    // connection-closed identity, not the opaque "Failed to read data".
    expect(["ERR_POSTGRES_SERVER_ERROR", "ERR_POSTGRES_CONNECTION_CLOSED"]).toContain(caught.code);
  });
});
