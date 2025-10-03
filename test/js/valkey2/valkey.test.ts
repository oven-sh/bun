import { beforeAll, beforeEach, describe, expect, test, it, afterEach } from "bun:test";
import {describeValkey, ValkeyContext, Url, ValkeyFaker} from "./test-utils";
import {RedisClient2} from "bun";
import * as random from "_util/random";
import * as algo from "_util/algo";

const randomEngine = random.mulberry32Prng(random.currentMonthSeed());

// No need for describeValkey since we don't need a running Valkey server for these tests. No connection will be
// established.
describe("disconnected client", () => {
  it.each(Url.generateValidSet(32, randomEngine))("should construct with URL %s", (url) => {
    const client = new RedisClient2(url);
    expect(client).toBeInstanceOf(RedisClient2);
  });

  it("should throw on illegal proto", () => {
    try {
      new RedisClient2("quic://localhost:6379");
      expect().fail("Constructor with illegal proto:// did not throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      // TODO(markovejnovic): test that the error has a .code field with value `ERR_REDIS_*`.
    }
  });

  describe("environment variables", () => {
    const originalEnv = { ...process.env };
    afterEach(() => {
      process.env = originalEnv;
    });

    test("should read VALKEY_URL", () => {
      process.env.VALKEY_URL = "redis://env-host:1234/5";
      const client = new RedisClient2();
      expect(client).toBeInstanceOf(RedisClient2);
    });

    test("should read REDIS_URL", () => {
      process.env.REDIS_URL = "redis://env-host:1234/5";
      const client = new RedisClient2();
      expect(client).toBeInstanceOf(RedisClient2);
    });
  });
});

describeValkey("valkey", (ctx: ValkeyContext) => {
  it("successfully connects", async () => {
    await ctx.client().connect();
  });

  describe("runs trivial commands", async () => {
    it("pings", async () => {
      expect(await (await ctx.connectedClient()).ping()).toBe("PONG");
    });

    it.each(algo.zip(
      ValkeyFaker.edgeCaseKeys(randomEngine, 32),
      ValkeyFaker.edgeCaseValues(randomEngine, 32),
    ))("roundtrip get/set/get %s->%s", async (key, value) => {
      const client = await ctx.connectedClient();
      expect(await client.get(key)).toBe(null);
      expect(await client.set(key, value)).toBe("OK");
      expect(await client.get(key)).toBe(value);
    });
  });
}, { server: "redis://localhost:6379" });
