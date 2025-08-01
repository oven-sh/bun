import { PGlite } from "@electric-sql/pglite";
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import { isCI, isLinux } from "harness";
import net, { AddressInfo } from "node:net";
import { fromNodeSocket } from "pg-gateway/node";

// TODO(@190n) linux-x64 sometimes fails due to JavaScriptCore bug
// https://github.com/oven-sh/bun/issues/17841#issuecomment-2695792567
// https://bugs.webkit.org/show_bug.cgi?id=289009
test.todoIf(isCI && isLinux && process.arch == "x64")(
  "pglite should be able to query using pg-gateway and Bun.SQL",
  async () => {
    const name = "test_" + randomUUIDv7("hex").replaceAll("-", "");
    const dataDir = `memory://${name}`;
    const db = new PGlite(dataDir);

    // Wait for the database to initialize
    await db.waitReady;

    // Create a simple test table
    await db.exec(`
    CREATE TABLE IF NOT EXISTS test_table (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    
    INSERT INTO test_table (name) VALUES ('Test 1'), ('Test 2'), ('Test 3');
  `);

    // Create a simple server using pg-gateway
    const server = net.createServer(async socket => {
      await fromNodeSocket(socket, {
        serverVersion: "16.3",
        auth: {
          method: "trust",
        },
        async onStartup() {
          // Wait for PGlite to be ready before further processing
          await db.waitReady;
        },
        async onMessage(data, { isAuthenticated }: { isAuthenticated: boolean }) {
          // Only forward messages to PGlite after authentication
          if (!isAuthenticated) {
            return;
          }

          return await db.execProtocolRaw(data);
        },
      });
    });

    // Start listening
    await once(server.listen(0), "listening");

    const port = (server.address() as AddressInfo).port;

    await using sql = new SQL({
      hostname: "localhost",
      port: port,
      database: name,
      max: 1,
    });

    {
      // prepared statement without parameters
      const result = await sql`SELECT * FROM test_table WHERE id = 1`;
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "Test 1" });
    }

    {
      // using prepared statement
      const result = await sql`SELECT * FROM test_table WHERE id = ${1}`;
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "Test 1" });
    }

    {
      // using simple query
      const result = await sql`SELECT * FROM test_table WHERE id = 1`.simple();
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "Test 1" });
    }

    {
      // using unsafe with parameters
      const result = await sql.unsafe("SELECT * FROM test_table WHERE id = $1", [1]);
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "Test 1" });
    }
  },
);
