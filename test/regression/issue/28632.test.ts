// https://github.com/oven-sh/bun/issues/28632
import { test } from "bun:test";
import { describeWithContainer, expectRssDeltaBelow } from "harness";
import path from "node:path";

describeWithContainer(
  "issue #28632: MySQL adapter should not leak memory on repeated queries",
  {
    image: "mysql_plain",
    concurrent: true,
  },
  container => {
    test("prepared statement re-execution should not leak name_or_index", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;

      // The fixture re-executes a prepared SELECT over a 500-column table with
      // 64-byte column names. Unfixed: one 64-byte block leaks per column per
      // query, so its 300 measured queries leak 150,000 blocks: at least 9.6 MiB
      // under mimalloc (release), and 15 to 17 MiB measured under ASAN, where
      // each block also carries a header and redzone. Fixed: 0 to 1 MiB (release)
      // and 0 to 3 MiB (debug/ASAN, quarantine off) after the fixture's
      // 100-query warm-up.
      await expectRssDeltaBelow([path.join(import.meta.dir, "28632.fixture.ts"), url], { release: 5, debug: 8 });
    });
  },
);
