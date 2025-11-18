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

  /** Create a new disconnected client. Each invocation creates a new instance. */
  newDisconnectedClient: () => RedisClient2,

  /** Restart the server. */
  restartServer: () => Promise<void>,
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
    newDisconnectedClient: () => new RedisClient2(context.serverUrl),

    restartServer: async () => {
      if (options.server !== "docker") {
        // We're not the ones managing the server, so there's absolutely nothing we can do here.
        throw new Error("This test is not supported when running against a non-Docker server.");
      }
    },
  };

  beforeEach(async () => {
    // If the client was closed by a previous test, reset it
    if (clientInstance && !clientInstance.connected) {
      clientInstance = null;
      clientConnected = false;
    }

    const client = await context.connectedClient();
    await client.send("FLUSHALL", ["SYNC"]);
  });

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

/** Constructor options for {@link ValkeyFaker}. */
export interface ValkeyFakerOptions {
  unfuzzy?: boolean;
};

/** Faker-eseque utilities for Valkey. */
export class ValkeyFaker {
  #randomEngine: random.RandomEngine;
  #options: ValkeyFakerOptions;
  #unfuzzyGenerator: number;

  constructor(randomEngine: random.RandomEngine, options: ValkeyFakerOptions = {}) {
    this.#randomEngine = randomEngine;
    this.#options = options;
    this.#unfuzzyGenerator = 0;
  }

  get randomEngine(): random.RandomEngine {
    return this.#randomEngine;
  }

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
  key(maxSize: number = 512 * 1024 * 1024): string {
    if (this.#options.unfuzzy) {
      return `key:${this.#unfuzzyGenerator++}`;
    }

    return random.dirtyLatin1String(this.#randomEngine, maxSize);
  }

  edgeCaseKeys(count: number): string[] {
    return Array.from({ length: count }, () => this.key(512 * 1024));
  }

  keys(count: number): string[] {
    // Use 1 KB max size for regular keys to keep tests fast. 1kB is still a reasonably large key.
    return Array.from({ length: count }, () => this.key(1024));
  }

  /** Generate a random binary-safe string suitable for use as a Redis/Valkey value. */
  value(maxSize: number = 512 * 1024 * 1024): string {
    if (this.#options.unfuzzy) {
      return `value:${this.#unfuzzyGenerator++}`;
    }
    return random.dirtyLatin1String(this.#randomEngine, random.range(this.randomEngine, 0, maxSize));
  }

  edgeCaseValues(count: number): string[] {
    // Use 1 KB max size for regular values to keep tests fast. 1kB is still a reasonably large value.
    return Array.from({ length: count }, () => this.value(512 * 1024));
  }

  values(count: number): string[] {
    // Use 1 KB max size for regular values to keep tests fast. 1kB is still a reasonably large value.
    return Array.from({ length: count }, () => this.value(1024));
  }

  channel(maxSize: number = 256): string {
    if (this.#options.unfuzzy) {
      return `channel:${this.#unfuzzyGenerator++}`;
    }

    return random.dirtyLatin1String(this.#randomEngine, maxSize);
  }

  channels(count: number): string[] {
    return Array.from({ length: count }, () => this.channel(256));
  }

  publishMessage(maxSize: number = 512 * 1024 * 1024): string {
    return this.value(maxSize);
  }
}
