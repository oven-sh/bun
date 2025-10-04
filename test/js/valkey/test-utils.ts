import { RedisClient, type SpawnOptions } from "bun";
import { afterAll, beforeAll, expect } from "bun:test";
import { bunEnv, dockerExe, isCI, randomPort, tempDirWithFiles } from "harness";
import path from "path";

import * as dockerCompose from "../../docker/index.ts";
import { UnixDomainSocketProxy } from "../../unix-domain-socket-proxy.ts";

const dockerCLI = dockerExe() as string;
export const isEnabled =
  !!dockerCLI &&
  (() => {
    try {
      const info = Bun.spawnSync({
        cmd: [dockerCLI, "info"],
        stdout: "pipe",
        stderr: "inherit",
        env: bunEnv,
        timeout: 5_000,
      });
      if (info.exitCode !== 0) return false;
      if (info.signalCode) return false;
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
  tls: {
    cert: Bun.file(path.join(import.meta.dir, "docker-unified", "server.crt")),
    key: Bun.file(path.join(import.meta.dir, "docker-unified", "server.key")),
    ca: Bun.file(path.join(import.meta.dir, "docker-unified", "server.crt")),
  },
  tlsPaths: {
    cert: path.join(import.meta.dir, "docker-unified", "server.crt"),
    key: path.join(import.meta.dir, "docker-unified", "server.key"),
    ca: path.join(import.meta.dir, "docker-unified", "server.crt"),
  },
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
let dockerComposeInfo: any = null;
let unixSocketProxy: UnixDomainSocketProxy | null = null;

/**
 * Start the Redis Docker container with TCP, TLS, and Unix socket support using docker-compose
 */
async function startContainer(): Promise<ContainerConfiguration> {
  if (dockerStarted) {
    return containerConfig as ContainerConfiguration;
  }

  try {
    // First, try to use docker-compose
    console.log("Attempting to use docker-compose for Redis...");
    const redisInfo = await dockerCompose.ensure("redis_unified");

    const port = redisInfo.ports[6379];
    const tlsPort = redisInfo.ports[6380];
    const containerName = "redis_unified"; // docker-compose service name

    // Create Unix domain socket proxy for Redis
    unixSocketProxy = await UnixDomainSocketProxy.create("Redis", redisInfo.host, port);

    // Update Redis connection info
    REDIS_PORT = port;
    REDIS_TLS_PORT = tlsPort;
    REDIS_HOST = redisInfo.host;
    REDIS_UNIX_SOCKET = unixSocketProxy.path; // Use the proxy socket
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
      useUnixSocket: true, // Now supported via proxy!
    };

    dockerStarted = true;
    dockerComposeInfo = redisInfo;

    console.log(`Redis container ready via docker-compose on ports ${port}:6379 and ${tlsPort}:6380`);
    return containerConfig;
  } catch (error) {
    console.error("Failed to start Redis via docker-compose:", error);
    throw new Error(`Docker Compose is required. Redis container failed to start via docker-compose: ${error}`);
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
export function createClient(
  connectionType: ConnectionType = ConnectionType.TCP,
  customOptions = {},
  dbId: number | undefined = undefined,
) {
  let url: string;
  const mkUrl = (baseUrl: string) => (dbId ? `${baseUrl}/${dbId}` : baseUrl);

  let options: any = {};
  context.id++;

  switch (connectionType) {
    case ConnectionType.TCP:
      url = mkUrl(DEFAULT_REDIS_URL);
      options = {
        ...DEFAULT_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.TLS:
      url = mkUrl(TLS_REDIS_URL);
      options = {
        ...TLS_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.UNIX:
      url = mkUrl(UNIX_REDIS_URL);
      options = {
        ...UNIX_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.AUTH:
      url = mkUrl(AUTH_REDIS_URL);
      options = {
        ...AUTH_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.READONLY:
      url = mkUrl(READONLY_REDIS_URL);
      options = {
        ...READONLY_REDIS_OPTIONS,
        ...customOptions,
      };
      break;
    case ConnectionType.WRITEONLY:
      url = mkUrl(WRITEONLY_REDIS_URL);
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
  restartServer: () => Promise<void>;
  __subscriberClientPool: RedisClient[];
  newSubscriberClient: (connectionType: ConnectionType) => Promise<RedisClient>;
  cleanupSubscribers: () => Promise<void>;
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
  restartServer: restartRedisContainer,
  __subscriberClientPool: [],
  newSubscriberClient: async function (connectionType: ConnectionType) {
    const client = createClient(connectionType);
    this.__subscriberClientPool.push(client);
    await client.connect();
    return client;
  },
  cleanupSubscribers: async function () {
    for (const client of this.__subscriberClientPool) {
      try {
        await client.unsubscribe();
      } catch {}

      if (client.connected) {
        client.close();
      }
    }

    this.__subscriberClientPool = [];
  },
};
export { context as ctx };

if (isEnabled) {
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
}

if (isEnabled) {
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
      context.redis.close();

      if (context.redisTLS) {
        context.redisTLS.close();
      }

      if (context.redisUnix) {
        context.redisUnix.close();
      }

      if (context.redisAuth) {
        context.redisAuth.close();
      }

      if (context.redisReadOnly) {
        context.redisReadOnly.close();
      }

      if (context.redisWriteOnly) {
        context.redisWriteOnly.close();
      }

      // Clean up Unix socket proxy if it exists
      if (unixSocketProxy) {
        unixSocketProxy.stop();
      }
    } catch (err) {
      console.error("Error during test cleanup:", err);
    }
  });
}

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

/**
 * Get the name of the running Redis container
 */
async function getRedisContainerName(): Promise<string> {
  if (!dockerCLI) {
    throw new Error("Docker CLI not available");
  }

  // If using docker-compose
  if (dockerComposeInfo) {
    const projectName = process.env.COMPOSE_PROJECT_NAME || "bun-test-services";
    return `${projectName}-redis_unified-1`;
  }

  // Fallback to old method
  const listProcess = Bun.spawn({
    cmd: [dockerCLI, "ps", "--filter", "name=valkey-unified-test", "--format", "{{.Names}}"],
    stdout: "pipe",
    env: bunEnv,
  });

  const containerName = (await new Response(listProcess.stdout).text()).trim();
  if (!containerName) {
    throw new Error("No Redis container found");
  }

  return containerName;
}

/**
 * Restart the Redis container to simulate connection drop
 *
 * Restarts the container identified by the test harness and waits briefly for it
 * to come back online (approximately 2 seconds). Use this to simulate a server
 * restart or connection drop during tests.
 *
 * @returns A promise that resolves when the restart and short wait complete.
 * @throws If the Docker restart command exits with a non-zero code; the error
 *         message includes the container's stderr output.
 */
export async function restartRedisContainer(): Promise<void> {
  // If using docker-compose, get the actual container name
  if (dockerComposeInfo) {
    const projectName = process.env.COMPOSE_PROJECT_NAME || "bun-test-services";
    const containerName = `${projectName}-redis_unified-1`;
    console.log(`Restarting Redis container: ${containerName}`);

    // Use docker restart to preserve data
    const restartProcess = Bun.spawn({
      cmd: [dockerCLI, "restart", containerName],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const exitCode = await restartProcess.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(restartProcess.stderr).text();
      throw new Error(`Failed to restart container: ${stderr}`);
    }

    // Wait for Redis to be ready
    console.log("Waiting for Redis to be ready after restart...");

    let retries = 30;
    while (retries > 0) {
      try {
        const pingProcess = Bun.spawn({
          cmd: [dockerCLI, "exec", containerName, "redis-cli", "ping"],
          stdout: "pipe",
          stderr: "pipe",
        });
        const pingOutput = await new Response(pingProcess.stdout).text();
        if (pingOutput.trim() === "PONG") {
          console.log(`Redis container restarted and ready: ${containerName}`);
          break;
        }
      } catch {}
      retries--;
      if (retries > 0) {
        await delay(100);
      }
    }

    if (retries === 0) {
      throw new Error("Redis failed to become ready after restart");
    }
  } else {
    // Fallback to old method
    const containerName = await getRedisContainerName();
    console.log(`Restarting Redis container: ${containerName}`);

    // Use docker restart to preserve data
    const restartProcess = Bun.spawn({
      cmd: [dockerCLI, "restart", containerName],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const exitCode = await restartProcess.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(restartProcess.stderr).text();
      throw new Error(`Failed to restart container: ${stderr}`);
    }
  }
}

/**
 * @returns true or false with approximately equal probability
 */
export function randomCoinFlip(): boolean {
  return Math.floor(Math.random() * 2) == 0;
}

/**
 * Utility for creating a counter that can be awaited until it reaches a target value.
 */
export function awaitableCounter(timeoutMs: number = 1000) {
  let activeResolvers: [number, NodeJS.Timeout, (value: number) => void][] = [];
  let currentCount = 0;

  const incrementBy = (count: number) => {
    currentCount += count;

    for (const [value, alarm, resolve] of activeResolvers) {
      alarm.close();

      if (currentCount >= value) {
        resolve(currentCount);
      }
    }

    // Remove resolved promises
    const remaining: typeof activeResolvers = [];
    for (const [value, alarm, resolve] of activeResolvers) {
      if (currentCount >= value) {
        alarm.close();
        resolve(currentCount);
      } else {
        remaining.push([value, alarm, resolve]);
      }
    }
    activeResolvers = remaining;
  };

  return {
    incrementBy: incrementBy,
    increment: incrementBy.bind(null, 1),
    count: () => currentCount,

    untilValue: (value: number) =>
      new Promise<number>((resolve, reject) => {
        if (currentCount >= value) {
          resolve(currentCount);
          return;
        }

        const alarm = setTimeout(() => {
          reject(new Error(`Timeout waiting for counter to reach ${value}, current is ${currentCount}.`));
        }, timeoutMs);

        activeResolvers.push([value, alarm, resolve]);
      }),
  };
}
