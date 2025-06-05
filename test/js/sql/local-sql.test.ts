import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { isLinux } from "harness";
import path from "path";
const postgres = (...args) => new SQL(...args);

import { exec, execSync } from "child_process";
import net from "net";
import { promisify } from "util";

const execAsync = promisify(exec);
const dockerCLI = Bun.which("docker") as string;

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
        idle_timeout: 20,
        max_lifetime: 60 * 30,
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

function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  // TODO: investigate why its not starting on Linux arm64
  if (isLinux && process.arch === "arm64") {
    return false;
  }

  try {
    const info = execSync(`${dockerCLI} info`, { stdio: ["ignore", "pipe", "inherit"] });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch {
    return false;
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
}
