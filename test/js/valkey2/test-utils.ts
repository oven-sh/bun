import * as random from "_util/random";
import {RedisClient2} from "bun";

/**
 * Options for {@link describeValkey}.
 */
export interface ValkeyOptions {
  server: "docker" | string
}

const defaultValkeyOptions: ValkeyOptions = {
  server: "docker"
};

/**
 * Context passed to the test suite function of {@link describeValkey}.
 */
export interface ValkeyContext {
  serverUrl: string,

  /** Fetch a Redis client. Subsequent invocations return the same object. */
  client: () => RedisClient2,
  connectedClient: () => Promise<RedisClient2>,
};

/**
 * Helper which manages the lifetime of a Valkey instance.
 *
 * All valkey tests which require a Valkey server should be using this fixture instead of {@link describe}. The
 * semantics are the same as of {@link describe}.
 */
export function describeValkey(
  description: string,
  testSuite: (context: ValkeyContext) => void | Promise<void>,
  options: ValkeyOptions = defaultValkeyOptions,
) {
  if (options.server === "docker") {
    throw new Error("Not implemented.");
  }

  let clientInstance: RedisClient2 | null = null;
  let clientConnected = false;

  const context: ValkeyContext = {
    serverUrl: options.server,
    client: () => {
      if (clientInstance === null) {
        clientInstance = new RedisClient2(context.serverUrl);
      }
      return clientInstance;
    },
    connectedClient: async () => {
      const client = context.client();
      if (!clientConnected) {
        // Note: this is an async operation, but we don't want to make the entire context async.
        // The test suite should await .connect() itself if it needs to.
        await client.connect();
        clientConnected = true;
      }

      return client;
    },
  };

  describe(description, () => {
    beforeAll(async () => {
      clientInstance = null;
      clientConnected = false;
    });

    testSuite.bind(null, context)();
  });
}

/** Utilities for working with Valkey URLs. */
export namespace Url {
  /** List of protocols supported by Valkey. Valid in the context of `<protocol>://...` */
  export const VALID_PROTOCOLS = [
    "valkey", "valkeys", "valkey+tls", "valkey+unix", "valkey+tls+unix", "redis", "rediss", "redis+tls", "redis+unix",
    "redis+tls+unix",
  ];

  /** Valid range of database IDs. Redis normally lets you have up to 16 DBs, but this is configurable. */
  export const VALID_DB_ID_RANGE = [0, 0xFFFFFF];

  /** Generate a set of valid URLs covering all supported protocols, with other parameters randomized. */
  export function generateValidSet(count: number, randomEngine: random.RandomEngine): string[] {
    const protos = random.selectNUniversal(VALID_PROTOCOLS, count, randomEngine);

    function generateUrl(proto: string) {
      if (proto.includes("+unix")) {
        return `${proto}://${random.FileSystem.fakeAbsPath(randomEngine, "posix")}`;
      }

      const dbId: number | undefined =
        random.coinFlip(randomEngine) ? random.range(randomEngine, VALID_DB_ID_RANGE[0], VALID_DB_ID_RANGE[1])
        : undefined;
      const dbStr = dbId !== undefined ? `/${dbId}` : "";

      return `${proto}://${random.Net.location(randomEngine)}:${random.Net.port(randomEngine)}${dbStr}`;
    }

    return protos.map(generateUrl);
  }
}

/** Faker-eseque utilities for Valkey. */
export namespace ValkeyFaker {
  /**
   * Generate a random binary-safe string suitable for use as a Redis/Valkey key.
   *
   * Uses uniform distribution across all byte values (0-255) for maximum randomness.
   * The size of the generated string is randomly chosen between 1 byte and maxSize.
   *
   * The manual states that the key name is a binary safe string up to 512 MB in length.
   *
   * @param randomEngine The random number generator to use
   * @param maxSize Maximum size in bytes (default: 512 MB)
   * @returns A binary-safe random string
   */
  export function key(randomEngine: random.RandomEngine, maxSize: number = 512 * 1024 * 1024): string {
    return random.dirtyLatin1String(randomEngine, maxSize);
  }

  export function edgeCaseKeys(randomEngine: random.RandomEngine, count: number): string[] {
    return Array.from({ length: count }, () => key(randomEngine, 512 * 1024 * 1024));
  }

  export function keys(randomEngine: random.RandomEngine, count: number): string[] {
    // Use 1 KB max size for regular keys to keep tests fast. 1kB is still a reasonably large key.
    return Array.from({ length: count }, () => key(randomEngine, 1024));
  }

  /** Generate a random binary-safe string suitable for use as a Redis/Valkey value. */
  export function value(randomEngine: random.RandomEngine, maxSize: number = 512 * 1024 * 1024): string {
    return random.dirtyLatin1String(randomEngine, maxSize);
  }

  export function edgeCaseValues(randomEngine: random.RandomEngine, count: number): string[] {
    // Use 1 KB max size for regular values to keep tests fast. 1kB is still a reasonably large value.
    return Array.from({ length: count }, () => value(randomEngine, 512 * 1024 * 1024));
  }

  export function values(randomEngine: random.RandomEngine, count: number): string[] {
    // Use 1 KB max size for regular values to keep tests fast. 1kB is still a reasonably large value.
    return Array.from({ length: count }, () => value(randomEngine, 1024));
  }
}
