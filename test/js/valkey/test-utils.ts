import { RedisClient, type SpawnOptions } from "bun";
import { afterAll, beforeAll, expect } from "bun:test";
import { bunEnv, isCI, randomPort, tempDirWithFiles } from "harness";
import path from "path";

const dockerCLI = Bun.which("docker") as string;
export const isEnabled =
  !!dockerCLI &&
  (() => {
    try {
      const info = Bun.spawnSync({
        cmd: [dockerCLI, "info"],
        stdout: "pipe",
        stderr: "inherit",
        env: bunEnv,
      });
      return info.stdout.toString().indexOf("Server Version:") !== -1;
    } catch (error) {
      return false;
    }
  })();

/**
 * Test utilities for Valkey/Redis tests
 *
 * Available direct methods (avoid using .send() for these):
 * - get(key): Get value of a key
 * - set(key, value): Set value of a key
 * - del(key): Delete a key
 * - incr(key): Increment value by 1
 * - decr(key): Decrement value by 1
 * - exists(key): Check if key exists
 * - expire(key, seconds): Set key expiration in seconds
 * - ttl(key): Get time-to-live for a key
 * - hmset(key, fields): Set multiple hash fields
 * - hmget(key, fields): Get multiple hash field values
 * - sismember(key, member): Check if member is in set
 * - sadd(key, member): Add member to set
 * - srem(key, member): Remove member from set
 * - smembers(key): Get all members in a set
 * - srandmember(key): Get random member from set
 * - spop(key): Remove and return random member from set
 * - hincrby(key, field, value): Increment hash field by integer
 * - hincrbyfloat(key, field, value): Increment hash field by float
 */

// Redis connection information
let REDIS_TEMP_DIR = tempDirWithFiles("redis-tmp", {
  "a.txt": "a",
});
let REDIS_PORT = randomPort();
let REDIS_TLS_PORT = randomPort();
let REDIS_HOST = "0.0.0.0";
let REDIS_UNIX_SOCKET = REDIS_TEMP_DIR + "/redis.sock";

// Connection types
export enum ConnectionType {
  TCP = "tcp",
  TLS = "tls",
  UNIX = "unix",
  AUTH = "auth",
  READONLY = "readonly",
  WRITEONLY = "writeonly",
}

// Default test options
export const DEFAULT_REDIS_OPTIONS = {
  username: "default",
  password: "",
  db: 0,
  tls: false,
};

export const TLS_REDIS_OPTIONS = {
  ...DEFAULT_REDIS_OPTIONS,
  db: 1,
  tls: true,
  tls_cert_file: path.join(import.meta.dir, "docker-unified", "server.crt"),
  tls_key_file: path.join(import.meta.dir, "docker-unified", "server.key"),
  tls_ca_file: path.join(import.meta.dir, "docker-unified", "server.crt"),
};

export const UNIX_REDIS_OPTIONS = {
  ...DEFAULT_REDIS_OPTIONS,
  db: 2,
};

export const AUTH_REDIS_OPTIONS = {
  ...DEFAULT_REDIS_OPTIONS,
  db: 3,
  username: "testuser",
  password: "test123",
};

export const READONLY_REDIS_OPTIONS = {
  ...DEFAULT_REDIS_OPTIONS,
  db: 4,
  username: "readonly",
  password: "readonly",
};

export const WRITEONLY_REDIS_OPTIONS = {
  ...DEFAULT_REDIS_OPTIONS,
  db: 5,
  username: "writeonly",
  password: "writeonly",
};

// Default test URLs - will be updated if Docker containers are started
export let DEFAULT_REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
export let TLS_REDIS_URL = `rediss://${REDIS_HOST}:${REDIS_TLS_PORT}`;
export let UNIX_REDIS_URL = `redis+unix://${REDIS_UNIX_SOCKET}`;
export let AUTH_REDIS_URL = `redis://testuser:test123@${REDIS_HOST}:${REDIS_PORT}`;
export let READONLY_REDIS_URL = `redis://readonly:readonly@${REDIS_HOST}:${REDIS_PORT}`;
export let WRITEONLY_REDIS_URL = `redis://writeonly:writeonly@${REDIS_HOST}:${REDIS_PORT}`;

// Random key prefix to avoid collisions during testing
export const TEST_KEY_PREFIX = `bun-test-${Date.now()}-`;

/**
 * Container configuration interface
 */
interface ContainerConfiguration {
  port?: number;
  tlsPort?: number;
  containerName: string;
  useUnixSocket: boolean;
}

// Shared container configuration
let containerConfig: ContainerConfiguration | null = null;
let dockerStarted = false;

/**
 * Start the Redis Docker container with TCP, TLS, and Unix socket support
 */
async function startContainer(): Promise<ContainerConfiguration> {
  if (dockerStarted) {
    return containerConfig as ContainerConfiguration;
  }

  try {
    // Check for any existing running valkey-unified-test containers
    const checkRunning = Bun.spawn({
      cmd: [
        dockerCLI,
        "ps",
        "--filter",
        "name=valkey-unified-test",
        "--filter",
        "status=running",
        "--format",
        "{{json .}}",
      ],
      stdout: "pipe",
    });

    let runningContainers = await new Response(checkRunning.stdout).text();
    runningContainers = runningContainers.trim();

    console.log(`Running containers: ${runningContainers}`);

    if (runningContainers.trim()) {
      // Parse the JSON container information
      const containerInfo = JSON.parse(runningContainers);
      const containerName = containerInfo.Names;

      // Parse port mappings from the Ports field
      const portsString = containerInfo.Ports;
      const portMappings = portsString.split(", ");

      let port = 0;
      let tlsPort = 0;

      console.log(portMappings);

      // Extract port mappings for Redis ports 6379 and 6380
      for (const mapping of portMappings) {
        if (mapping.includes("->6379/tcp")) {
          const match = mapping.split("->")[0].split(":")[1];
          if (match) {
            port = parseInt(match);
          }
        } else if (mapping.includes("->6380/tcp")) {
          const match = mapping.split("->")[0].split(":")[1];
          if (match) {
            tlsPort = parseInt(match);
          }
        }
      }

      if (port && tlsPort) {
        console.log(`Reusing existing container ${containerName} on ports ${port}:6379 and ${tlsPort}:6380`);

        // Update Redis connection info
        REDIS_PORT = port;
        REDIS_TLS_PORT = tlsPort;
        DEFAULT_REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
        TLS_REDIS_URL = `rediss://${REDIS_HOST}:${REDIS_TLS_PORT}`;
        UNIX_REDIS_URL = `redis+unix:${REDIS_UNIX_SOCKET}`;
        AUTH_REDIS_URL = `redis://testuser:test123@${REDIS_HOST}:${REDIS_PORT}`;
        READONLY_REDIS_URL = `redis://readonly:readonly@${REDIS_HOST}:${REDIS_PORT}`;
        WRITEONLY_REDIS_URL = `redis://writeonly:writeonly@${REDIS_HOST}:${REDIS_PORT}`;

        containerConfig = {
          port,
          tlsPort,
          containerName,
          useUnixSocket: true,
        };

        dockerStarted = true;
        return containerConfig;
      }
    }

    // No suitable running container found, create a new one
    console.log("Building unified Redis Docker image...");
    const dockerfilePath = path.join(import.meta.dir, "docker-unified", "Dockerfile");
    await Bun.spawn(
      [dockerCLI, "build", "--pull", "--rm", "-f", dockerfilePath, "-t", "bun-valkey-unified-test", "."],
      {
        cwd: path.join(import.meta.dir, "docker-unified"),
        stdio: ["inherit", "inherit", "inherit"],
      },
    ).exited;

    const port = randomPort();
    const tlsPort = randomPort();

    // Create container name with unique identifier to avoid conflicts in CI
    const containerName = `valkey-unified-test-bun-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Check if container exists and remove it
    try {
      const containerCheck = Bun.spawn({
        cmd: [dockerCLI, "ps", "-a", "--filter", `name=${containerName}`, "--format", "{{.ID}}"],
        stdout: "pipe",
      });

      const containerId = await new Response(containerCheck.stdout).text();
      if (containerId.trim()) {
        console.log(`Removing existing container ${containerName}`);
        await Bun.spawn([dockerCLI, "rm", "-f", containerName]).exited;
      }
    } catch (error) {
      // Container might not exist, ignore error
    }

    // Update Redis connection info
    REDIS_PORT = port;
    REDIS_TLS_PORT = tlsPort;
    DEFAULT_REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    TLS_REDIS_URL = `rediss://${REDIS_HOST}:${REDIS_TLS_PORT}`;
    UNIX_REDIS_URL = `redis+unix://${REDIS_UNIX_SOCKET}`;
    AUTH_REDIS_URL = `redis://testuser:test123@${REDIS_HOST}:${REDIS_PORT}`;
    READONLY_REDIS_URL = `redis://readonly:readonly@${REDIS_HOST}:${REDIS_PORT}`;
    WRITEONLY_REDIS_URL = `redis://writeonly:writeonly@${REDIS_HOST}:${REDIS_PORT}`;

    containerConfig = {
      port,
      tlsPort,
      containerName,
      useUnixSocket: true,
    };

    // Start the unified container with TCP, TLS, and Unix socket
    console.log(`Starting Redis container ${containerName} on ports ${port}:6379 and ${tlsPort}:6380...`);

    // Function to try starting container with port retries
    async function tryStartContainer(attempt = 1, maxAttempts = 3) {
      const currentPort = attempt === 1 ? port : randomPort();
      const currentTlsPort = attempt === 1 ? tlsPort : randomPort();
      
      console.log(`Attempt ${attempt}: Using ports ${currentPort}:6379 and ${currentTlsPort}:6380...`);
      
      const startProcess = Bun.spawn({
        cmd: [
          dockerCLI,
          "run",
          "-d",
          "--name",
          containerName,
          "-p",
          `${currentPort}:6379`,
          "-p",
          `${currentTlsPort}:6380`,
          // TODO: unix domain socket has permission errors in CI.
          // "-v",
          // `${REDIS_TEMP_DIR}:/tmp`,
          "--health-cmd",
          "redis-cli ping || exit 1",
          "--health-interval",
          "2s",
          "--health-timeout",
          "1s",
          "--health-retries",
          "5",
          "bun-valkey-unified-test",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      const containerID = await new Response(startProcess.stdout).text();
      const startError = await new Response(startProcess.stderr).text();
      const startExitCode = await startProcess.exited;

      if (startExitCode === 0 && containerID.trim()) {
        // Update the ports if we used different ones on a retry
        if (attempt > 1) {
          REDIS_PORT = currentPort;
          REDIS_TLS_PORT = currentTlsPort;
          DEFAULT_REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
          TLS_REDIS_URL = `rediss://${REDIS_HOST}:${REDIS_TLS_PORT}`;
          UNIX_REDIS_URL = `redis+unix://${REDIS_UNIX_SOCKET}`;
          AUTH_REDIS_URL = `redis://testuser:test123@${REDIS_HOST}:${REDIS_PORT}`;
          READONLY_REDIS_URL = `redis://readonly:readonly@${REDIS_HOST}:${REDIS_PORT}`;
          WRITEONLY_REDIS_URL = `redis://writeonly:writeonly@${REDIS_HOST}:${REDIS_PORT}`;
          
          containerConfig = {
            port: currentPort,
            tlsPort: currentTlsPort,
            containerName,
            useUnixSocket: true,
          };
        }
        return { containerID, success: true };
      }
      
      // If the error is related to port already in use, try again with different ports
      if (startError.includes("address already in use") && attempt < maxAttempts) {
        console.log(`Port conflict detected. Retrying with different ports...`);
        // Remove failed container if it was created
        if (containerID.trim()) {
          await Bun.spawn([dockerCLI, "rm", "-f", containerID.trim()]).exited;
        }
        return tryStartContainer(attempt + 1, maxAttempts);
      }
      
      console.error(`Failed to start container. Exit code: ${startExitCode}, Error: ${startError}`);
      throw new Error(`Failed to start Redis container: ${startError || "unknown error"}`);
    }
    
    const { containerID } = await tryStartContainer();

    console.log(`Container started with ID: ${containerID.trim()}`);

    // Wait a moment for container to initialize
    console.log("Waiting for container to initialize...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if Redis is responding inside the container
    const redisPingProcess = Bun.spawn({
      cmd: [dockerCLI, "exec", containerName, "redis-cli", "ping"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const redisPingOutput = await new Response(redisPingProcess.stdout).text();
    console.log(`Redis inside container responds: ${redisPingOutput.trim()}`);
    redisPingProcess.kill?.();

    // Also try to get Redis info to ensure it's configured properly
    const redisInfoProcess = Bun.spawn({
      cmd: [dockerCLI, "exec", containerName, "redis-cli", "info", "server"],
      stdout: "pipe",
    });

    const redisInfo = await new Response(redisInfoProcess.stdout).text();
    console.log(`Redis server info: Redis version ${redisInfo.match(/redis_version:(.*)/)?.[1]?.trim() || "unknown"}`);
    redisInfoProcess.kill?.();

    // Check if the container is actually running
    const containerRunning = Bun.spawn({
      cmd: [dockerCLI, "ps", "--filter", `name=${containerName}`, "--format", "{{.ID}}"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const runningStatus = await new Response(containerRunning.stdout).text();
    containerRunning.kill?.();

    if (!runningStatus.trim()) {
      console.error(`Container ${containerName} failed to start properly`);

      // Get logs to see what happened
      const logs = Bun.spawn({
        cmd: [dockerCLI, "logs", containerName],
        stdout: "pipe",
        stderr: "pipe",
      });

      const logOutput = await new Response(logs.stdout).text();
      const errOutput = await new Response(logs.stderr).text();

      console.log(`Container logs:\n${logOutput}\n${errOutput}`);

      // Check container status to get more details
      const inspectProcess = Bun.spawn({
        cmd: [dockerCLI, "inspect", containerName],
        stdout: "pipe",
      });

      const inspectOutput = await new Response(inspectProcess.stdout).text();
      console.log(`Container inspection:\n${inspectOutput}`);

      inspectProcess.kill?.();
      throw new Error(`Redis container failed to start - check logs for details`);
    }

    console.log(`Container ${containerName} is running, waiting for Redis services...`);

    dockerStarted = true;
    return containerConfig;
  } catch (error) {
    console.error("Error starting Redis container:", error);
    throw error;
  }
}

let dockerSetupPromise: Promise<ContainerConfiguration>;
/**
 * Set up Docker container for all connection types
 * This will be called once before any tests run
 */
export async function setupDockerContainer() {
  if (!dockerStarted) {
    try {
      containerConfig = await (dockerSetupPromise ??= startContainer());

      return true;
    } catch (error) {
      console.error("Failed to start Redis container:", error);
      return false;
    }
  }
  return dockerStarted;
}

/**
 * Generate a unique test key to avoid collisions in Redis data
 */
export function testKey(name: string): string {
  return `${context.id}:${TEST_KEY_PREFIX}${name}`;
}

// Import needed functions from Bun
import { tmpdir } from "os";

/**
 * Create a new client with specific connection type
 */
export function createClient(connectionType: ConnectionType = ConnectionType.TCP, customOptions = {}) {
  let url: string;
  let options: any = {};
  context.id++;

  switch (connectionType) {
    case ConnectionType.TCP:
      url = DEFAULT_REDIS_URL;
      options = {
        ...DEFAULT_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.TLS:
      url = TLS_REDIS_URL;
      options = {
        ...TLS_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.UNIX:
      url = UNIX_REDIS_URL;
      options = {
        ...UNIX_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.AUTH:
      url = AUTH_REDIS_URL;
      options = {
        ...AUTH_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.READONLY:
      url = READONLY_REDIS_URL;
      options = {
        ...READONLY_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.WRITEONLY:
      url = WRITEONLY_REDIS_URL;
      options = {
        ...WRITEONLY_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    default:
      throw new Error(`Unknown connection type: ${connectionType}`);
  }

  // Using Function constructor to avoid static analysis issues
  return new RedisClient(url, options);
}

/**
 * Wait for the client to initialize by sending a dummy command
 */
export async function initializeClient(client: any): Promise<boolean> {
  try {
    await client.set(testKey("__init__"), "initializing");

    return true;
  } catch (err) {
    console.warn("Failed to initialize Redis client:", err);
    return false;
  }
}

/**
 * Testing context with shared clients and utilities
 */
export interface TestContext {
  redis: RedisClient;
  initialized: boolean;
  keyPrefix: string;
  generateKey: (name: string) => string;
  // Optional clients for various connection types
  redisTLS?: RedisClient;
  redisUnix?: RedisClient;
  redisAuth?: RedisClient;
  redisReadOnly?: RedisClient;
  redisWriteOnly?: RedisClient;
  id: number;
}

// Create a singleton promise for Docker initialization
let dockerInitPromise: Promise<boolean> | null = null;

/**
 * Setup shared test context for test suites
 */
let id = Math.trunc(Math.random() * 1000000);
// Initialize test context with TCP client by d efault
export const context: TestContext = {
  redis: undefined,
  initialized: false,
  keyPrefix: TEST_KEY_PREFIX,
  generateKey: testKey,
  redisTLS: undefined,
  redisUnix: undefined,
  redisAuth: undefined,
  redisReadOnly: undefined,
  redisWriteOnly: undefined,
  id,
};
export { context as ctx };

if (isEnabled)
  beforeAll(async () => {
    // Initialize Docker container once for all tests
    if (!dockerInitPromise) {
      dockerInitPromise = setupDockerContainer();
    }

    // Wait for Docker to initialize
    await dockerInitPromise;
    context.redis = createClient(ConnectionType.TCP);
    context.redisTLS = createClient(ConnectionType.TLS);
    context.redisUnix = createClient(ConnectionType.UNIX);
    context.redisAuth = createClient(ConnectionType.AUTH);
    context.redisReadOnly = createClient(ConnectionType.READONLY);
    context.redisWriteOnly = createClient(ConnectionType.WRITEONLY);

    // Initialize the standard TCP client
    context.initialized = await initializeClient(context.redis);

    // // Initialize all other clients that were requested
    // if (context.redisTLS) {
    //   try {
    //     await initializeClient(context.redisTLS);
    //   } catch (err) {
    //     console.warn("TLS client initialization failed - TLS tests may be skipped");
    //   }
    // }

    // if (context.redisUnix) {
    //   try {
    //     await initializeClient(context.redisUnix);
    //   } catch (err) {
    //     console.warn("Unix socket client initialization failed - Unix socket tests may be skipped");
    //   }
    // }

    // if (context.redisAuth) {
    //   try {
    //     await initializeClient(context.redisAuth);
    //   } catch (err) {
    //     console.warn("Auth client initialization failed - Auth tests may be skipped");
    //   }
    // }

    // if (context.redisReadOnly) {
    //   try {
    //     // For read-only we just check connection, not write
    //     await context.redisReadOnly.send("PING", []);
    //     console.log("Read-only client initialized");
    //   } catch (err) {
    //     console.warn("Read-only client initialization failed - Read-only tests may be skipped");
    //   }
    // }

    // if (context.redisWriteOnly) {
    //   try {
    //     await initializeClient(context.redisWriteOnly);
    //   } catch (err) {
    //     console.warn("Write-only client initialization failed - Write-only tests may be skipped");
    //   }
    // }

    // if (!context.initialized) {
    //   console.warn("Test initialization failed - tests may be skipped");
    // }
  });

if (isEnabled)
  afterAll(async () => {
    console.log("Cleaning up Redis container");
    if (!context.redis?.connected) {
      return;
    }

    try {
      // Clean up Redis keys created during tests
      const keys = await context.redis.send("KEYS", [`${TEST_KEY_PREFIX}*`]);
      if (Array.isArray(keys) && keys.length > 0) {
        // Using del command directly when available
        if (keys.length === 1) {
          await context.redis.del(keys[0]);
        } else {
          await context.redis.send("DEL", keys);
        }
      }

      // Disconnect all clients
      await context.redis.close();

      if (context.redisTLS) {
        await context.redisTLS.close();
      }

      if (context.redisUnix) {
        await context.redisUnix.close();
      }

      if (context.redisAuth) {
        await context.redisAuth.close();
      }

      if (context.redisReadOnly) {
        await context.redisReadOnly.close();
      }

      if (context.redisWriteOnly) {
        await context.redisWriteOnly.close();
      }
    } catch (err) {
      console.error("Error during test cleanup:", err);
    }
  });

if (!isEnabled) {
  console.warn("Redis is not enabled, skipping tests");
}

/**
 * Verify that a value is of a specific type
 */
export function expectType<T>(
  value: any,
  expectedType: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function",
): asserts value is T {
  expect(value).toBeTypeOf(expectedType);
}

/**
 * Wait for a specified amount of time
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function until it succeeds or times out
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    timeout?: number;
    predicate?: (result: T) => boolean;
  } = {},
): Promise<T> {
  const { maxAttempts = 5, delay: delayMs = 100, timeout = 5000, predicate = r => !!r } = options;

  const startTime = Date.now();
  let attempts = 0;

  while (attempts < maxAttempts && Date.now() - startTime < timeout) {
    attempts++;
    try {
      const result = await fn();
      if (predicate(result)) {
        return result;
      }
    } catch (e) {
      if (attempts >= maxAttempts) throw e;
    }

    if (attempts < maxAttempts) {
      await delay(delayMs);
    }
  }

  throw new Error(`Retry failed after ${attempts} attempts (${Date.now() - startTime}ms)`);
}
