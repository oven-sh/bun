import { randomUUIDv7, SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isWindows, tempDir } from "harness";
import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import {
  listeningServer,
  MYSQL_FAST_AUTH_SUCCESS,
  MYSQL_MOCK_AUTH_DATA_PART_1,
  MYSQL_MOCK_AUTH_DATA_PART_2,
  mysqlAckSessionSetup,
  mysqlAuthMoreData,
  mysqlAuthSwitchRequest,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlParseHandshakeResponse41,
  mysqlReadPackets,
  mysqlTextResultSet,
} from "./wire-frames";

// mysql_plain advertises caching_sha2_password, so such an account answers the handshake's nonce.
// mysql_native_password advertises the native plugin, so the same account answers the nonce of an AuthSwitchRequest.
for (const { image, root } of [
  { image: "mysql_plain", root: "root" },
  { image: "mysql_native_password", root: "root:bun" },
]) {
  describeWithContainer(`auth plugins on ${image}`, { image, concurrent: true }, container => {
    const url = (userinfo: string) => `mysql://${userinfo}@${container.host}:${container.port}/bun_sql_test`;
    const passwordOf = (length: number) => "Abcdefghij0123456789KLMNOPQRSTUVWXYZ".slice(0, length);

    /** A new account has nothing in the server's caching_sha2_password cache. */
    async function withAccount(plugin: string, password: string, run: (user: string) => Promise<void>) {
      await using admin = new SQL({ url: url(root), max: 1 });
      const user = "u" + randomUUIDv7("hex").replaceAll("-", "").slice(-20);
      await admin.unsafe(`CREATE USER '${user}'@'%' IDENTIFIED WITH ${plugin} BY '${password}'`).simple();
      try {
        await admin.unsafe(`GRANT ALL PRIVILEGES ON bun_sql_test.* TO '${user}'@'%'`).simple();
        await run(user);
      } finally {
        await admin.unsafe(`DROP USER '${user}'@'%'`).simple();
      }
    }

    async function login(user: string, password: string, options: Bun.SQL.Options = {}) {
      await using sql = new SQL({ url: url(`${user}:${password}`), max: 1, ...options });
      return await sql`SELECT 1 AS x`.then(
        () => "ok",
        e => e.errno ?? e.code,
      );
    }
    const overTLS = { tls: { rejectUnauthorized: false }, sslmode: "require" } as Bun.SQL.Options;

    test("root logs in", async () => {
      await using sql = new SQL({ url: url(root), max: 1 });
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    });

    test.each([6, 19, 20, 32])("caching_sha2_password with a password of %d bytes", async length => {
      const password = passwordOf(length);
      await withAccount("caching_sha2_password", password, async user => {
        expect({
          cold: await login(user, password),
          fullAuthentication: await login(user, password, { allowPublicKeyRetrieval: true }),
          // The server has the hash now and checks the scramble against it.
          warm: await login(user, password),
          warmWrongPassword: await login(user, password + "x", { allowPublicKeyRetrieval: true }),
        }).toEqual({
          cold: "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
          fullAuthentication: "ok",
          warm: "ok",
          warmWrongPassword: 1045,
        });
      });
    });

    test("caching_sha2_password over TLS, then warm without it", async () => {
      const password = passwordOf(32);
      await withAccount("caching_sha2_password", password, async user => {
        expect({ tls: await login(user, password, overTLS), warm: await login(user, password) }).toEqual({
          tls: "ok",
          warm: "ok",
        });
      });
    });

    test("caching_sha2_password with a password that is not ASCII", async () => {
      await withAccount("caching_sha2_password", "pässwörd-日本語-😀", async user => {
        const password = encodeURIComponent("pässwörd-日本語-😀");
        expect({
          fullAuthentication: await login(user, password, { allowPublicKeyRetrieval: true }),
          warm: await login(user, password),
        }).toEqual({ fullAuthentication: "ok", warm: "ok" });
      });
    });

    // No scramble and no cache: the password goes over TLS, or encrypted with the server's RSA key.
    test.each([6, 19, 20, 32])("sha256_password with a password of %d bytes", async length => {
      const password = passwordOf(length);
      await withAccount("sha256_password", password, async user => {
        expect({
          plain: await login(user, password),
          rsa: await login(user, password, { allowPublicKeyRetrieval: true }),
          again: await login(user, password),
          tls: await login(user, password, overTLS),
          wrongPassword: await login(user, password + "x", { allowPublicKeyRetrieval: true }),
          wrongPasswordTLS: await login(user, password + "x", overTLS),
        }).toEqual({
          plain: "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
          rsa: "ok",
          again: "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
          tls: "ok",
          wrongPassword: 1045,
          wrongPasswordTLS: 1045,
        });
      });
    });

    test.each(["caching_sha2_password", "sha256_password"])("%s with an empty password", async plugin => {
      await withAccount(plugin, "", async user => {
        expect({ empty: await login(user, ""), wrong: await login(user, "x", overTLS) }).toEqual({
          empty: "ok",
          wrong: 1045,
        });
      });
    });
  });
}

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
      socket.on("data", (chunk: Buffer) => {
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
          // The session-setup COM_QUERY (SET time_zone) belongs to connection
          // establishment; ack it and keep it out of `commands`.
          if (mysqlAckSessionSetup(socket, payload)) return;
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
    socket.on("data", (chunk: Buffer) => {
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
        } else if (mysqlAckSessionSetup(socket, payload)) {
          // session setup acked
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
    expect(sent.toString("hex")).toBe(expected(handshakeNonce));
    expect(rows).toEqual([{ v: "REAL-ROW" }]);
  } finally {
    server.close();
  }
});

// AuthMoreData 0x04 (perform_full_authentication) over plain TCP makes the client
// fetch the server's RSA public key, which is refused unless allowPublicKeyRetrieval
// is set. Every MySQL 8 first connection for a user looks like this by default, so
// the refusal must name the cause and the remedies, not just say "Connection closed".
test("public key retrieval refusal names allowPublicKeyRetrieval and TLS as remedies", async () => {
  const PERFORM_FULL_AUTH = 0x04;
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!authed) {
          // HandshakeResponse41 -> demand full authentication.
          authed = true;
          socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([PERFORM_FULL_AUTH])));
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({ url: `mysql://root:pw@127.0.0.1:${port}/db`, max: 1 });
    const err = await sql.connect().then(
      () => null,
      e => e,
    );
    expect(err?.code).toBe("ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED");
    expect(err?.message).toContain("allowPublicKeyRetrieval: true");
    expect(err?.message).toContain("TLS");
  } finally {
    server.close();
  }
});

// How the server reads the packet after "perform full authentication" depends on the transport.
// CI's containers do not export their sockets, so the server side of a unix socket is scripted.
const PERFORM_FULL_AUTH = 0x04;
const serverKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const switchNonce = Buffer.alloc(20, 0x63);

/** The password an RSA block holds: XOR(password + NUL, nonce), OAEP. */
function decryptPassword(block: Buffer, nonce: Buffer) {
  const plain = privateDecrypt({ key: serverKey.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING }, block);
  return Buffer.from(plain.map((byte, i) => byte ^ nonce[i % nonce.length])).toString("latin1");
}

// The nonce is 20 bytes: part 1 and the first 12 bytes of part 2. The 13th is its terminating NUL.
const handshakeNonce = Buffer.concat([MYSQL_MOCK_AUTH_DATA_PART_1, MYSQL_MOCK_AUTH_DATA_PART_2.subarray(0, 12)]);
const scripts = {
  /** The handshake advertises the plugin; the scramble is answered with "perform full authentication". */
  "caching_sha2_password": { advertises: "caching_sha2_password", nonce: handshakeNonce },
  /** The handshake advertises another plugin; an AuthSwitchRequest brings this one and its nonce. */
  "sha256_password": { advertises: "caching_sha2_password", nonce: switchNonce },
  /** The handshake advertises the plugin; its first message is in the handshake response. */
  "sha256_password as the server's default": { advertises: "sha256_password", nonce: handshakeNonce },
};

/** Records what the client sends to get the password across. */
function authScript(name: keyof typeof scripts, packets: string[]) {
  const { advertises, nonce } = scripts[name];
  return (socket: net.Socket) => {
    let buffered = Buffer.alloc(0);
    let state: "handshake response" | "password" | "authenticated" = "handshake response";
    socket.write(mysqlHandshakeV10({ authPlugin: advertises }));
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (state === "authenticated") {
          if (!mysqlAckSessionSetup(socket, payload)) socket.end();
          return;
        }
        if (state === "handshake response") {
          state = "password";
          if (name === "caching_sha2_password") {
            socket.write(mysqlAuthMoreData(seq + 1, Buffer.from([PERFORM_FULL_AUTH])));
            return;
          }
          if (name === "sha256_password") {
            socket.write(mysqlAuthSwitchRequest(seq + 1, name, Buffer.concat([nonce, Buffer.from([0])])));
            return;
          }
          payload = mysqlParseHandshakeResponse41(payload).authResponse;
        }
        if (payload.length === 1 && payload[0] !== 0) {
          packets.push(`key request 0x0${payload[0]}`);
          socket.write(mysqlAuthMoreData(seq + 1, Buffer.from(serverKey.publicKey)));
          return;
        }
        packets.push(
          payload.length === 256
            ? `rsa ${JSON.stringify(decryptPassword(payload, nonce))}`
            : `clear ${JSON.stringify(payload.toString("latin1"))}`,
        );
        state = "authenticated";
        socket.write(mysqlOkPacket(seq + 1));
      });
    });
    socket.on("error", () => {});
  };
}

const longPassword = "a-password-of-more-than-20-bytes";
test.skipIf(isWindows).each([
  // [plugin, allowPublicKeyRetrieval, outcome, auth packets]
  ["caching_sha2_password", false, "ok", [`clear ${JSON.stringify(longPassword + "\0")}`]],
  // The server's sha256_password takes nothing but TLS for a secure transport.
  ["sha256_password", false, "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED", []],
  ["sha256_password", true, "ok", ["key request 0x01", `rsa ${JSON.stringify(longPassword + "\0")}`]],
] as const)(
  "%s over a unix socket, allowPublicKeyRetrieval: %p",
  async (plugin, allowPublicKeyRetrieval, outcome, sent) => {
    using dir = tempDir("mysql-auth-socket", {});
    const path = join(String(dir), "mysqld.sock");
    const packets: string[] = [];
    const server = net.createServer(authScript(plugin, packets)).listen(path);
    await once(server, "listening");
    try {
      await using sql = new SQL({
        adapter: "mysql",
        path,
        username: "root",
        password: longPassword,
        database: "db",
        max: 1,
        allowPublicKeyRetrieval,
      });
      const result = await sql.connect().then(
        () => "ok",
        e => e.code,
      );
      expect({ result, packets }).toEqual({ result: outcome, packets: [...sent] });
    } finally {
      server.close();
    }
  },
);

test.each([
  ["caching_sha2_password", "key request 0x02"],
  ["sha256_password", "key request 0x01"],
  ["sha256_password as the server's default", "key request 0x01"],
] as const)("%s over TCP encrypts the password against the 20-byte nonce", async (plugin, keyRequest) => {
  const packets: string[] = [];
  const { server, port } = await listeningServer(authScript(plugin, packets));
  try {
    await using sql = new SQL({
      url: `mysql://root:${longPassword}@127.0.0.1:${port}/db`,
      max: 1,
      allowPublicKeyRetrieval: true,
    });
    const result = await sql.connect().then(
      () => "ok",
      e => e.code,
    );
    expect({ result, packets }).toEqual({
      result: "ok",
      packets: [keyRequest, `rsa ${JSON.stringify(longPassword + "\0")}`],
    });
  } finally {
    server.close();
  }
});

test("sha256_password as the server's default: an empty password is one NUL, and no key is asked for unbidden", async () => {
  const packets: string[] = [];
  const { server, port } = await listeningServer(authScript("sha256_password as the server's default", packets));
  try {
    const login = async (userinfo: string) => {
      await using sql = new SQL({ url: `mysql://${userinfo}@127.0.0.1:${port}/db`, max: 1 });
      return await sql.connect().then(
        () => "ok",
        e => e.code,
      );
    };
    expect({ empty: await login("root"), password: await login("root:pw"), packets }).toEqual({
      empty: "ok",
      password: "ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED",
      packets: ['clear "\\u0000"'],
    });
  } finally {
    server.close();
  }
});
