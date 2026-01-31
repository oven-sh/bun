import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

if (!isDockerEnabled()) {
  test.skip("skipping TLS SQL compatibility tests - Docker is not available", () => {});
} else {
  describeWithContainer(
    "PostgreSQL TLS Compatibility", // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
    {
      image: "postgres_tls",
    },
    container => {
      // We test with prepared statements on and off to ensure the connection logic
      // remains consistent regardless of the query execution mode.
      for (const prepare of [true, false]) {
        describe(`prepared: ${prepare}`, () => {
          const getBaseOptions = (): Bun.SQL.Options => ({
            url: `postgres://postgres@${container.host}:${container.port}/bun_sql_test`,
            adapter: "postgres",
            max: 1,
            prepare,
          });

          test("ssl: 'prefer' connects successfully with snakeoil cert", async () => {
            await container.ready;
            // 'prefer' is the default behaviour for postgres.js and libpq.
            // It should attempt SSL, see the self-signed cert, and proceed without strict verification
            // unless strict mode is explicitly requested.
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "prefer",
            });

            const [{ one }] = await sql`SELECT 1 as one`;
            expect(one).toBe(1);
          });

          test("ssl: 'require' connects successfully with snakeoil cert (loose default)", async () => {
            await container.ready;
            // The user requested compatibility with postgres.js behaviour:
            // "even on require if reject_unauthorized is not set then we should still connect."
            // This implies rejectUnauthorized defaults to false in this context.
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "require",
            });

            const [{ one }] = await sql`SELECT 1 as one`;
            expect(one).toBe(1);
          });

          test("ssl: 'require' with rejectUnauthorized: false connects successfully", async () => {
            await container.ready;
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "require",
              tls: {
                rejectUnauthorized: false,
              },
            });

            const [{ one }] = await sql`SELECT 1 as one`;
            expect(one).toBe(1);
          });

          test("ssl: 'require' with rejectUnauthorized: true throws on snakeoil cert", async () => {
            await container.ready;
            // When explicitly enforcing strict verification, a self-signed cert should fail.
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "require",
              tls: {
                rejectUnauthorized: true,
              },
            });

            let error;
            try {
              await sql`SELECT 1`;
            } catch (e) {
              error = e;
            }

            expect(error).toBeDefined();
            // Depending on where the error is caught (TLS layer or Postgres layer),
            // it should be an instance of Error or SQL.Error.
            // We check that connection failed specifically.
            expect(error).toBeInstanceOf(Error);
          });

          test("ssl: 'verify-ca' throws without CA provided", async () => {
            await container.ready;
            // 'verify-ca' implies rejectUnauthorized: true and requires a trusted CA.
            // Since we haven't provided the root CA for the snakeoil cert, this must fail.
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "verify-ca",
            });

            let error;
            try {
              await sql`SELECT 1`;
            } catch (e) {
              error = e;
            }

            expect(error).toBeDefined();
          });

          test("ssl: 'verify-full' throws on host mismatch/untrusted cert", async () => {
            await container.ready;
            // 'verify-full' checks both the CA and the hostname.
            await using sql = new SQL({
              ...getBaseOptions(),
              ssl: "verify-full",
            });

            let error;
            try {
              await sql`SELECT 1`;
            } catch (e) {
              error = e;
            }

            expect(error).toBeDefined();
          });

          test("tls: true alias works like ssl: 'require' (loose)", async () => {
            await container.ready;
            // Setting tls: true in Bun is often synonymous with enabling SSL.
            // It should mimic the 'require' loose behaviour.
            await using sql = new SQL({
              ...getBaseOptions(),
              tls: true,
            });

            const [{ one }] = await sql`SELECT 1 as one`;
            expect(one).toBe(1);
          });
        });
      }
    },
  );
}
