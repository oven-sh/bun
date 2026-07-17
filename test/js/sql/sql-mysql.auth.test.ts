import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { createHash } from "node:crypto";
import {
  listeningServer,
  MYSQL_FAST_AUTH_SUCCESS,
  MYSQL_MOCK_AUTH_DATA_PART_1,
  MYSQL_MOCK_AUTH_DATA_PART_2,
  mysqlAuthMoreData,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlParseHandshakeResponse41,
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

    // A passworded caching_sha2_password user's second and later connections take the
    // fast path (AuthMoreData 0x03 then the concluding OK) once the server accepts the
    // client's scramble; any prior successful full auth is what warms the server cache.
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

      // Connection #2: warm cache -> the server should take the fast path. Until the
      // 21-byte-nonce bug (#26195 / #28161) also lands, it degrades to full auth via
      // allowPublicKeyRetrieval. The scripted tests below carry the fast-auth proof.
      await using fast = new SQL({ url: userUrl, max: 1, allowPublicKeyRetrieval: true });
      expect(await fast`select 'REAL-ROW' as v`).toEqual([{ v: "REAL-ROW" }]);
    });
  },
);

// The caching_sha2_password "Fast path succeeds" exchange, byte-scripted so the scramble
// bytes can be read back off the wire and both TCP framings of AuthMoreData(0x03) + OK forced:
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

// The scramble is XOR(SHA256(pw), SHA256(SHA256(SHA256(pw)) || nonce)) with the double
// hash hashed FIRST: MySQL's Generate_scramble, mysql2, go-sql-driver, and Connector/J all
// agree. mysql_native_password concatenates the other way around, which is NOT correct here.
test("caching_sha2_password scramble hashes the double-SHA256 before the nonce", async () => {
  const password = "pw";
  const scrambleSent = Promise.withResolvers<Buffer>();
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          try {
            scrambleSent.resolve(mysqlParseHandshakeResponse41(payload).authResponse);
          } catch (e) {
            scrambleSent.reject(e);
          }
          // Accept the auth so the query below completes and `await using sql` can
          // tear down over the normal COM_QUIT path; the scramble is the subject.
          socket.write(mysqlOkPacket(seq + 1));
        } else if (payload[0] === COM_QUERY) {
          socket.write(mysqlTextResultSet(1, [{ name: "v", type: MYSQL_TYPE_VAR_STRING }], [["REAL-ROW"]]));
        } else {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({ url: `mysql://root:${password}@127.0.0.1:${port}/db`, max: 1 });
    const [sent, rows] = await Promise.all([scrambleSent.promise, sql`SELECT 'REAL-ROW' AS v`.simple()]);

    const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
    const digest1 = sha256(Buffer.from(password));
    const digest2 = sha256(digest1);
    const expected = (nonce: Buffer) => {
      const digest3 = sha256(Buffer.concat([digest2, nonce]));
      return Buffer.from(digest1.map((byte, i) => byte ^ digest3[i])).toString("hex");
    };
    // The spec nonce is 20 bytes (part1 + the first 12 bytes of part2). Bun currently
    // also keeps part2's trailing filler byte (#26195, fixed separately in #28161), so
    // accept either nonce length: this test pins only the concatenation order.
    const nonce20 = Buffer.concat([MYSQL_MOCK_AUTH_DATA_PART_1, MYSQL_MOCK_AUTH_DATA_PART_2.subarray(0, 12)]);
    const nonce21 = Buffer.concat([MYSQL_MOCK_AUTH_DATA_PART_1, MYSQL_MOCK_AUTH_DATA_PART_2]);
    expect([expected(nonce20), expected(nonce21)]).toContain(sent.toString("hex"));
    expect(rows).toEqual([{ v: "REAL-ROW" }]);
  } finally {
    server.close();
  }
});
