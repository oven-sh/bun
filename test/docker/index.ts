import { spawn } from "bun";
import * as net from "net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ServiceName =
  | "postgres_plain"
  | "postgres_tls"
  | "postgres_auth"
  | "mysql_plain"
  | "mysql_native_password"
  | "mysql_tls"
  | "redis_plain"
  | "redis_unified"
  | "minio"
  | "autobahn"
  | "squid";

export interface ServiceInfo {
  host: string;
  ports: Record<number, number>;
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
  };
  socketPath?: string;
  users?: Record<string, string>;
}

const serviceMeta: Record<ServiceName, { ports: number[]; tls?: ServiceInfo["tls"]; users?: ServiceInfo["users"] }> = {
  postgres_plain: { ports: [5432] },
  postgres_tls: {
    ports: [5432],
    tls: {
      cert: join(__dirname, "../js/sql/docker-tls/server.crt"),
      key: join(__dirname, "../js/sql/docker-tls/server.key"),
    },
  },
  postgres_auth: {
    ports: [5432],
    users: {
      bun_sql_test: "",
      bun_sql_test_md5: "bun_sql_test_md5",
      bun_sql_test_scram: "bun_sql_test_scram",
    },
  },
  mysql_plain: { ports: [3306] },
  mysql_native_password: { ports: [3306] },
  mysql_tls: {
    ports: [3306],
    tls: {
      ca: join(__dirname, "../js/sql/mysql-tls/ssl/ca.pem"),
      cert: join(__dirname, "../js/sql/mysql-tls/ssl/server-cert.pem"),
      key: join(__dirname, "../js/sql/mysql-tls/ssl/server-key.pem"),
    },
  },
  redis_plain: { ports: [6379] },
  redis_unified: {
    ports: [6379, 6380],
    tls: {
      cert: join(__dirname, "../js/valkey/docker-unified/server.crt"),
      key: join(__dirname, "../js/valkey/docker-unified/server.key"),
    },
    users: {
      default: "",
      testuser: "test123",
      readonly: "readonly",
      writeonly: "writeonly",
    },
  },
  minio: { ports: [9000, 9001] },
  autobahn: { ports: [9002] },
  squid: { ports: [3128] },
};

function serviceFromEnv(service: ServiceName): ServiceInfo | null {
  const raw = process.env["BUN_TEST_SERVICE_" + service];
  if (!raw) return null;

  const meta = serviceMeta[service];
  const ports: Record<number, number> = {};
  const colon = raw.indexOf(":");
  let host: string;

  if (colon === -1) {
    host = raw;
    for (const p of meta.ports) ports[p] = p;
  } else {
    host = raw.slice(0, colon);
    if (!host) {
      throw new Error(`BUN_TEST_SERVICE_${service}: missing host in "${raw}"`);
    }
    const spec = raw.slice(colon + 1);
    if (spec.includes("=")) {
      for (const pair of spec.split(",")) {
        const m = /^(\d+)=(\d+)$/.exec(pair);
        if (!m) {
          throw new Error(`BUN_TEST_SERVICE_${service}: malformed port mapping "${pair}" in "${raw}"`);
        }
        ports[Number(m[1])] = Number(m[2]);
      }
      for (const p of meta.ports) if (!(p in ports)) ports[p] = p;
    } else {
      if (!/^\d+$/.test(spec)) {
        throw new Error(`BUN_TEST_SERVICE_${service}: malformed port spec "${spec}" in "${raw}"`);
      }
      if (meta.ports.length !== 1) {
        throw new Error(
          `BUN_TEST_SERVICE_${service}: single port in "${raw}" is ambiguous for a ${meta.ports.length}-port service; use cport=hport pairs`,
        );
      }
      ports[meta.ports[0]] = Number(spec);
    }
  }

  const info: ServiceInfo = { host, ports };
  if (meta.tls) info.tls = meta.tls;
  if (meta.users) info.users = meta.users;
  return info;
}

interface DockerComposeOptions {
  projectName?: string;
  composeFile?: string;
}

class DockerComposeHelper {
  private projectName: string;
  private composeFile: string;
  private upPromises: Map<ServiceName, Promise<void>> = new Map();
  private composeStarted = false;

  constructor(options: DockerComposeOptions = {}) {
    this.projectName =
      options.projectName ||
      process.env.BUN_DOCKER_PROJECT_NAME ||
      process.env.COMPOSE_PROJECT_NAME ||
      "bun-test-services"; // Default project name for all test services

    this.composeFile =
      options.composeFile || process.env.BUN_DOCKER_COMPOSE_FILE || join(__dirname, "docker-compose.yml");

    // Verify the compose file exists
    const fs = require("fs");
    if (!fs.existsSync(this.composeFile)) {
      console.error(`Docker Compose file not found at: ${this.composeFile}`);
      console.error(`Current directory: ${process.cwd()}`);
      console.error(`__dirname: ${__dirname}`);
      throw new Error(`Docker Compose file not found: ${this.composeFile}`);
    }
  }

  private async exec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Only support docker compose v2
    const cmd = ["docker", "compose", "-p", this.projectName, "-f", this.composeFile, ...args];

    const proc = spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  async ensureDocker(): Promise<void> {
    // Check Docker is available
    const dockerCheck = spawn({
      cmd: ["docker", "version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await dockerCheck.exited;
    if (exitCode !== 0) {
      throw new Error("Docker is not available. Please ensure Docker is installed and running.");
    }

    // Check docker compose v2 is available
    const composeCheck = spawn({
      cmd: ["docker", "compose", "version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const composeExitCode = await composeCheck.exited;
    if (composeExitCode !== 0) {
      throw new Error("Docker Compose v2 is not available. Please ensure Docker Compose v2 is installed.");
    }
  }

  up(service: ServiceName): Promise<void> {
    // Share one in-flight promise per service so concurrent ensure() calls
    // (`Promise.all([ensure(a), ensure(b)])`, two describeWithContainer
    // blocks, or two coordinator clients) never race duplicate `compose up`
    // invocations. Settled promises are evicted rather than memoized: the
    // next request re-runs `up -d --wait`, which restarts the container and
    // waits for health again if it died in the meantime. In the coordinator
    // this promise lives for the whole shard, and serving a memoized "ready"
    // after mysql crashed mid-run is how tests end up dialing a dead port.
    let p = this.upPromises.get(service);
    if (p === undefined) {
      p = this.doUp(service);
      this.upPromises.set(service, p);
      const evict = () => this.upPromises.delete(service);
      p.then(evict, evict);
    }
    return p;
  }

  private async doUp(service: ServiceName): Promise<void> {
    // Pre-build the service (a no-op for image-only services) so build time
    // doesn't eat into the `up --wait` timeout below. CI pre-bakes everything
    // via buildServices(); this covers local dev where that wasn't run.
    const buildResult = await this.exec(["build", service]);
    if (buildResult.exitCode !== 0) {
      throw new Error(`Failed to build service ${service}: ${buildResult.stderr}`);
    }

    // If the container exists but died since the last ensure (host OOM kill,
    // server crash), record its exit status and last words before the `up`
    // below quietly restarts it, so shard logs explain mid-run outages
    // (exit 137 = SIGKILL, usually the OOM reaper).
    const stale = await this.exec(["ps", "-a", service]);
    if (/exited|dead|restarting/i.test(stale.stdout)) {
      const lastLogs = await this.exec(["logs", "--tail", "20", service]);
      console.error(
        `Service ${service} found dead before start; restarting it.\n--- ps ---\n${stale.stdout}--- last logs ---\n${lastLogs.stdout}${lastLogs.stderr}`,
      );
    }

    // Start the service and wait for it to be healthy.
    // --wait-timeout bounds how long `--wait` blocks for a health transition.
    // All services are expected to go healthy within a few seconds (mysql
    // images bake a pre-initialized data dir so first boot is just `exec
    // mysqld`); 180 is generous headroom so a slow host or a service whose
    // init regresses surfaces as a single diagnosable failure here rather than
    // cascading through every test file that asks for it.
    const { exitCode, stderr } = await this.exec(["up", "-d", "--wait", "--wait-timeout", "180", service]);

    if (exitCode !== 0) {
      const ps = await this.exec(["ps", "-a", service]);
      const logs = await this.exec(["logs", "--tail", "50", service]);
      throw new Error(
        `Failed to start service ${service}: ${stderr}\n` + `--- ps ---\n${ps.stdout}\n--- logs ---\n${logs.stdout}`,
      );
    }

    this.composeStarted = true;
  }

  async port(service: ServiceName, targetPort: number): Promise<number> {
    const { stdout, exitCode } = await this.exec(["port", service, targetPort.toString()]);

    if (exitCode !== 0) {
      throw new Error(`Failed to get port for ${service}:${targetPort}`);
    }

    const match = stdout.trim().match(/:(\d+)$/);
    if (!match) {
      throw new Error(`Invalid port output: ${stdout}`);
    }

    return parseInt(match[1], 10);
  }

  private get testHost(): string {
    return process.env.BUN_DOCKER_TEST_HOST || "127.0.0.1";
  }

  async waitForPort(port: number, timeout: number = 10000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const socket = new net.Socket();
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("error", reject);
          socket.connect(port, this.testHost);
        });
        return;
      } catch {
        // Wait 100ms before retrying
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Port ${port} did not become ready within ${timeout}ms`);
  }

  // Ask the shard's coordinator (test/docker/coordinator.ts, spawned by
  // scripts/runner.node.mjs) to start the service, and wait for its ready
  // message with the port mapping. The coordinator owns every `compose up`
  // for the shard, so concurrent processes can't race duplicate invocations
  // into the daemon. Resolves null when no coordinator is configured or the
  // socket is unreachable; the caller then runs compose directly (local dev,
  // or the coordinator died). A reply of ok=false is a real service failure
  // and is thrown rather than retried through the fallback.
  private ensureViaCoordinator(service: ServiceName): Promise<ServiceInfo | null> {
    const socketPath = process.env.BUN_DOCKER_COORDINATOR;
    if (!socketPath) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath);
      let buffer = "";
      let replied = false;
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(JSON.stringify({ type: "ensure", service }) + "\n");
      });
      socket.on("data", chunk => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1 || replied) return;
        replied = true;
        socket.end();
        try {
          const reply = JSON.parse(buffer.slice(0, newline));
          if (reply.ok) {
            resolve(reply.info);
          } else {
            reject(new Error(`Failed to start service ${service} (via coordinator): ${reply.error}`));
          }
        } catch {
          // Garbled reply: treat the coordinator as broken and fall back.
          resolve(null);
        }
      });
      socket.on("error", () => {
        if (!replied) resolve(null);
      });
      socket.on("close", () => {
        if (!replied) resolve(null);
      });
    });
  }

  async ensure(service: ServiceName): Promise<ServiceInfo> {
    const viaEnv = serviceFromEnv(service);
    if (viaEnv) return viaEnv;

    const viaCoordinator = await this.ensureViaCoordinator(service);
    if (viaCoordinator !== null) {
      return viaCoordinator;
    }

    try {
      await this.ensureDocker();
    } catch (error) {
      console.error(`Failed to ensure Docker is available: ${error}`);
      throw error;
    }

    try {
      await this.up(service);
    } catch (error) {
      console.error(`Failed to start service ${service}: ${error}`);
      throw error;
    }

    const meta = serviceMeta[service];
    const info: ServiceInfo = {
      host: this.testHost,
      ports: {},
    };
    for (const p of meta.ports) {
      info.ports[p] = await this.port(service, p);
    }
    if (meta.tls) info.tls = meta.tls;
    if (meta.users) info.users = meta.users;

    return info;
  }

  async envFor(service: ServiceName): Promise<Record<string, string>> {
    const info = await this.ensure(service);
    const env: Record<string, string> = {};

    switch (service) {
      case "postgres_plain":
      case "postgres_tls":
      case "postgres_auth":
        env.PGHOST = info.host;
        env.PGPORT = info.ports[5432].toString();
        env.PGUSER = "bun_sql_test";
        env.PGDATABASE = "bun_sql_test";

        if (info.tls) {
          env.PGSSLMODE = "require";
          env.PGSSLCERT = info.tls.cert!;
          env.PGSSLKEY = info.tls.key!;
        }
        break;

      case "mysql_plain":
      case "mysql_native_password":
      case "mysql_tls":
        env.MYSQL_HOST = info.host;
        env.MYSQL_PORT = info.ports[3306].toString();
        env.MYSQL_USER = "root";
        env.MYSQL_PASSWORD = service === "mysql_plain" ? "" : "bun";
        env.MYSQL_DATABASE = "bun_sql_test";

        if (info.tls) {
          env.MYSQL_SSL_CA = info.tls.ca!;
        }
        break;

      case "redis_plain":
      case "redis_unified":
        env.REDIS_HOST = info.host;
        env.REDIS_PORT = info.ports[6379].toString();
        env.REDIS_URL = `redis://${info.host}:${info.ports[6379]}`;

        if (info.ports[6380]) {
          env.REDIS_TLS_PORT = info.ports[6380].toString();
          env.REDIS_TLS_URL = `rediss://${info.host}:${info.ports[6380]}`;
        }

        if (info.socketPath) {
          env.REDIS_SOCKET = info.socketPath;
        }
        break;

      case "minio":
        env.S3_ENDPOINT = `http://${info.host}:${info.ports[9000]}`;
        env.S3_ACCESS_KEY_ID = "minioadmin";
        env.S3_SECRET_ACCESS_KEY = "minioadmin";
        env.AWS_ACCESS_KEY_ID = "minioadmin";
        env.AWS_SECRET_ACCESS_KEY = "minioadmin";
        env.AWS_ENDPOINT_URL_S3 = `http://${info.host}:${info.ports[9000]}`;
        break;

      case "autobahn":
        env.AUTOBAHN_URL = `ws://${info.host}:${info.ports[9002]}`;
        break;

      case "squid":
        env.HTTP_PROXY = `http://${info.host}:${info.ports[3128]}`;
        env.HTTPS_PROXY = `http://${info.host}:${info.ports[3128]}`;
        env.PROXY_URL = `http://${info.host}:${info.ports[3128]}`;
        break;
    }

    return env;
  }

  async down(): Promise<void> {
    if (process.env.BUN_KEEP_DOCKER === "1") {
      return;
    }
    if (!this.composeStarted) {
      return;
    }

    const { exitCode } = await this.exec(["down", "-v"]);
    if (exitCode !== 0) {
      console.warn("Failed to tear down Docker services");
    }

    this.upPromises.clear();
  }

  async waitTcp(host: string, port: number, timeout = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const socket = await Bun.connect({
          hostname: host,
          port,
        });
        socket.end();
        return;
      } catch {
        await Bun.sleep(500);
      }
    }

    throw new Error(`TCP connection to ${host}:${port} timed out`);
  }

  /**
   * Pull all Docker images explicitly - useful for CI
   */
  async pullImages(): Promise<void> {
    console.log("Pulling Docker images...");
    const { exitCode, stderr } = await this.exec(["pull", "--ignore-pull-failures"]);

    if (exitCode !== 0) {
      // Don't fail on pull errors since some services need building
      console.warn(`Warning during image pull: ${stderr}`);
    }
  }

  /**
   * Build all services that need building - useful for CI
   */
  async buildServices(): Promise<void> {
    // Bare `compose build` builds every service that has a `build:` section,
    // so there's no hardcoded list to keep in sync as services are converted.
    console.log("Building all services with a build section...");
    const { exitCode, stderr } = await this.exec(["build"]);
    if (exitCode !== 0) {
      throw new Error(`Failed to build services: ${stderr}`);
    }
  }

  /**
   * Prepare all images (pull and build) - useful for CI
   */
  async prepareImages(): Promise<void> {
    await this.pullImages();
    await this.buildServices();
  }
}

// Global instance
let globalHelper: DockerComposeHelper | null = null;

function getHelper(): DockerComposeHelper {
  if (!globalHelper) {
    globalHelper = new DockerComposeHelper();
  }
  return globalHelper;
}

// Exported functions
export async function ensureDocker(): Promise<void> {
  return getHelper().ensureDocker();
}

export async function ensure(service: ServiceName): Promise<ServiceInfo> {
  return getHelper().ensure(service);
}

export async function port(service: ServiceName, targetPort: number): Promise<number> {
  return getHelper().port(service, targetPort);
}

export async function envFor(service: ServiceName): Promise<Record<string, string>> {
  return getHelper().envFor(service);
}

export async function down(): Promise<void> {
  return getHelper().down();
}

export async function waitTcp(host: string, port: number, timeout?: number): Promise<void> {
  return getHelper().waitTcp(host, port, timeout);
}

export async function pullImages(): Promise<void> {
  return getHelper().pullImages();
}

export async function buildServices(): Promise<void> {
  return getHelper().buildServices();
}

export async function prepareImages(): Promise<void> {
  return getHelper().prepareImages();
}

// Higher-level wrappers for tests
export async function withPostgres(
  opts: { variant?: "plain" | "tls" | "auth" },
  fn: (info: ServiceInfo & { url: string }) => Promise<void>,
): Promise<void> {
  const variant = opts.variant || "plain";
  const serviceName = `postgres_${variant}` as ServiceName;
  const info = await ensure(serviceName);

  const user = variant === "auth" ? "bun_sql_test" : "postgres";
  const url = `postgres://${user}@${info.host}:${info.ports[5432]}/bun_sql_test`;

  try {
    await fn({ ...info, url });
  } finally {
    // Services persist - no teardown
  }
}

export async function withMySQL(
  opts: { variant?: "plain" | "native_password" | "tls" },
  fn: (info: ServiceInfo & { url: string }) => Promise<void>,
): Promise<void> {
  const variant = opts.variant || "plain";
  const serviceName = `mysql_${variant}` as ServiceName;
  const info = await ensure(serviceName);

  const password = variant === "plain" ? "" : ":bun";
  const url = `mysql://root${password}@${info.host}:${info.ports[3306]}/bun_sql_test`;

  try {
    await fn({ ...info, url });
  } finally {
    // Services persist - no teardown
  }
}

export async function withRedis(
  opts: { variant?: "plain" | "unified" },
  fn: (info: ServiceInfo & { url: string; tlsUrl?: string }) => Promise<void>,
): Promise<void> {
  const variant = opts.variant || "plain";
  const serviceName = `redis_${variant}` as ServiceName;
  const info = await ensure(serviceName);

  const url = `redis://${info.host}:${info.ports[6379]}`;
  const tlsUrl = info.ports[6380] ? `rediss://${info.host}:${info.ports[6380]}` : undefined;

  try {
    await fn({ ...info, url, tlsUrl });
  } finally {
    // Services persist - no teardown
  }
}

export async function withMinio(
  fn: (info: ServiceInfo & { endpoint: string; accessKeyId: string; secretAccessKey: string }) => Promise<void>,
): Promise<void> {
  const info = await ensure("minio");

  try {
    await fn({
      ...info,
      endpoint: `http://${info.host}:${info.ports[9000]}`,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    });
  } finally {
    // Services persist - no teardown
  }
}

export async function withAutobahn(fn: (info: ServiceInfo & { url: string }) => Promise<void>): Promise<void> {
  const info = await ensure("autobahn");

  try {
    await fn({
      ...info,
      url: `ws://${info.host}:${info.ports[9002]}`,
    });
  } finally {
    // Services persist - no teardown
  }
}

export async function withSquid(fn: (info: ServiceInfo & { proxyUrl: string }) => Promise<void>): Promise<void> {
  const info = await ensure("squid");

  try {
    await fn({
      ...info,
      proxyUrl: `http://${info.host}:${info.ports[3128]}`,
    });
  } finally {
    // Services persist - no teardown
  }
}
