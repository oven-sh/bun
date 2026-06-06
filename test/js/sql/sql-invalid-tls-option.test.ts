import { SQL } from "bun";
import { expect, test } from "bun:test";

// When the native connection constructor throws synchronously (e.g. an invalid
// `tls` value), createPooledConnectionHandle defers the onClose callback via
// process.nextTick. The deferral matters: a synchronous onClose re-enters the
// pool while the connection slot is still being constructed, which used to
// crash the postgres adapter and hang the pending query instead of rejecting it.
for (const adapter of ["postgres", "mysql"] as const) {
  test(`${adapter}: query rejects cleanly when the native constructor throws synchronously`, async () => {
    // No server needed: the constructor validates `tls` before any I/O.
    await using sql = new SQL({
      adapter,
      hostname: "127.0.0.1",
      port: 1,
      username: "user",
      database: "db",
      // truthy non-boolean, non-object value passes JS option parsing untouched
      // and is rejected by the native constructor
      tls: 12345 as any,
      max: 1,
    });

    // `sql\`...\`` is a lazy thenable that only dispatches once `.then` is
    // invoked, so trigger it explicitly instead of handing it to `.rejects`.
    const err = await sql`select 1`.then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toBe("tls must be a boolean or an object");
  });
}
