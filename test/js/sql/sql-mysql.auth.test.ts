import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import {
  listeningServer,
  MYSQL_FAST_AUTH_SUCCESS,
  MYSQL_MOCK_AUTH_DATA_PART_1,
  MYSQL_MOCK_AUTH_DATA_PART_2,
  MYSQL_MOCK_NONCE,
  MYSQL_PERFORM_FULL_AUTHENTICATION,
  MYSQL_REQUEST_PUBLIC_KEY,
  mysqlAuthMoreData,
  mysqlAuthSwitchRequest,
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

      // Connection #2: warm cache -> the server takes the fast path. allowPublicKeyRetrieval
      // stays on because a concurrent test in this block can FLUSH PRIVILEGES and evict the
      // cache between the two connections; the scripted tests below carry the fast-auth proof.
      await using fast = new SQL({ url: userUrl, max: 1, allowPublicKeyRetrieval: true });
      expect(await fast`select 'REAL-ROW' as v`).toEqual([{ v: "REAL-ROW" }]);
    });

    // #26195: full authentication sends the NUL-terminated password XORed cyclically
    // against the nonce, so a password at least as long as the 20-byte nonce is the first
    // one whose bytes get masked by a 21st nonce byte that should not be there.
    test("caching_sha2_password full auth with a password longer than the nonce", async () => {
      const password = "bunbunbunbunbunbunbunbunbun"; // 27 chars
      {
        await using admin = new SQL({ url: getUrl(), max: 1 });
        await admin`DROP USER IF EXISTS longpw@'%';`.simple();
        await admin
          .unsafe(
            `CREATE USER longpw@'%' IDENTIFIED WITH caching_sha2_password BY '${password}';
             GRANT ALL PRIVILEGES ON bun_sql_test.* TO longpw@'%';`,
          )
          .simple();
      }

      // Cold cache, plain TCP: the server answers perform_full_authentication and the
      // password travels RSA-encrypted, which is the path the nonce length corrupts.
      await using sql = new SQL({
        url: `mysql://longpw:${password}@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
        allowPublicKeyRetrieval: true,
      });
      const result = await sql`select 1 as x`.then(
        rows => ({ rows }),
        (e: { code?: string; message?: string }) => ({ code: e?.code, message: e?.message }),
      );
      expect(result).toEqual({ rows: [{ x: 1 }] });
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

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

// The fast-auth token is XOR(SHA256(pw), SHA256(SHA256(SHA256(pw)) || nonce)) with the
// double hash hashed FIRST: MySQL's Generate_scramble, mysql2, go-sql-driver, and
// Connector/J all agree. mysql_native_password concatenates the other way around, which
// is NOT correct here. `nonce` is the 20-byte scramble, never the NUL that terminates it.
function cachingSha2Token(password: string, nonce: Buffer): Buffer {
  const digest1 = sha256(Buffer.from(password));
  const digest3 = sha256(Buffer.concat([sha256(digest1), nonce]));
  return Buffer.from(digest1.map((byte, i) => byte ^ digest3[i]));
}

// perform_full_authentication sends the NUL-terminated password XORed cyclically against
// the same 20-byte nonce, RSA-encrypted with the server's public key.
function obfuscatePassword(password: string, nonce: Buffer): Buffer {
  const plain = Buffer.from(`${password}\0`, "utf-8");
  return Buffer.from(plain.map((byte, i) => byte ^ nonce[i % nonce.length]));
}

test("caching_sha2_password scramble hashes the double-SHA256 before the 20-byte nonce", async () => {
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

    // The nonce is part1 + the first 12 bytes of part2. Hashing part2's 13th byte (the
    // NUL terminator) too produces a token no MySQL 8 server can ever verify (#26195).
    const nonce21 = Buffer.concat([MYSQL_MOCK_AUTH_DATA_PART_1, MYSQL_MOCK_AUTH_DATA_PART_2]);
    expect(sent.toString("hex")).toBe(cachingSha2Token(password, MYSQL_MOCK_NONCE).toString("hex"));
    expect(sent.toString("hex")).not.toBe(cachingSha2Token(password, nonce21).toString("hex"));
    expect(rows).toEqual([{ v: "REAL-ROW" }]);
  } finally {
    server.close();
  }
});

// A warm server-side auth cache is the only time fast auth can succeed, and it is what
// every other client gets by default over plain TCP: the server verifies the token and
// concludes with OK. A token the server cannot verify demotes the exchange to
// perform_full_authentication, which bun's default `allowPublicKeyRetrieval: false`
// refuses — so a wrong token is a failed connection, not just a slower one.
test("caching_sha2_password fast auth succeeds over plain TCP against a warm cache", async () => {
  const password = "pw";
  let tokenVerified = false;
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          const { authResponse } = mysqlParseHandshakeResponse41(payload);
          tokenVerified = authResponse.equals(cachingSha2Token(password, MYSQL_MOCK_NONCE));
          if (tokenVerified) {
            socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_FAST_AUTH_SUCCESS])));
            socket.write(mysqlOkPacket(seq + 2));
          } else {
            socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_PERFORM_FULL_AUTHENTICATION])));
          }
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
    const result = await sql`SELECT 'REAL-ROW' AS v`.simple().then(
      rows => ({ rows }),
      (e: { code?: string }) => ({ code: e?.code ?? String(e) }),
    );
    expect({ result, tokenVerified }).toEqual({ result: { rows: [{ v: "REAL-ROW" }] }, tokenVerified: true });
  } finally {
    server.close();
  }
});

// The nonce reaches the RSA path too. A password at least as long as the nonce wraps the
// cyclic XOR, so a 21-byte nonce corrupts every byte from the 20th on and the server
// decrypts garbage: #26195. The nonce that has to be used is the one from whichever packet
// last carried auth-plugin-data, so drive both of them.
const rsaKeyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const AUTH_SWITCH_NONCE = Buffer.from(Array.from({ length: 20 }, (_, i) => 0x41 + i));

test.each(["handshake", "auth-switch"] as const)(
  "caching_sha2_password full auth XORs the password against the 20-byte nonce (%s)",
  async entry => {
    // Longer than the nonce so the cyclic XOR wraps; `x`-filled so the plaintext is
    // unambiguous about which nonce byte masked each position.
    const password = `pw-${Buffer.alloc(24, "x").toString()}`;
    const nonce = entry === "handshake" ? MYSQL_MOCK_NONCE : AUTH_SWITCH_NONCE;
    const decrypted = Promise.withResolvers<Buffer>();
    const requests: number[] = [];

    const { server, port } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let step = entry === "handshake" ? 1 : 0;
      socket.write(mysqlHandshakeV10({ authPlugin: entry === "handshake" ? "caching_sha2_password" : undefined }));
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          switch (step++) {
            case 0:
              // HandshakeResponse41 for the server's advertised mysql_native_password;
              // switch the account over to caching_sha2_password with a fresh nonce.
              socket.write(
                mysqlAuthSwitchRequest(
                  seq + 1,
                  "caching_sha2_password",
                  Buffer.concat([AUTH_SWITCH_NONCE, Buffer.from([0])]),
                ),
              );
              return;
            case 1:
              // The scramble: cold cache, so the server demands the full exchange.
              socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_PERFORM_FULL_AUTHENTICATION])));
              return;
            case 2:
              requests.push(payload[0]);
              socket.write(mysqlAuthMoreData(seq + 1, Buffer.from(rsaKeyPair.publicKey)));
              return;
            case 3:
              try {
                decrypted.resolve(
                  privateDecrypt({ key: rsaKeyPair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING }, payload),
                );
              } catch (e) {
                decrypted.reject(e);
              }
              socket.write(mysqlOkPacket(seq + 1));
              return;
            default:
              if (payload[0] === COM_QUERY) {
                socket.write(mysqlTextResultSet(1, [{ name: "v", type: MYSQL_TYPE_VAR_STRING }], [["REAL-ROW"]]));
              } else {
                socket.end();
              }
          }
        });
      });
      socket.on("error", () => {});
    });

    try {
      await using sql = new SQL({
        url: `mysql://root:${password}@127.0.0.1:${port}/db`,
        max: 1,
        allowPublicKeyRetrieval: true,
      });
      const [plain, rows] = await Promise.all([decrypted.promise, sql`SELECT 'REAL-ROW' AS v`.simple()]);

      expect({ plain: plain.toString("hex"), requests, rows }).toEqual({
        plain: obfuscatePassword(password, nonce).toString("hex"),
        requests: [MYSQL_REQUEST_PUBLIC_KEY],
        rows: [{ v: "REAL-ROW" }],
      });
    } finally {
      server.close();
    }
  },
);
