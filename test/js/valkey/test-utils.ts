import { afterAll, beforeAll, expect } from "bun:test";
import { redis, RedisClient } from "bun";
import { $ } from "bun";
import { bunExe, isCI, withoutAggressiveGC, isLinux, tempDirWithFiles } from "harness";
import path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import net from "net";

const execAsync = promisify(exec);
const dockerCLI = Bun.which("docker") as string;

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
let REDIS_PORT = 6379;
let REDIS_TLS_PORT = 6380;
let REDIS_HOST = "localhost";
let REDIS_UNIX_SOCKET = "/tmp/redis.sock";

// Connection types
export enum ConnectionType {
  TCP = "tcp",
  TLS = "tls",
  UNIX = "unix",
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
  tls: true,
  tls_cert_file: path.join(import.meta.dir, "docker-tls", "server.crt"),
  tls_key_file: path.join(import.meta.dir, "docker-tls", "server.key"),
  tls_ca_file: path.join(import.meta.dir, "docker-tls", "server.crt"),
};

// Default test URLs - will be updated if Docker containers are started
export let DEFAULT_REDIS_URL = process.env.TEST_REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`;
export let TLS_REDIS_URL = process.env.TEST_REDIS_TLS_URL || `rediss://${REDIS_HOST}:${REDIS_TLS_PORT}`;
export let UNIX_REDIS_URL = process.env.TEST_REDIS_UNIX_URL || `redis+unix://${REDIS_UNIX_SOCKET}`;

// Random key prefix to avoid collisions during testing
export const TEST_KEY_PREFIX = `bun-test-${Date.now()}-`;

/**
 * Find a random available port
 */
async function findRandomPort() {
  return new Promise<number>((resolve, reject) => {
    // Create a server to listen on a random port
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Wait for Redis server to be ready
 */
async function waitForRedis(connectionType: ConnectionType, config: { port?: number, tlsPort?: number }) {
  const { port, tlsPort } = config;
  let url: string;
  let options: any = { connect_timeout: 1000 };
  
  switch (connectionType) {
    case ConnectionType.TCP:
      if (!port) throw new Error("Port required for TCP connection");
      url = `redis://localhost:${port}`;
      break;
    case ConnectionType.TLS:
      if (!tlsPort) throw new Error("TLS port required for TLS connection");
      url = `rediss://localhost:${tlsPort}`;
      options = {
        ...options,
        ...TLS_REDIS_OPTIONS
      };
      break;
    case ConnectionType.UNIX:
      url = `redis+unix://${REDIS_UNIX_SOCKET}`;
      break;
    default:
      throw new Error(`Unknown connection type: ${connectionType}`);
  }
  
  for (let i = 0; i < 10; i++) {
    try {
      const client = new RedisClient(url, options);
      await client.send("PING", []);
      await client.disconnect();
      console.log(`Redis (${connectionType}) is ready!`);
      return true;
    } catch (error) {
      console.log(`Waiting for Redis (${connectionType})... (${i + 1}/10)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Redis (${connectionType}) failed to start`);
}

/**
 * Container configuration interface
 */
interface ContainerConfiguration {
  port?: number;
  tlsPort?: number;
  containerName: string;
  useUnixSocket: boolean;
}

/**
 * Start a Redis Docker container
 */
async function startContainers(): Promise<ContainerConfiguration> {
  try {
    // Build the regular Redis Docker image
    console.log("Building Redis Docker image...");
    const dockerfilePath = path.join(import.meta.dir, "docker", "Dockerfile");
    await execAsync(`${dockerCLI} build --pull --rm -f "${dockerfilePath}" -t bun-valkey-test .`, {
      cwd: path.join(import.meta.dir, "docker"),
    });
    
    // Build the TLS Redis Docker image
    console.log("Building Redis TLS Docker image...");
    const tlsDockerfilePath = path.join(import.meta.dir, "docker-tls", "Dockerfile");
    await execAsync(`${dockerCLI} build --pull --rm -f "${tlsDockerfilePath}" -t bun-valkey-tls-test .`, {
      cwd: path.join(import.meta.dir, "docker-tls"),
    });
    
    // Get random ports
    const port = await findRandomPort();
    const tlsPort = await findRandomPort();
    
    // Create unique container name
    const containerName = `valkey-test-${port}`;
    const tlsContainerName = `valkey-tls-test-${tlsPort}`;
    
    // Check if containers exist and remove them
    try {
      await execAsync(`${dockerCLI} rm -f ${containerName} ${tlsContainerName}`);
    } catch (error) {
      // Containers might not exist, ignore error
    }

    // Start the containers
    // For the non-TLS container
    await execAsync(`${dockerCLI} run -d --name ${containerName} -p ${port}:6379 bun-valkey-test`);

    // For the TLS container with Unix socket support
    await execAsync(`${dockerCLI} run -d --name ${tlsContainerName} -p ${tlsPort}:6380 -v /tmp:/tmp bun-valkey-tls-test`);

    // Wait for Redis to be ready
    await waitForRedis(ConnectionType.TCP, { port });
    await waitForRedis(ConnectionType.TLS, { tlsPort });
    
    // Wait a bit more for the Unix socket to be available 
    await new Promise(resolve => setTimeout(resolve, 2000));
    await waitForRedis(ConnectionType.UNIX, {});
    
    return {
      port,
      tlsPort,
      containerName: `${containerName} ${tlsContainerName}`,
      useUnixSocket: true
    };
  } catch (error) {
    console.error("Error starting Redis containers:", error);
    throw error;
  }
}

/**
 * Check if Docker is available and running
 */
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

// Container configuration that will be updated when Docker is running
let containerConfig: ContainerConfiguration | null = null;

/**
 * Set up Docker containers for all connection types
 */
export async function setupDockerContainers() {
  if (isDockerEnabled()) {
    try {
      containerConfig = await startContainers();
      
      // Update Redis connection info
      if (containerConfig.port) {
        REDIS_PORT = containerConfig.port;
        DEFAULT_REDIS_URL = `redis://localhost:${REDIS_PORT}`;
        console.log(`Redis TCP container started on port ${REDIS_PORT}`);
      }
      
      if (containerConfig.tlsPort) {
        REDIS_TLS_PORT = containerConfig.tlsPort;
        TLS_REDIS_URL = `rediss://localhost:${REDIS_TLS_PORT}`;
        console.log(`Redis TLS container started on port ${REDIS_TLS_PORT}`);
      }
      
      if (containerConfig.useUnixSocket) {
        console.log(`Redis Unix socket available at ${REDIS_UNIX_SOCKET}`);
      }
      
      // Register cleanup handler
      process.on('exit', async () => {
        await cleanupDockerContainers();
      });
      
      return true;
    } catch (error) {
      console.error("Failed to start Redis containers:", error);
      return false;
    }
  }
  return false;
}

/**
 * Clean up all Docker containers
 */
export async function cleanupDockerContainers() {
  if (containerConfig) {
    try {
      // containerName will be a space-separated list of container names
      const containerNames = containerConfig.containerName.split(' ');
      for (const name of containerNames) {
        await execAsync(`${dockerCLI} stop -t 0 ${name}`);
        await execAsync(`${dockerCLI} rm -f ${name}`);
        console.log(`Removed Redis container ${name}`);
      }
    } catch (error) {
      console.error("Error cleaning up Redis containers:", error);
    }
  }
}

/**
 * Generate a unique test key to avoid collisions in Redis data
 */
export function testKey(name: string): string {
  return `${TEST_KEY_PREFIX}${name}`;
}

/**
 * Create a new client with specific connection type
 */
export function createClient(connectionType: ConnectionType = ConnectionType.TCP, customOptions = {}) {
  switch (connectionType) {
    case ConnectionType.TCP:
      return new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        ...customOptions,
      });
    case ConnectionType.TLS:
      return new RedisClient(TLS_REDIS_URL, {
        ...TLS_REDIS_OPTIONS,
        ...customOptions,
      });
    case ConnectionType.UNIX:
      return new RedisClient(UNIX_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        ...customOptions,
      });
    default:
      throw new Error(`Unknown connection type: ${connectionType}`);
  }
}

/**
 * Wait for the client to initialize by sending a dummy command
 */
export async function initializeClient(client: RedisClient): Promise<boolean> {
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
}

/**
 * Setup shared test context for test suites
 */
export function setupTestContext(connectionTypes: ConnectionType[] = [ConnectionType.TCP]): TestContext {
  const context: TestContext = {
    redis: createClient(ConnectionType.TCP),
    initialized: false,
    keyPrefix: TEST_KEY_PREFIX,
    generateKey: testKey,
  };

  // Create additional clients if requested
  if (connectionTypes.includes(ConnectionType.TLS)) {
    context.redisTLS = createClient(ConnectionType.TLS);
  }
  
  if (connectionTypes.includes(ConnectionType.UNIX)) {
    context.redisUnix = createClient(ConnectionType.UNIX);
  }

  beforeAll(async () => {
    // Initialize the standard TCP client
    context.initialized = await initializeClient(context.redis);
    
    // Initialize TLS client if provided
    if (context.redisTLS) {
      try {
        await initializeClient(context.redisTLS);
      } catch (err) {
        console.warn("TLS client initialization failed - TLS tests may be skipped");
      }
    }
    
    // Initialize Unix socket client if provided
    if (context.redisUnix) {
      try {
        await initializeClient(context.redisUnix);
      } catch (err) {
        console.warn("Unix socket client initialization failed - Unix socket tests may be skipped");
      }
    }
    
    if (!context.initialized) {
      console.warn("Test initialization failed - tests may be skipped");
    }
  });

  afterAll(async () => {
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
      await context.redis.disconnect();
      
      if (context.redisTLS) {
        await context.redisTLS.disconnect();
      }
      
      if (context.redisUnix) {
        await context.redisUnix.disconnect();
      }
    } catch (err) {
      console.error("Error during test cleanup:", err);
    }
  });

  return context;
}

/**
 * Skip test if Redis is not available
 */
export function skipIfNotInitialized(initialized: boolean) {
  if (!initialized) {
    console.warn("Skipping test because Redis initialization failed");
    return true;
  }
  return false;
}

/**
 * Verify that a value is of a specific type
 */
export function expectType<T>(
  value: any,
  expectedType: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function",
): asserts value is T {
  expect(typeof value).toBe(expectedType);
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