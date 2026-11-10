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

      // Unfixed: one 64-byte block per column per query, 150,000 blocks in the measured part, at least 9.2 MiB.
      await expectRssDeltaBelow([path.join(import.meta.dir, "28632.fixture.ts"), url], { release: 5, debug: 8 });
    });
  },
);
