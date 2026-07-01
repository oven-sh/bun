import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  MYSQL_FAST_AUTH_SUCCESS,
  mysqlAuthMoreData,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlTextResultSet,
} from "./wire-frames";

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

    // A passworded caching_sha2_password user's second and later connections take
    // the fast path: AuthMoreData(0x03 fast_auth_success) followed by the OK packet
    // that concludes authentication. Any prior full auth warms the server's cache.
    test("caching_sha2_password fast auth (warm server-side auth cache)", async () => {
      {
        await using admin = new SQL({ url: getUrl(), max: 1 });
        await admin`DROP USER IF EXISTS fastauth@'%';`.simple();
        await admin`CREATE USER fastauth@'%' IDENTIFIED WITH caching_sha2_password BY 'bunbun';
              GRANT ALL PRIVILEGES ON bun_sql_test.* TO fastauth@'%';`.simple();
      }
      const userUrl = `mysql://fastauth:bunbun@${container.host}:${container.port}/bun_sql_test`;

      // Connection #1: cold cache -> full authentication (RSA public-key
      // exchange). Its success is what warms the auth cache for `fastauth`.
      {
        await using cold = new SQL({ url: userUrl, max: 1, allowPublicKeyRetrieval: true });
        expect(await cold`select 1 as x`).toEqual([{ x: 1 }]);
      }

      // Connection #2: warm cache -> the server takes the fast path. Keep
      // allowPublicKeyRetrieval on so a concurrent test's FLUSH PRIVILEGES (which
      // drops the whole auth cache) degrades this to full auth instead of flaking.
      await using fast = new SQL({ url: userUrl, max: 1, allowPublicKeyRetrieval: true });
      expect(await fast`select 'REAL-ROW' as v`).toEqual([{ v: "REAL-ROW" }]);
    });
  },
);

// The caching_sha2_password "Fast path succeeds" exchange, byte-scripted (rather
// than containerized) so both TCP framings of the AuthMoreData(0x03) + OK pair can be forced:
// https://dev.mysql.com/doc/dev/mysql-server/latest/page_caching_sha2_authentication_exchanges.html

const COM_QUERY = 0x03;
const MYSQL_TYPE_VAR_STRING = 0xfd;

test.each(["split", "coalesced"] as const)(
  "caching_sha2_password fast-auth success: the trailing OK belongs to auth, not the first query (%s framing)",
  async framing => {
    const commands: number[] = [];
    const { server, port } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let authed = false;
      socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            // HandshakeResponse41 -> warm auth cache: fast_auth_success then OK.
            authed = true;
            const fastAuthSuccess = mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_FAST_AUTH_SUCCESS]));
            const authOk = mysqlOkPacket(seq + 2);
            if (framing === "coalesced") {
              socket.write(Buffer.concat([fastAuthSuccess, authOk]));
            } else {
              socket.write(fastAuthSuccess);
              setImmediate(() => socket.write(authOk));
            }
            return;
          }
          commands.push(payload[0]);
          if (payload[0] === COM_QUERY) {
            socket.write(mysqlTextResultSet(1, [{ name: "v", type: MYSQL_TYPE_VAR_STRING }], [["REAL-ROW"]]));
          } else {
            // COM_QUIT from `await using sql` below: a real server just closes.
            socket.end();
          }
        });
      });
      socket.on("error", () => {});
    });

    try {
      await using sql = new SQL({ url: `mysql://root:pw@127.0.0.1:${port}/db`, max: 1 });
      // .simple() -> COM_QUERY / text protocol, which is exactly the result set
      // the scripted server answers with. Settle to a value so a rejection shows
      // up in the toEqual diff below instead of failing the test opaquely.
      const result = await sql`SELECT 'REAL-ROW' AS v`.simple().then(
        rows => ({ rows }),
        (e: { code?: string }) => ({ code: e?.code ?? String(e) }),
      );
      // `commands` proves the client only sends COM_QUERY once authentication
      // has actually completed.
      expect({ result, commands }).toEqual({
        result: { rows: [{ v: "REAL-ROW" }] },
        commands: [COM_QUERY],
      });
    } finally {
      server.close();
    }
  },
);
