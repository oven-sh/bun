import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, dockerExe, isDockerEnabled, tempDirWithFiles } from "harness";
import path from "path";
const postgres = (...args) => new SQL(...args);

import { exec } from "child_process";
import net from "net";
import { promisify } from "util";

const execAsync = promisify(exec);
const dockerCLI = dockerExe() as string;

async function findRandomPort() {
  return new Promise((resolve, reject) => {
    // Create a server to listen on a random port
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
async function waitForPostgres(port) {
  for (let i = 0; i < 3; i++) {
    try {
      const sql = new SQL(`postgres://bun_sql_test@localhost:${port}/bun_sql_test`, {
        idleTimeout: 1,
        connectionTimeout: 1,
        maxLifetime: 1,
        tls: {
          ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")),
        },
      });

      await sql`SELECT 1`;
      await sql.end();
      console.log("PostgreSQL is ready!");
      return true;
    } catch (error) {
      console.log(`Waiting for PostgreSQL... (${i + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("PostgreSQL failed to start");
}

async function startContainer(): Promise<{ port: number; containerName: string }> {
  try {
    // Build the Docker image
    console.log("Building Docker image...");
    const dockerfilePath = path.join(import.meta.dir, "docker-tls", "Dockerfile");
    await execAsync(`${dockerCLI} build --pull --rm -f "${dockerfilePath}" -t custom-postgres-tls .`, {
      cwd: path.join(import.meta.dir, "docker-tls"),
    });
    const port = await findRandomPort();
    const containerName = `postgres-test-${port}`;
    // Check if container exists and remove it
    try {
      await execAsync(`${dockerCLI} rm -f ${containerName}`);
    } catch (error) {
      // Container might not exist, ignore error
    }

    // Start the container
    await execAsync(`${dockerCLI} run -d --name ${containerName} -p ${port}:5432 custom-postgres-tls`);
    // Wait for PostgreSQL to be ready
    await waitForPostgres(port);
    return {
      port,
      containerName,
    };
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

if (isDockerEnabled()) {
  const container: { port: number; containerName: string } = await startContainer();
  afterAll(async () => {
    try {
      await execAsync(`${dockerCLI} stop -t 0 ${container.containerName}`);
      await execAsync(`${dockerCLI} rm -f ${container.containerName}`);
    } catch (error) {}
  });

  const connectionString = `postgres://bun_sql_test@localhost:${container.port}/bun_sql_test?sslmode=verify-full`;
  test("Connects using connection string", async () => {
    // we need at least the usename and port
    await using sql = postgres(connectionString, {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 1,
      tls: {
        ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")),
      },
    });

    const result = (await sql`select 1 as x`)[0].x;
    expect(result).toBe(1);
  });

  test("Dont connect using connection string without valid ca", async () => {
    try {
      // we need at least the usename and port
      await using sql = postgres(connectionString, {
        max: 1,
        idleTimeout: 1,
        connectionTimeout: 1,
      });

      (await sql`select 1 as x`)[0].x;
      expect.unreachable();
    } catch (error: any) {
      expect(error.code || error).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    }
  });

  test("rejectUnauthorized should work", async () => {
    // we need at least the usename and port
    await using sql = postgres(connectionString, {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 1,
      tls: {
        rejectUnauthorized: false,
      },
    });
    const result = (await sql`select 1 as x`)[0].x;
    expect(result).toBe(1);
  });

  test("should not segfault under pressure #21351", async () => {
    // we need at least the usename and port
    await using sql = postgres(connectionString, {
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 1,
      tls: {
        rejectUnauthorized: false,
      },
    });
    await sql`create table users (
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
    await sql.file(path.join(import.meta.dirname, "issue-21351.fixture.sql"));

    const dir = tempDirWithFiles("import-meta-no-inline", {
      "index.ts": `
       import { SQL } from "bun";

      const db = new SQL({
        url: process.env.DATABASE_URL,
        max: 1,
        idleTimeout: 60 * 5,
        maxLifetime: 60 * 15,
        tls: {
          ca: Bun.file(process.env.DATABASE_CA as string),
        },
      });
      await db.connect();
      const server = Bun.serve({
        port: 0,
        fetch: async (req) => {
          try{
            await Bun.sleep(100);
            let fragment = db\`\`;

              const searchs = await db\`
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
                  INNER JOIN users
                    ON users.id = post.user_id
                  \${fragment}
                  ORDER BY post.created_at DESC
                )
                SELECT
                  *
                FROM cte
                -- LIMIT 5
              \`;
            return Response.json(searchs);
          } catch {
            return new Response(null, { status: 500 });
          }
        },
      });

      console.log(server.url.href);
      `,
    });
    sql.end({ timeout: 0 });
    async function bombardier(url, batchSize = 100, abortSignal) {
      let batch = [];
      for (let i = 0; i < 100_000 && !abortSignal.aborted; i++) {
        //@ts-ignore
        batch.push(fetch(url, { signal: abortSignal }).catch(() => {}));
        if (batch.length > batchSize) {
          await Promise.all(batch);
          batch = [];
        }
      }
      await Promise.all(batch);
    }
    let failed = false;
    function spawnServer(controller) {
      return new Promise(async (resolve, reject) => {
        const server = Bun.spawn([bunExe(), "index.ts"], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          cwd: dir,
          env: {
            ...bunEnv,
            BUN_DEBUG_QUIET_LOGS: "1",
            DATABASE_URL: connectionString,
            DATABASE_CA: path.join(import.meta.dir, "docker-tls", "server.crt"),
          },
          onExit(proc, exitCode, signalCode, error) {
            // exit handler
            if (exitCode !== 0) {
              failed = true;
              controller.abort();
            }
          },
        });

        const reader = server.stdout.getReader();
        const errorReader = server.stderr.getReader();

        const decoder = new TextDecoder();
        async function outputData(reader, type = "log") {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              if (type === "error") {
                console.error(decoder.decode(value));
              } else {
                console.log(decoder.decode(value));
              }
            }
          }
        }

        const url = decoder.decode((await reader.read()).value);
        resolve({ url, kill: () => server.kill() });
        outputData(reader);
        errorReader.read().then(({ value }) => {
          if (value) {
            console.error(decoder.decode(value));
            failed = true;
          }
          outputData(errorReader, "error");
        });
      });
    }
    async function spawnRestarts(controller) {
      for (let i = 0; i < 20 && !controller.signal.aborted; i++) {
        await Bun.$`${dockerCLI} restart ${container.containerName}`.nothrow().quiet();
        await Bun.sleep(500);
      }

      try {
        controller.abort();
      } catch {}
    }

    const controller = new AbortController();

    const { promise, resolve, reject } = Promise.withResolvers();
    const server = (await spawnServer(controller)) as { url: string; kill: () => void };

    controller.signal.addEventListener("abort", () => {
      if (!failed) resolve();
      else reject(new Error("Server crashed"));
      server.kill();
    });

    bombardier(server.url, 100, controller.signal);

    await Bun.sleep(1000);
    spawnRestarts(controller);
    await promise;
  }, 30_000);
}
