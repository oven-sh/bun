import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "mysql",
  {
    image: "mysql_native_password",
    env: {},
    args: [],
    concurrent: true,
  },
  container => {
    // Create getters that will be evaluated when the test runs
    const getUrl = () => `mysql://root:bun@${container.host}:${container.port}/bun_sql_test`;

    test("should be able to connect with mysql_native_password auth plugin", async () => {
      console.log("Container info in test:", container);
      await using sql = new SQL({
        url: getUrl(),
        max: 1,
      });
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });

    test("should be able to switch auth plugin", async () => {
      {
        await using sql = new SQL({
          url: getUrl(),
          max: 1,
        });

        await sql`DROP USER IF EXISTS caching@'%';`.simple();
        await sql`CREATE USER caching@'%' IDENTIFIED WITH caching_sha2_password BY 'bunbun';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO caching@'%';
            FLUSH PRIVILEGES;`.simple();
      }
      {
        // Negative case: default (allowPublicKeyRetrieval unset) must refuse to fetch the server key.
        // Must run before the successful login below so caching_sha2_password hasn't cached credentials yet.
        await using denied = new SQL({
          url: `mysql://caching:bunbun@${container.host}:${container.port}/bun_sql_test`,
          max: 1,
        });
        const err = await denied`select 1 as x`.then(
          () => null,
          e => e,
        );
        expect(err).not.toBeNull();
        expect(err?.code).toBe("ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED");
      }
      await using sql = new SQL({
        url: `mysql://caching:bunbun@${container.host}:${container.port}/bun_sql_test`,
        allowPublicKeyRetrieval: true,
      });
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
      await sql.end();
    });
  },
);

// Regression for #26195: caching_sha2_password's RSA path XORs the password
// cyclically against the server nonce, so a stray trailing NUL (21-byte nonce)
// leaves byte 20 of the password unmasked. Use a container whose default
// plugin is caching_sha2_password so the bug is reached via the initial
// handshake rather than via AuthSwitchRequest.
describeWithContainer(
  "mysql caching_sha2_password",
  {
    image: "mysql_caching_sha2",
    env: {},
    args: [],
    concurrent: true,
  },
  container => {
    const userUrl = (user: string, password: string) =>
      `mysql://${user}:${password}@${container.host}:${container.port}/bun_sql_test`;

    async function createUser(user: string, password: string) {
      // `simple` (text protocol) doesn't take bound parameters; user/password
      // are test-controlled string literals, so inline them.
      await using sql = new SQL({
        url: `mysql://root:bun@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
        allowPublicKeyRetrieval: true,
      });
      await sql.unsafe(`DROP USER IF EXISTS '${user}'@'%';`).simple();
      await sql
        .unsafe(
          `CREATE USER '${user}'@'%' IDENTIFIED WITH caching_sha2_password BY '${password}';
           GRANT ALL PRIVILEGES ON bun_sql_test.* TO '${user}'@'%';
           FLUSH PRIVILEGES;`,
        )
        .simple();
    }

    async function expectAuthSucceeds(user: string, password: string) {
      await using sql = new SQL({ url: userUrl(user, password), allowPublicKeyRetrieval: true });
      const result = await sql`select 1 as x`;
      expect(result).toEqual([{ x: 1 }]);
    }

    test("short password (< 20 chars)", async () => {
      await createUser("short_pass", "short");
      // Twice: first connection hits the RSA path, second hits the cached
      // fast-auth path. Both must succeed.
      await expectAuthSucceeds("short_pass", "short");
      await expectAuthSucceeds("short_pass", "short");
    });

    test("boundary password (exactly 20 chars)", async () => {
      await createUser("boundary", "exactly20charpasswd!");
      await expectAuthSucceeds("boundary", "exactly20charpasswd!");
    });

    test("long password (> 19 chars)", async () => {
      await createUser("long_pass", "ThisIsAVeryLongPassword123!");
      await expectAuthSucceeds("long_pass", "ThisIsAVeryLongPassword123!");
    });
  },
);
