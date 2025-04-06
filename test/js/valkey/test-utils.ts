import { afterAll, beforeAll, expect } from "bun:test";
// These are correct. The folder is named 'valkey", but it's a Redis client and the name is redis.
import { redis, RedisClient } from "bun";

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

// Default test options
export const DEFAULT_REDIS_OPTIONS = {
  username: "default",
  password: "",
  db: 0,
  tls: false,
};

// Default test URL - can be overridden with environment variables
export const DEFAULT_REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379";

// Random key prefix to avoid collisions during testing
export const TEST_KEY_PREFIX = `bun-test-${Date.now()}-`;

/**
 * Generate a unique test key to avoid collisions in Redis data
 */
export function testKey(name: string): string {
  return `${TEST_KEY_PREFIX}${name}`;
}

/**
 * Create a new client with optional custom options
 */
export function createClient(options = {}) {
  return new RedisClient(DEFAULT_REDIS_URL, {
    ...DEFAULT_REDIS_OPTIONS,
    ...options,
  });
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
  redis: ValkeyClient;
  initialized: boolean;
  keyPrefix: string;
  generateKey: (name: string) => string;
}

/**
 * Setup shared test context for test suites
 */
export function setupTestContext(): TestContext {
  const context: TestContext = {
    redis: createClient(DEFAULT_REDIS_OPTIONS),
    initialized: false,
    keyPrefix: TEST_KEY_PREFIX,
    generateKey: testKey,
  };

  beforeAll(async () => {
    context.initialized = await initializeClient(context.redis);
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

      // Disconnect the client
      await context.redis.disconnect();
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
