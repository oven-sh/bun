// The binary-protocol row decoder skipped the `index` / `is_indexed_column`
// assignments for cells marked NULL in the null bitmap (it `continue;`d out
// of the loop right after writing the null cell). For columns whose name is
// all digits, those fields tell SQLClient.cpp which object index to place the
// value at, so a NULL value on such a column landed at index 0 instead of the
// column's numeric name (and tripped `ASSERT(cell.isIndexedColumn())` in
// debug builds). The text-protocol decoder already handled this correctly.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("binary-protocol NULL in a digit-named column lands at that column's index", async () => {
    await container.ready;
    await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

    // All-digit column names make ColumnIdentifier classify them as Index(n).
    // Column "2" carries a non-NULL value to prove NULL placement (not just
    // presence) is what's being checked.
    const expected = { "2": 42, "5": null, "7": null };

    // Prepared → binary protocol. Before the fix the two NULL cells kept
    // index=0 / is_indexed_column=0, so the indexed-only fast path in
    // SQLClient.cpp wrote both nulls to slot 0 and dropped keys "5" and "7".
    const [binaryRow] = await sql`SELECT NULL AS \`5\`, CAST(42 AS SIGNED) AS \`2\`, NULL AS \`7\``;
    expect(binaryRow).toEqual(expected);

    // .simple() → text protocol. This path was already correct; the two
    // protocols must agree.
    const [textRow] = await sql`SELECT NULL AS \`5\`, CAST(42 AS SIGNED) AS \`2\`, NULL AS \`7\``.simple();
    expect(textRow).toEqual(expected);
  });
});
