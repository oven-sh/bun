import { randomUUIDv7, SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, nodeExe, tls as tlsCert } from "harness";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationCleartextPassword,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
  pgSSLRequest,
  pgSSLResponse,
} from "./wire-frames";

describeWithContainer(
  "PostgreSQL TLS",
  {
    image: "postgres_tls",
  },
  container => {
    test("tls options that request certificate verification reject an untrusted server certificate", async () => {
      await container.ready;
      const url = `postgres://postgres@${container.host}:${container.port}/bun_sql_test`;

      // `tls: { rejectUnauthorized: true }` is an explicit request to verify
      // the server certificate (the node-postgres / mysql2 idiom). The
      // container's certificate is self-signed, so the connection must be
      // refused instead of the verification verdict being discarded.
      {
        await using sql = new SQL({
          url,
          adapter: "postgres",
          max: 1,
          tls: { rejectUnauthorized: true },
        });
        const error = await sql`SELECT 1 as x`.then(
          () => null,
          e => e,
        );
        expect(error).not.toBeNull();
        expect(error.code || error).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      }

      // Supplying the CA that actually issued the server certificate still
      // connects: verification is enforced and passes.
      {
        await using sql = new SQL({
          url,
          adapter: "postgres",
          max: 1,
          tls: {
            ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")),
            serverName: "localhost",
          },
        });
        const [{ x }] = await sql`SELECT 1 as x`;
        expect(x).toBe(1);
      }
    });

    test("a BunFile tls option is the CA that the server certificate is verified against", async () => {
      await container.ready;
      const url = `postgres://postgres@${container.host}:${container.port}/bun_sql_test`;

      // The server certificate does not chain to this unrelated CA, so the
      // connection must be refused instead of proceeding over unverified TLS.
      {
        await using sql = new SQL({
          url,
          adapter: "postgres",
          max: 1,
          tls: Bun.file(path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem")),
        });
        const error = await sql`SELECT 1 as x`.then(
          () => null,
          e => e,
        );
        expect(error).not.toBeNull();
        expect(error.code || error).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      }

      // The issuing CA verifies. `?sslmode=verify-ca` skips only the hostname
      // check: the URL carries container.host and the certificate names `localhost`.
      {
        await using sql = new SQL({
          url: `${url}?sslmode=verify-ca`,
          adapter: "postgres",
          max: 1,
          tls: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")),
        });
        const [{ x }] = await sql`SELECT 1 as x`;
        expect(x).toBe(1);
      }
    });

    test("NODE_TLS_REJECT_UNAUTHORIZED=0 turns verification off, except next to rejectUnauthorized: true", async () => {
      await container.ready;
      const rows = [
        ["?sslmode=require", {}],
        ["?sslmode=verify-ca", {}],
        ["?sslmode=verify-full", {}],
        ["", { tls: { caFile: path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem") } }],
        ["?sslmode=verify-full", { tls: { rejectUnauthorized: false } }],
        ["?sslmode=verify-full", { tls: { rejectUnauthorized: true } }],
      ];
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const outcomes = [];
for (const [query, options] of JSON.parse(process.env.SQL_ROWS)) {
  const sql = new Bun.SQL(process.env.SQL_URL + query, { max: 1, ...options });
  outcomes.push(await sql\`select 1\`.then(() => "connected", e => e.code));
  await sql.close({ timeout: 0 });
}
console.log(JSON.stringify(outcomes));`,
        ],
        env: {
          ...bunEnv,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          SQL_URL: `postgres://postgres@${container.host}:${container.port}/bun_sql_test`,
          SQL_ROWS: JSON.stringify(rows),
        },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "connected",
        "connected",
        "connected",
        "connected",
        "connected",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
      ]);
      expect(exitCode).toBe(0);
    });

    // Test with prepared statements on and off
    for (const prepare of [true, false]) {
      describe(`prepared: ${prepare}`, () => {
        const getOptions = (): Bun.SQL.Options => ({
          url: `postgres://postgres@${container.host}:${container.port}/bun_sql_test`,
          tls: true,
          adapter: "postgres",
          max: 1,
          bigint: true,
          prepare,
        });

        test("tls (explicit)", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const [{ one, two }] = await sql`SELECT 1 as one, '2' as two`;
          expect(one).toBe(1);
          expect(two).toBe("2");
        });

        test("Throws on illegal transactions", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
          const error = await sql`BEGIN`.catch(e => e);
          expect(error).toBeInstanceOf(SQL.SQLError);
          expect(error).toBeInstanceOf(SQL.PostgresError);
          return expect(error.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
        });

        test("Transaction throws", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
          expect(
            await sql
              .begin(async sql => {
                await sql`insert into ${sql(random_name)} values(1)`;
                await sql`insert into ${sql(random_name)} values('hej')`;
              })
              .catch(e => e.errno),
          ).toBe("22P02");
        });

        test("Transaction rolls back", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();

          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;

          await sql
            .begin(async sql => {
              await sql`insert into ${sql(random_name)} values(1)`;
              await sql`insert into ${sql(random_name)} values('hej')`;
            })
            .catch(() => {
              /* ignore */
            });

          expect((await sql`select a from ${sql(random_name)}`).count).toBe(0);
        });

        test("Transaction throws on uncaught savepoint", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
          expect(
            await sql
              .begin(async sql => {
                await sql`insert into ${sql(random_name)} values(1)`;
                await sql.savepoint(async sql => {
                  await sql`insert into ${sql(random_name)} values(2)`;
                  throw new Error("fail");
                });
              })
              .catch(err => err.message),
          ).toBe("fail");
        });

        test("Transaction throws on uncaught named savepoint", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
          expect(
            await sql
              .begin(async sql => {
                await sql`insert into ${sql(random_name)} values(1)`;
                await sql.savepoint("watpoint", async sql => {
                  await sql`insert into ${sql(random_name)} values(2)`;
                  throw new Error("fail");
                });
              })
              .catch(e => e.message),
          ).toBe("fail");
        });

        test("Transaction succeeds on caught savepoint", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
          await sql.begin(async sql => {
            await sql`insert into ${sql(random_name)} values(1)`;
            await sql
              .savepoint(async sql => {
                await sql`insert into ${sql(random_name)} values(2)`;
                throw new Error("please rollback");
              })
              .catch(() => {
                /* ignore */
              });
            await sql`insert into ${sql(random_name)} values(3)`;
          });
          expect((await sql`select count(1) from ${sql(random_name)}`)[0].count).toBe(2n);
        });

        test("Savepoint returns Result", async () => {
          await container.ready;
          let result;
          await using sql = new SQL(getOptions());
          await sql.begin(async t => {
            result = await t.savepoint(s => s`select 1 as x`);
          });
          expect(result[0]?.x).toBe(1);
        });

        test("Transaction requests are executed implicitly", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            (
              await sql.begin(sql => [
                sql`select set_config('bun_sql.test', 'testing', true)`,
                sql`select current_setting('bun_sql.test') as x`,
              ])
            )[1][0].x,
          ).toBe("testing");
        });

        test("Uncaught transaction request errors bubbles to transaction", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            await sql
              .begin(sql => [sql`select wat`, sql`select current_setting('bun_sql.test') as x, ${1} as a`])
              .catch(e => e.errno),
          ).toBe("42703");
        });

        test("Transaction rejects with rethrown error", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            await sql
              .begin(async sql => {
                try {
                  await sql`select exception`;
                } catch (ex) {
                  throw new Error("WAT");
                }
              })
              .catch(e => e.message),
          ).toBe("WAT");
        });

        test("Parallel transactions", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });

          expect(
            (await Promise.all([sql.begin(sql => sql`select 1 as count`), sql.begin(sql => sql`select 1 as count`)]))
              .map(x => x[0].count)
              .join(""),
          ).toBe("11");
        });

        test("Many transactions at beginning of connection", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
          const xs = await Promise.all(Array.from({ length: 30 }, () => sql.begin(sql => sql`select 1`)));
          return expect(xs.length).toBe(30);
        });

        test("Transactions array", async () => {
          await container.ready;
          await using sql = new SQL(getOptions());
          expect(
            (await sql.begin(sql => [sql`select 1 as count`, sql`select 1 as count`])).map(x => x[0].count).join(""),
          ).toBe("11");
        });

        test("Transaction waits", async () => {
          await container.ready;
          await using sql = new SQL({ ...getOptions(), max: 2 });
          const random_name = ("t_" + randomUUIDv7("hex").replaceAll("-", "")).toLowerCase();
          await sql`CREATE TEMPORARY TABLE IF NOT EXISTS ${sql(random_name)} (a int)`;
          await sql.begin(async sql => {
            await sql`insert into ${sql(random_name)} values(1)`;
            await sql
              .savepoint(async sql => {
                await sql`insert into ${sql(random_name)} values(2)`;
                throw new Error("please rollback");
              })
              .catch(() => {
                /* ignore */
              });
            await sql`insert into ${sql(random_name)} values(3)`;
          });
          expect(
            (
              await Promise.all([
                sql.begin(async sql => await sql`select 1 as count`),
                sql.begin(async sql => await sql`select 1 as count`),
              ])
            )
              .map(x => x[0].count)
              .join(""),
          ).toBe("11");
        });
      });
    }
  },
);

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
test("postgres client refuses protocol messages received in place of the SSLRequest answer", async () => {
  // Until the server answers the 8-byte SSLRequest with 'S' or 'N', the socket
  // is still plaintext. A peer on the network path can answer with an
  // AuthenticationCleartextPassword message instead; if the client dispatches
  // it, it writes the password onto the unencrypted socket. Only 'S'/'N' may
  // be accepted while the SSLRequest answer is pending.
  const password = "hunter2-must-not-appear-on-the-wire";

  let preTlsClientBytes: Buffer = Buffer.alloc(0);
  let answeredSslRequest = false;
  const plaintextAfterAuthRequest: Buffer[] = [];
  const clientWroteToPlaintextSocket = Promise.withResolvers<void>();
  const sockets = new Set<import("node:net").Socket>();

  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("data", (data: Buffer) => {
      if (!answeredSslRequest) {
        preTlsClientBytes = Buffer.concat([preTlsClientBytes, data]);
        if (preTlsClientBytes.length < pgSSLRequest().length) return;
        answeredSslRequest = true;
        socket.write(pgAuthenticationCleartextPassword());
        return;
      }
      plaintextAfterAuthRequest.push(Buffer.from(data));
      clientWroteToPlaintextSocket.resolve();
      socket.end();
    });
  });

  try {
    await using sql = new SQL({
      url: `postgres://postgres:${password}@127.0.0.1:${port}/bun_sql_test`,
      adapter: "postgres",
      max: 1,
      tls: true,
    });
    const outcome = await Promise.race([
      sql`select 1`.then(
        () => ({ kind: "connected" }),
        e => ({ kind: "rejected", code: e?.code ?? String(e) }),
      ),
      clientWroteToPlaintextSocket.promise.then(() => ({ kind: "wrote to the plaintext socket" })),
    ]);

    // The client was waiting on the SSLRequest answer, so the only bytes it may
    // have written so far are the 8-byte SSLRequest itself.
    expect(preTlsClientBytes).toEqual(pgSSLRequest());
    // Nothing -- least of all the password -- may be written to the
    // still-unencrypted socket in response to the injected auth request.
    expect(Buffer.concat(plaintextAfterAuthRequest).toString("latin1")).not.toContain(password);
    expect(plaintextAfterAuthRequest.length).toBe(0);
    // And the connection must fail cleanly instead of proceeding in plaintext.
    expect(outcome).toEqual({ kind: "rejected", code: "ERR_POSTGRES_UNEXPECTED_MESSAGE" });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
test("postgres client aborts the connection when the server declines TLS that was explicitly requested", async () => {
  // `tls: true` (or any tls object) is an explicit request for an encrypted
  // connection. When the server answers the 8-byte SSLRequest with 'N'
  // ("SSL not available"), the client must abort the connection instead of
  // silently continuing the protocol in plaintext, which would put the
  // startup message and the password on the unencrypted socket.
  const password = "hunter2-must-not-appear-on-the-wire";

  for (const tls of [true, { rejectUnauthorized: false }] as const) {
    let preTlsClientBytes: Buffer = Buffer.alloc(0);
    let declinedTls = false;
    const plaintextAfterDecline: Buffer[] = [];
    const clientContinuedInPlaintext = Promise.withResolvers<void>();
    const sockets = new Set<import("node:net").Socket>();

    const { server, port } = await listeningServer(socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", (data: Buffer) => {
        if (!declinedTls) {
          preTlsClientBytes = Buffer.concat([preTlsClientBytes, data]);
          if (preTlsClientBytes.length < pgSSLRequest().length) return;
          declinedTls = true;
          // The legitimate "SSL not available" answer to an SSLRequest.
          socket.write(pgSSLResponse("N"));
          return;
        }
        // Anything received from here on is the client continuing the protocol
        // on the unencrypted socket (startup message, password, ...).
        plaintextAfterDecline.push(Buffer.from(data));
        clientContinuedInPlaintext.resolve();
        // A downgraded client would answer this with the cleartext password.
        socket.write(pgAuthenticationCleartextPassword());
      });
    });

    try {
      await using sql = new SQL({
        url: `postgres://postgres:${password}@127.0.0.1:${port}/bun_sql_test`,
        adapter: "postgres",
        max: 1,
        tls,
      });
      const outcome = await Promise.race([
        sql`select 1`.then(
          () => ({ kind: "connected" }),
          e => ({ kind: "rejected", code: e?.code ?? String(e) }),
        ),
        clientContinuedInPlaintext.promise.then(() => ({ kind: "continued in plaintext" })),
      ]);

      // The only plaintext bytes the client may ever send are the SSLRequest itself.
      expect(preTlsClientBytes).toEqual(pgSSLRequest());
      // After the server declines TLS, nothing further -- least of all the
      // password -- may be written to the unencrypted socket.
      expect(Buffer.concat(plaintextAfterDecline).toString("latin1")).not.toContain(password);
      expect(plaintextAfterDecline.length).toBe(0);
      // The connection must fail cleanly instead of downgrading to plaintext.
      expect(outcome).toEqual({ kind: "rejected", code: "ERR_POSTGRES_TLS_NOT_AVAILABLE" });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A plain-TCP Postgres that answers an SSLRequest with `sslRequestAnswer`, a StartupMessage with
// AuthenticationOk and a Query with one row, and hangs up on a ClientHello. Returns the frames it saw
// and what the client reported.
async function queryServerWithoutTls(
  sslRequestAnswer: Buffer,
  query: string,
  options: SQL.Options = {},
  PGSSLMODE?: string,
) {
  const wire: string[] = [];
  const sockets = new Set<net.Socket>();
  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    let buffered = Buffer.alloc(0);
    let started = false;
    socket.on("data", (data: Buffer) => {
      buffered = Buffer.concat([buffered, data]);
      while (!started) {
        if (buffered[0] === 0x16) {
          wire.push("ClientHello");
          return void socket.end();
        }
        if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) return;
        const frame = buffered.subarray(0, buffered.readInt32BE(0));
        buffered = buffered.subarray(frame.length);
        if (frame.equals(pgSSLRequest())) {
          wire.push("SSLRequest");
          socket.write(sslRequestAnswer);
        } else {
          wire.push("StartupMessage");
          started = true;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        }
      }
      buffered = pgReadFrontendMessages(buffered, type => {
        if (type !== "Q".charCodeAt(0)) return;
        wire.push("Query");
        socket.write(
          Buffer.concat([
            pgRowDescription([{ name: "x", typeOid: 25 }]),
            pgDataRow([Buffer.from("1")]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      });
    });
  });

  try {
    // The constructor reads the environment.
    if (PGSSLMODE) process.env.PGSSLMODE = PGSSLMODE;
    await using sql = new SQL({
      url: `postgres://u:pw@127.0.0.1:${port}/db${query}`,
      adapter: "postgres",
      max: 1,
      connectionTimeout: 5,
      ...options,
    });
    delete process.env.PGSSLMODE;
    const result = await sql`select 1`.simple().then(
      rows => rows[0].x,
      e => e.code,
    );
    return { wire, result };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

// https://www.postgresql.org/docs/current/libpq-ssl.html#LIBPQ-SSL-SSLMODE-STATEMENTS
test("postgres continues in plaintext after the server declines TLS only when the sslmode allows it", async () => {
  const plaintext = { wire: ["SSLRequest", "StartupMessage", "Query"], result: "1" };
  const refused = { wire: ["SSLRequest"], result: "ERR_POSTGRES_TLS_NOT_AVAILABLE" };
  const rows: [query: string, options: SQL.Options, outcome: unknown, PGSSLMODE?: string][] = [
    ["?sslmode=disable", {}, { wire: ["StartupMessage", "Query"], result: "1" }],
    ["?sslmode=allow", {}, plaintext],
    ["?sslmode=prefer", {}, plaintext],
    ["", { ssl: "prefer" }, plaintext],
    ["", { tls: "prefer" }, plaintext],
    ["", {}, plaintext, "prefer"],
    ["?sslmode=require", {}, refused],
    ["?sslmode=verify-ca", {}, refused],
    ["?sslmode=verify-full", {}, refused],
    ["?ssl=true", {}, refused],
    ["", {}, refused, "require"],
    ["", {}, refused, "verify-full"],
    ["?sslmode=prefer", { tls: true }, refused],
    ["?sslmode=prefer", { tls: {} }, refused],
    ["?sslmode=prefer", { tls: { rejectUnauthorized: false } }, refused],
    ["?sslmode=prefer", { ssl: "require" }, refused],
    ["?sslmode=prefer", { ssl: "verify-ca" }, refused],
    ["?sslmode=prefer", { ssl: "verify-full" }, refused],
  ];
  const outcomes = await Promise.all(
    rows.map(([query, options, , PGSSLMODE]) => queryServerWithoutTls(pgSSLResponse("N"), query, options, PGSSLMODE)),
  );
  expect(rows.map((row, i) => row.with(2, outcomes[i]))).toEqual(rows);
});

test("postgres sslmode=prefer takes the 'N', and nothing that comes with it or in its place", async () => {
  const injected = pgErrorResponse({ S: "FATAL", C: "XX000", M: "injected before startup" });
  expect(
    await Promise.all([
      queryServerWithoutTls(Buffer.concat([pgSSLResponse("N"), injected]), "?sslmode=prefer"),
      queryServerWithoutTls(pgAuthenticationCleartextPassword(), "?sslmode=prefer"),
      // The server accepts TLS and then hangs up on the handshake.
      queryServerWithoutTls(pgSSLResponse("S"), "?sslmode=prefer"),
    ]),
  ).toEqual([
    { wire: ["SSLRequest", "StartupMessage", "Query"], result: "1" },
    { wire: ["SSLRequest"], result: "ERR_POSTGRES_UNEXPECTED_MESSAGE" },
    { wire: ["SSLRequest", "ClientHello"], result: "ECONNRESET" },
  ]);
});

// Reads the client's TLS records off the wire, which a container cannot show. A PostgreSQL server
// logs "could not receive data from client" for a TLS connection that ends without a close_notify.
test.each([
  ["postgres", "idleTimeout"],
  ["postgres", "maxLifetime"],
  ["postgres", "close"],
  ["mysql", "idleTimeout"],
  ["mysql", "close"],
] as const)("%s sends a close_notify when %s closes a TLS connection", async (adapter, option) => {
  // TLS 1.2 leaves a record's type in the clear.
  const ALERT = 21;
  const terminator = tls.createServer({ ...tlsCert, maxVersion: "TLSv1.2" }, socket => {
    socket.on("error", () => {});
    if (adapter === "postgres") {
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
      return;
    }
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!mysqlAckSessionSetup(socket, payload)) socket.write(mysqlOkPacket(seq + 1));
      });
    });
  });
  await new Promise<void>(resolve => terminator.listen(0, "127.0.0.1", resolve));

  // The client's plaintext request for TLS: the SSLRequest message, resp. packet.
  const requestLength = adapter === "postgres" ? 8 : 36;
  let records: Buffer = Buffer.alloc(0);
  const closed = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(client => {
    client.on("error", () => {});
    client.on("close", () => closed.resolve());
    if (adapter === "mysql") {
      client.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    }
    client.once("data", (request: Buffer) => {
      if (adapter === "postgres") client.write(pgSSLResponse("S"));
      const upstream = net.connect((terminator.address() as net.AddressInfo).port, "127.0.0.1");
      upstream.on("error", () => {});
      records = request.subarray(requestLength);
      upstream.write(records);
      client.on("data", (chunk: Buffer) => {
        records = Buffer.concat([records, chunk]);
      });
      client.pipe(upstream).pipe(client);
    });
  });

  try {
    await using sql = new SQL({
      url: `${adapter}://postgres@127.0.0.1:${port}/bun_sql_test`,
      max: 1,
      tls: { rejectUnauthorized: false },
      // The lifetime starts before the handshake, and has to outlast it.
      ...(option !== "close" && { [option]: option === "maxLifetime" ? 0.5 : 0.05 }),
    });
    await sql.connect();
    if (option === "close") await sql.close();
    await closed.promise;

    const types: number[] = [];
    for (let i = 0; i + 5 <= records.length; i += 5 + records.readUInt16BE(i + 3)) types.push(records[i]);
    expect(types.at(-1)).toBe(ALERT);
  } finally {
    server.close();
    terminator.close();
  }
});

// A node process: a TLS server in Bun cannot renegotiate. It takes every login, answers query n with "n rows", and
// asks for a new handshake when it has read the second query, before it answers it. Line 1 of its output is its port.
// When its stdin ends, it prints what it received.
const renegotiatingServer = /* js */ `
  const net = require("net");
  const { PROTOCOL, GREETING, SERVER_CERT: cert, SERVER_KEY: key } = process.env;
  const received = [];
  process.stdin.on("end", () => console.log(JSON.stringify(received))).resume();
  const int32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
  const pg = (type, body) => Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
  const protocols = {
    // 3 bytes of length, a sequence number, the payload. COM_QUERY is 0x03 and the text.
    mysql: {
      sslRequest: first => 4 + first.readUIntLE(0, 3),
      sslAnswer: Buffer.alloc(0),
      length: (pending, loggedIn) => 4 + pending.readUIntLE(0, 3),
      name: (message, loggedIn) => !loggedIn ? "login" : message[4] === 0x03 ? message.toString("latin1", 5) : "?",
      answer: (message, rows) => Buffer.from([7, 0, 0, message[3] + 1, 0x00, rows, 0, 0x02, 0, 0, 0]),
    },
    // A type, but for the first message, and 4 bytes of length that count themselves. Q is the text and a NUL.
    postgres: {
      sslRequest: () => 8,
      sslAnswer: Buffer.from("S"),
      length: (pending, loggedIn) => loggedIn ? 1 + pending.readInt32BE(1) : pending.readInt32BE(0),
      name: (message, loggedIn) => !loggedIn ? "login" : message[0] === 0x51 ? message.toString("latin1", 5, message.length - 1) : "?",
      answer: (message, rows, loggedIn) => Buffer.concat([
        loggedIn ? pg("C", Buffer.from("INSERT 0 " + rows + "\\0")) : pg("R", int32(0)),
        pg("Z", Buffer.from("I")),
      ]),
    },
  };
  const protocol = protocols[PROTOCOL];
  const secure = require("tls").createServer({ cert, key, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" }, socket => {
    socket.on("error", () => {});
    let pending = Buffer.alloc(0), loggedIn = false;
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5 && pending.length >= protocol.length(pending, loggedIn)) {
        const message = pending.subarray(0, protocol.length(pending, loggedIn));
        pending = pending.subarray(message.length);
        const name = protocol.name(message, loggedIn);
        received.push(name);
        const reply = protocol.answer(message, Number(/^do (\\d)$/.exec(name)?.[1] ?? 0), loggedIn);
        loggedIn = true;
        if (name === "do 2") socket.renegotiate({}, err => (err ? socket.destroy(err) : socket.write(reply)));
        else socket.write(reply);
      }
    });
  });
  secure.listen(0, "127.0.0.1");
  // In plaintext up to the end of the client's request for TLS.
  const server = net.createServer(plain => {
    plain.on("error", () => {});
    plain.write(Buffer.from(GREETING, "hex"));
    plain.once("data", first => {
      plain.pause();
      plain.write(protocol.sslAnswer);
      const inner = net.connect(secure.address().port, "127.0.0.1", () => {
        inner.write(first.subarray(protocol.sslRequest(first)));
        plain.pipe(inner).pipe(plain);
      });
      inner.on("error", () => {});
    });
  });
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

// The end of every handshake is reported. What follows the first one, the login, must not go out again: the reply to
// it would be taken for the reply to the next query.
test.skipIf(!nodeExe()).each([
  ["mysql", mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }).toString("hex")],
  ["postgres", ""],
])("%s logs in once to a server that renegotiates", async (protocol, greeting) => {
  await using server = Bun.spawn({
    cmd: [nodeExe()!, "-e", renegotiatingServer],
    env: { ...bunEnv, PROTOCOL: protocol, GREETING: greeting, SERVER_CERT: tlsCert.cert, SERVER_KEY: tlsCert.key },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const lines = (async function* () {
    let output = "";
    for await (const chunk of server.stdout.pipeThrough(new TextDecoderStream())) {
      output += chunk;
      for (let end; (end = output.indexOf("\n")) !== -1; output = output.slice(end + 1)) yield output.slice(0, end);
    }
  })();
  async function nextLine() {
    const { value, done } = await lines.next();
    if (done) throw new Error(`the server exited with code ${await server.exited}`);
    return value;
  }
  const port = Number(await nextLine());

  await using sql = new SQL(`${protocol}://user:secret@127.0.0.1:${port}/db`, {
    max: 1,
    tls: { ca: tlsCert.cert, serverName: "localhost" },
  });
  const rows: unknown[] = [];
  for (let n = 1; n <= 4; n++) {
    rows.push(
      await sql
        .unsafe(`do ${n}`)
        .simple()
        .then(
          result => result.affectedRows ?? result.count,
          err => err.message,
        ),
    );
  }
  server.stdin.end();
  const received: string[] = JSON.parse(await nextLine());
  // MySQL: the session is set up with a query of the client's own.
  expect({ rows, received: received.filter(name => !name.startsWith("SET ")) }).toEqual({
    rows: [1, 2, 3, 4],
    received: ["login", "do 1", "do 2", "do 3", "do 4"],
  });
});
