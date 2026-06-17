// Regression test: MySQLConnection.handlePreparedStatement stored an ErrorPacket whose
// error_message was a Data{ .temporary = ... } slice pointing into the socket read buffer.
// The statement is cached in the connection's statements map with status = .failed, so
// re-running the same failing query would read the stale slice after subsequent packets
// overwrote the buffer.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("MySQL: cached failed prepared statement error_message is not a dangling slice", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    // Long bogus identifiers so the server's echoed error_message exceeds the 15-byte
    // inline-string threshold and is heap-backed, and so the two messages differ at
    // bytes the second packet would overwrite in the read buffer. MySQL truncates the
    // "near '...'" clause to ~80 chars, so keep these short enough to appear in full.
    const longA = Buffer.alloc(50, "A").toString();
    const longZ = Buffer.alloc(50, "Z").toString();

    // First failing query → statement cached as .failed with error_message.
    const err1 = await sql`wat ${1} ${sql.unsafe(longA)}`.catch((x: any) => x);
    expect(err1).toBeInstanceOf(Error);
    expect(err1.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
    expect(err1.errno).toBe(1064);
    expect(err1.message).toContain(longA);

    // Different failing query → server sends a different ERROR packet that overwrites
    // the connection read buffer where err1's message slice used to point.
    const errOverwrite = await sql`other ${1} ${sql.unsafe(longZ)}`.catch((x: any) => x);
    expect(errOverwrite).toBeInstanceOf(Error);
    expect(errOverwrite.message).toContain(longZ);
    expect(errOverwrite.message).not.toBe(err1.message);

    // Same as the first failing query → hits the cached .failed statement and calls
    // stmt.error_response.toJS(). Before the fix this read the overwritten buffer and
    // returned bytes from errOverwrite's packet; after the fix it returns the original.
    const err2 = await sql`wat ${1} ${sql.unsafe(longA)}`.catch((x: any) => x);
    expect({
      code: err2.code,
      errno: err2.errno,
      sqlState: err2.sqlState,
      message: err2.message,
    }).toEqual({
      code: err1.code,
      errno: err1.errno,
      sqlState: err1.sqlState,
      message: err1.message,
    });
    expect(err2.message).toContain(longA);
    expect(err2.message).not.toContain(longZ);
  });
});
