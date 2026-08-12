import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, tempDir } from "harness";
import { createHash } from "node:crypto";
import type { Server, Socket } from "node:net";
import {
  listeningServer,
  listeningUnixServer,
  MYSQL_FAST_AUTH_SUCCESS,
  MYSQL_MOCK_AUTH_DATA_PART_1,
  MYSQL_MOCK_AUTH_DATA_PART_2,
  MYSQL_PERFORM_FULL_AUTHENTICATION,
  MYSQL_REQUEST_PUBLIC_KEY,
  mysqlAuthMoreData,
  mysqlAuthSwitchRequest,
  mysqlErrPacket,
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

// perform_full_authentication (AuthMoreData 0x04) asks the client for the password itself, and
// what the client may put on the wire depends on the transport. libmysqlclient, mysql2
// (`config.ssl || config.socketPath`) and go-sql-driver (`Net == "unix"`) treat a unix socket
// like TLS and send the NUL-terminated password; only plain TCP has to fetch the server's RSA
// key first, which is what allowPublicKeyRetrieval gates.
// https://dev.mysql.com/doc/dev/mysql-server/latest/page_caching_sha2_authentication_exchanges.html
describe("caching_sha2_password full authentication", () => {
  const password = "bunbun";
  const CLEARTEXT_PASSWORD = Buffer.concat([Buffer.from(password), Buffer.from([0])]).toString("hex");
  const PUBLIC_KEY_REQUEST = Buffer.from([MYSQL_REQUEST_PUBLIC_KEY]).toString("hex");

  type Exchange = {
    transport: "unix" | "tcp";
    allowPublicKeyRetrieval?: boolean;
    /** Reach caching_sha2_password through an AuthSwitchRequest instead of the greeting. */
    viaAuthSwitch?: boolean;
  };

  /**
   * Scripted server: answers the client's scramble (or AuthSwitchResponse) with
   * perform_full_authentication and reports the one packet the client sends back, or `[]`
   * if it sends none. The password is accepted with OK; anything else gets the
   * ER_ACCESS_DENIED_ERROR a real server would answer with.
   */
  function fullAuthServer(opts: Exchange, sockets: Set<Socket>) {
    const afterFullAuth = Promise.withResolvers<string[]>();
    const onSocket = (socket: Socket) => {
      sockets.add(socket);
      let buffered = Buffer.alloc(0);
      let phase: "handshake-response" | "auth-switch-response" | "full-auth" | "done" = "handshake-response";
      socket.write(
        mysqlHandshakeV10({ authPlugin: opts.viaAuthSwitch ? "mysql_native_password" : "caching_sha2_password" }),
      );
      socket.on("error", () => {});
      socket.on("close", () => {
        sockets.delete(socket);
        afterFullAuth.resolve([]);
      });
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          switch (phase) {
            case "handshake-response":
              if (opts.viaAuthSwitch) {
                phase = "auth-switch-response";
                socket.write(mysqlAuthSwitchRequest(seq + 1, "caching_sha2_password", Buffer.alloc(20, 0x63)));
                return;
              }
              phase = "full-auth";
              socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_PERFORM_FULL_AUTHENTICATION])));
              return;
            case "auth-switch-response":
              phase = "full-auth";
              socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([MYSQL_PERFORM_FULL_AUTHENTICATION])));
              return;
            case "full-auth": {
              phase = "done";
              const sent = payload.toString("hex");
              socket.write(sent === CLEARTEXT_PASSWORD ? mysqlOkPacket(seq + 1) : mysqlErrPacket(seq + 1));
              afterFullAuth.resolve([sent]);
              return;
            }
            case "done":
              // COM_QUIT from the close() below.
              return;
          }
        });
      });
    };
    return { onSocket, afterFullAuth: afterFullAuth.promise };
  }

  async function fullAuthExchange(opts: Exchange) {
    using dir = tempDir("mysql-full-auth", {});
    const sockets = new Set<Socket>();
    const { onSocket, afterFullAuth } = fullAuthServer(opts, sockets);
    let server: Server;
    let endpoint: { path: string } | { hostname: string; port: number };
    if (opts.transport === "unix") {
      const unix = await listeningUnixServer(String(dir), onSocket);
      server = unix.server;
      endpoint = { path: unix.path };
    } else {
      const tcp = await listeningServer(onSocket);
      server = tcp.server;
      endpoint = { hostname: "127.0.0.1", port: tcp.port };
    }

    const db = new SQL({
      adapter: "mysql",
      ...endpoint,
      username: "u",
      password,
      database: "d",
      tls: false,
      max: 1,
      allowPublicKeyRetrieval: opts.allowPublicKeyRetrieval,
    });
    let outcome: string | { code: string };
    try {
      outcome = await db.connect().then(
        () => "connected",
        (e: { code?: string }) => ({ code: e?.code ?? String(e) }),
      );
    } finally {
      await db.close({ timeout: 0 });
      // Settles afterFullAuth (with []) if the client neither answered nor hung up.
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    return { outcome, afterFullAuth: await afterFullAuth };
  }

  test.each<{ name: string } & Exchange>([
    { name: "with the default options", transport: "unix" },
    { name: "even with allowPublicKeyRetrieval", transport: "unix", allowPublicKeyRetrieval: true },
    { name: "after an AuthSwitchRequest", transport: "unix", viaAuthSwitch: true },
  ])("over a unix socket the password is sent as is $name", async opts => {
    expect(await fullAuthExchange(opts)).toEqual({
      outcome: "connected",
      afterFullAuth: [CLEARTEXT_PASSWORD],
    });
  });

  test("over TCP nothing is sent unless allowPublicKeyRetrieval is set", async () => {
    expect(await fullAuthExchange({ transport: "tcp" })).toEqual({
      outcome: { code: "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED" },
      afterFullAuth: [],
    });
  });

  test("over TCP with allowPublicKeyRetrieval the public key is requested, never the password", async () => {
    expect(await fullAuthExchange({ transport: "tcp", allowPublicKeyRetrieval: true })).toEqual({
      outcome: { code: "ERR_MYSQL_SERVER_ERROR" },
      afterFullAuth: [PUBLIC_KEY_REQUEST],
    });
  });
});
