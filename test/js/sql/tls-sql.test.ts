import { SQL, randomUUIDv7 } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";
import path from "node:path";
import { listeningServer, pgAuthenticationCleartextPassword, pgSSLRequest, pgSSLResponse } from "./wire-frames";

if (!isDockerEnabled()) {
  test.skip("skipping TLS SQL tests - Docker is not available", () => {});
} else {
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
}

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

  let preTlsClientBytes = Buffer.alloc(0);
  let answeredSslRequest = false;
  const plaintextAfterAuthRequest: Buffer[] = [];
  const clientWroteToPlaintextSocket = Promise.withResolvers<void>();
  const sockets = new Set<import("node:net").Socket>();

  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("data", data => {
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
    let preTlsClientBytes = Buffer.alloc(0);
    let declinedTls = false;
    const plaintextAfterDecline: Buffer[] = [];
    const clientContinuedInPlaintext = Promise.withResolvers<void>();
    const sockets = new Set<import("node:net").Socket>();

    const { server, port } = await listeningServer(socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", data => {
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
