import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";
import { UnixDomainSocketProxy } from "../../unix-domain-socket-proxy.ts";

// Test for issue #23954: Unix socket connection for MySQL
// https://github.com/oven-sh/bun/issues/23954

if (isDockerEnabled()) {
  describeWithContainer(
    "MySQL Unix socket connection (issue #23954)",
    {
      image: "mysql_plain",
      concurrent: true,
    },
    container => {
      let socketProxy: UnixDomainSocketProxy;
      let socketPath: string;

      beforeAll(async () => {
        await container.ready;
        // Create Unix socket proxy for MySQL
        socketProxy = await UnixDomainSocketProxy.create("MySQL", container.host, container.port);
        socketPath = socketProxy.path;
      });

      afterAll(() => {
        if (socketProxy) {
          socketProxy.stop();
        }
      });

      test("MySQL connection via Unix socket using 'socket' query parameter with localhost", async () => {
        // Standard format: hostname is required but ignored when socket is provided
        const mysql = new SQL(`mysql://root:@localhost/bun_sql_test?socket=${socketPath}`);

        try {
          // Try a simple query
          const result = await mysql`SELECT 1 as value`;
          expect(result).toEqual([{ value: 1 }]);
        } finally {
          await mysql.close();
        }
      });

      test("MySQL connection via Unix socket using 'socket' query parameter without hostname (docs format)", async () => {
        // Shorthand format from docs: mysql://user:pass@/database?socket=/path
        // The missing hostname is replaced with localhost internally
        const mysql = new SQL(`mysql://root:@/bun_sql_test?socket=${socketPath}`);

        try {
          // Try a simple query
          const result = await mysql`SELECT 1 as value`;
          expect(result).toEqual([{ value: 1 }]);
        } finally {
          await mysql.close();
        }
      });

      test("MySQL connection via Unix socket using path in options object", async () => {
        // Using the options object with path property
        const mysql = new SQL({
          adapter: "mysql",
          username: "root",
          password: "",
          database: "bun_sql_test",
          path: socketPath,
        });

        try {
          // Try a simple query
          const result = await mysql`SELECT 1 as value`;
          expect(result).toEqual([{ value: 1 }]);
        } finally {
          await mysql.close();
        }
      });
    },
  );
}
