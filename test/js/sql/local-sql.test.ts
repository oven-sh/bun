import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, tempDir } from "harness";
import net from "node:net";
import path from "node:path";

describeWithContainer("Postgres TLS (verify-full)", { image: "postgres_tls" }, container => {
  const caPath = path.join(import.meta.dir, "docker-tls", "server.crt");
  const connectionString = () =>
    `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test?sslmode=verify-full`;

  test("Connects using connection string", async () => {
    await container.ready;
    await using sql = new SQL(connectionString(), {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 5,
      // The server certificate's CN/SAN is `localhost`; pin that for the
      // identity check so the URL can carry container.host.
      tls: { ca: Bun.file(caPath), serverName: "localhost" },
    });
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
  });

  test("Dont connect using connection string without valid ca", async () => {
    await container.ready;
    await using sql = new SQL(connectionString(), {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 5,
    });
    const error = await sql`select 1 as x`.then(
      () => null,
      e => e,
    );
    expect(error?.code || error).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("rejectUnauthorized should work", async () => {
    await container.ready;
    await using sql = new SQL(connectionString(), {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 5,
      tls: { rejectUnauthorized: false },
    });
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
  });

  // #21351 was a segfault in the postgres DataRow path when a TLS connection
  // dropped while queries were in flight. The original reproduction restarted
  // the docker container 20× while bombarding an HTTP server that queries
  // postgres. A TCP proxy the test controls reproduces the same "TLS stream
  // torn down mid-query" condition without touching the shared container, so
  // this file no longer needs its own `docker build`/`docker run` and a
  // per-iteration `docker restart`.
  test("should not segfault under pressure #21351", async () => {
    await container.ready;

    // Schema lives in the shared container's public schema; DROP IF EXISTS
    // keeps repeated runs idempotent. (Only tls-sql.test.ts shares this
    // container and it uses random-named temporary tables.)
    {
      await using setup = new SQL(connectionString(), {
        max: 1,
        tls: { rejectUnauthorized: false },
      });
      await setup`
          drop table if exists posts;
          drop table if exists users;
          create table users (
            id text not null,
            created_at timestamp with time zone not null default now(),
            name text null,
            email text null,
            identifier text not null default '-'::text,
            role text null default 'CUSTOMER'::text,
            phone text null,
            bio jsonb null,
            skills jsonb null default '[]'::jsonb,
            privacy text null default 'PUBLIC'::text,
            linkedin_url text null,
            github_url text null,
            facebook_url text null,
            twitter_url text null,
            picture jsonb null,
            constraint users_pkey primary key (id),
            constraint users_identifier_key unique (identifier)
          ) TABLESPACE pg_default;
          create table posts (
            id uuid not null default gen_random_uuid (),
            created_at timestamp with time zone not null default now(),
            user_id text null,
            title text null,
            content jsonb null,
            tags jsonb null,
            type text null default 'draft'::text,
            attachments jsonb null default '[]'::jsonb,
            updated_at timestamp with time zone null,
            constraint posts_pkey primary key (id),
            constraint posts_user_id_fkey foreign KEY (user_id) references users (id) on update CASCADE on delete CASCADE
          ) TABLESPACE pg_default;`.simple();
      await setup.file(path.join(import.meta.dirname, "issue-21351.fixture.sql"));
      const [{ users, posts }] = await setup`
          select (select count(*) from users)::int as users,
                 (select count(*) from posts)::int as posts`;
      expect({ users, posts }).toEqual({ users: 50, posts: 100 });
    }

    // TCP proxy so we can drop the TLS stream mid-query.
    const activeSockets = new Set<net.Socket>();
    const proxy = net.createServer(client => {
      const upstream = net.connect(container.port, container.host);
      activeSockets.add(client);
      activeSockets.add(upstream);
      client.on("error", () => {}).pipe(upstream);
      upstream.on("error", () => {}).pipe(client);
      const cleanup = () => {
        activeSockets.delete(client);
        activeSockets.delete(upstream);
        client.destroy();
        upstream.destroy();
      };
      client.once("close", cleanup);
      upstream.once("close", cleanup);
    });
    await new Promise<void>(r => proxy.listen(0, r));
    const proxyPort = (proxy.address() as net.AddressInfo).port;

    const dropAll = () => {
      for (const s of [...activeSockets]) s.destroy();
    };
    using _proxy = {
      [Symbol.dispose]() {
        dropAll();
        proxy.close();
      },
    };

    using dir = tempDir("issue-21351", {
      "index.ts": `
          import { SQL } from "bun";
          const db = new SQL({
            url: process.env.DATABASE_URL,
            max: 1,
            idleTimeout: 60 * 5,
            maxLifetime: 60 * 15,
            tls: { ca: Bun.file(process.env.DATABASE_CA as string) },
          });
          await db.connect();
          const server = Bun.serve({
            port: 0,
            fetch: async () => {
              try {
                let fragment = db\`\`;
                const rows = await db\`
                  WITH cte AS (
                    SELECT
                      post.id,
                      post."content",
                      post.created_at AS "createdAt",
                      users."name" AS "userName",
                      users.id AS "userId",
                      users.identifier AS "userIdentifier",
                      users.picture AS "userPicture",
                      '{}'::json AS "group"
                    FROM posts post
                    INNER JOIN users ON users.id = post.user_id
                    \${fragment}
                    ORDER BY post.created_at DESC
                  )
                  SELECT * FROM cte
                \`;
                return Response.json(rows);
              } catch (e) {
                return new Response(String(e), { status: 500 });
              }
            },
          });
          console.log(server.url.href);
        `,
    });

    let crashExit: number | string | null = null;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://bun_sql_test@localhost:${proxyPort}/bun_sql_test?sslmode=verify-full`,
        DATABASE_CA: caPath,
      },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      onExit(_, exitCode, signalCode) {
        if (signalCode !== "SIGTERM") crashExit = exitCode ?? signalCode;
      },
    });

    const stderrText = proc.stderr.text();
    const decoder = new TextDecoder();
    const stdoutReader = proc.stdout.getReader();
    const first = await stdoutReader.read();
    if (first.done) {
      // Subprocess exited before printing its URL; surface the real cause.
      expect({ stderr: await stderrText, exitCode: await proc.exited }).toEqual({ stderr: "", exitCode: 0 });
    }
    const url = decoder.decode(first.value).trim();
    expect(url).toStartWith("http://");
    let extraStdout = "";
    const stdoutDrain = (async () => {
      for (;;) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        extraStdout += decoder.decode(value);
      }
    })();

    // First request must succeed end-to-end (100 rows joined) before we
    // start dropping connections; this also replaces the old fixed 1s sleep.
    {
      const firstOk = await fetch(url);
      const body = await firstOk.text();
      expect({ status: firstOk.status, body: firstOk.status === 200 ? JSON.parse(body).length : body }).toEqual({
        status: 200,
        body: 100,
      });
    }

    // Bombard while repeatedly tearing the proxy connections. The server's
    // handler catches query errors and returns 500, so every fetch resolves;
    // what matters is that the subprocess never crashes.
    const controller = new AbortController();
    const seen = { ok: 0, interrupted: 0 };
    const bombard = (async () => {
      let batch: Promise<unknown>[] = [];
      while (!controller.signal.aborted) {
        batch.push(
          fetch(url, { signal: controller.signal })
            .then(r => {
              if (r.status === 200) seen.ok++;
              else seen.interrupted++;
            })
            .catch(() => {}),
        );
        if (batch.length >= 50) {
          await Promise.all(batch);
          batch = [];
        }
      }
      await Promise.all(batch);
    })();

    for (let i = 0; i < 20 && crashExit === null; i++) {
      dropAll();
      // Stress-workload spacing, not a condition wait: the first drop already
      // tears the warm connection from the 200 above, so the seen.interrupted
      // assertion is not timing-dependent, and a drop that lands mid-handshake
      // still rejects the queued query into a 500. 100ms leaves room for the
      // debug+ASAN subprocess to reconnect and reach DataRow on most
      // iterations, matching the old `docker restart` + `Bun.sleep(500)` loop.
      await Bun.sleep(100);
    }
    controller.abort();
    await bombard;

    proc.kill();
    const [stderr] = await Promise.all([stderrText, stdoutDrain, proc.exited]);
    // The original failure mode was a segfault (SIGSEGV) in the postgres
    // DataRow path when a query's TLS connection dropped mid-row.
    expect({ crashExit, stderr, stdout: extraStdout }).toEqual({ crashExit: null, stderr: "", stdout: "" });
    expect(proc.signalCode).toBe("SIGTERM");
    // Drops must have actually torn a query mid-flight at least once,
    // otherwise this test wasn't exercising the #21351 path.
    expect(seen.interrupted).toBeGreaterThan(0);
  }, 30_000);
});
