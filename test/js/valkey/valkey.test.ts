import { randomUUIDv7, RedisClient, spawn } from "bun";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bunExe, bunRun } from "harness";
import { join } from "node:path";
import {
  ctx as _ctx,
  awaitableCounter,
  ConnectionType,
  createClient,
  DEFAULT_REDIS_URL,
  expectType,
  isEnabled,
  randomCoinFlip,
  setupDockerContainer,
  TLS_REDIS_OPTIONS,
  TLS_REDIS_URL,
} from "./test-utils";
import type { RedisTestStartMessage } from "./valkey.failing-subscriber";
import type { Message } from "./valkey.failing-subscriber-no-ipc";

for (const connectionType of [ConnectionType.TLS, ConnectionType.TCP]) {
  const ctx = { ..._ctx, redis: connectionType ? _ctx.redis : (_ctx.redisTLS as RedisClient) };
  describe.skipIf(!isEnabled)(`Valkey Redis Client (${connectionType})`, () => {
    beforeAll(async () => {
      await setupDockerContainer();
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }
    });

    beforeEach(async () => {
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }

      await ctx.redis.connect();
      await ctx.redis.send("FLUSHALL", ["SYNC"]);
    });

    describe("Basic Operations", () => {
      test("should keep process alive when connecting", async () => {
        const result = bunRun(join(import.meta.dir, "valkey.connecting.fixture.ts"), {
          "BUN_VALKEY_URL": connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL,
          "BUN_VALKEY_TLS": connectionType === ConnectionType.TLS ? JSON.stringify(TLS_REDIS_OPTIONS.tlsPaths) : "",
        });
        expect(result.stdout).toContain(`connected`);
      });

      test("should set and get strings", async () => {
        const redis = ctx.redis;
        const testKey = "greeting";
        const testValue = "Hello from Bun Redis!";

        const setResult = await redis.set(testKey, testValue);
        expect(setResult).toMatchInlineSnapshot(`"OK"`);

        const setResult2 = await redis.set(testKey, testValue, "GET");
        expect(setResult2).toMatchInlineSnapshot(`"${testValue}"`);

        const getValue = await redis.get(testKey);
        expect(getValue).toMatchInlineSnapshot(`"${testValue}"`);
      });

      test("should test key existence", async () => {
        const redis = ctx.redis;

        await redis.set("greeting", "test existence");

        const exists = await redis.exists("greeting");
        expect(exists).toBeDefined();

        expect(exists).toBe(true);

        const randomKey = "nonexistent-key-" + randomUUIDv7();
        const notExists = await redis.exists(randomKey);
        expect(notExists).toBeDefined();

        expect(notExists).toBe(false);
      });

      test("should increment and decrement counters", async () => {
        const redis = ctx.redis;
        const counterKey = "counter";

        await redis.set(counterKey, "10");

        const incrementedValue = await redis.incr(counterKey);
        expect(incrementedValue).toBeDefined();
        expect(typeof incrementedValue).toBe("number");
        expect(incrementedValue).toBe(11);

        const decrementedValue = await redis.decr(counterKey);
        expect(decrementedValue).toBeDefined();
        expect(typeof decrementedValue).toBe("number");
        expect(decrementedValue).toBe(10);
      });

      test("should increment by specified amount with INCRBY", async () => {
        const redis = ctx.redis;
        const counterKey = "incrby-counter";
        await redis.set(counterKey, "5");

        const result1 = await redis.incrby(counterKey, 10);
        expect(result1).toBe(15);

        const result2 = await redis.incrby(counterKey, -3);
        expect(result2).toBe(12);

        const result3 = await redis.incrby("new-incrby-key", 5);
        expect(result3).toBe(5);
      });

      test("should increment by float amount with INCRBYFLOAT", async () => {
        const redis = ctx.redis;
        const floatKey = "float-counter";
        await redis.set(floatKey, "10.5");

        const result1 = await redis.incrbyfloat(floatKey, 2.3);
        expect(result1).toBe("12.8");

        const result2 = await redis.incrbyfloat(floatKey, -0.8);
        expect(result2).toBe("12");

        const result3 = await redis.incrbyfloat("new-float-key", 3.14);
        expect(result3).toBe("3.14");
      });

      test("should decrement by specified amount with DECRBY", async () => {
        const redis = ctx.redis;
        const counterKey = "decrby-counter";
        await redis.set(counterKey, "20");

        const result1 = await redis.decrby(counterKey, 5);
        expect(result1).toBe(15);

        const result2 = await redis.decrby(counterKey, 10);
        expect(result2).toBe(5);

        const result3 = await redis.decrby("new-decrby-key", 3);
        expect(result3).toBe(-3);
      });

      test("should rename a key with RENAME", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key";
        const newKey = "new-key";
        const value = "test-value";

        await redis.set(oldKey, value);

        const result = await redis.rename(oldKey, newKey);
        expect(result).toBe("OK");

        const newValue = await redis.get(newKey);
        expect(newValue).toBe(value);

        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should rename a key with RENAME overwriting existing key", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-overwrite";
        const newKey = "new-key-overwrite";

        await redis.set(oldKey, "old-value");
        await redis.set(newKey, "existing-value");

        const result = await redis.rename(oldKey, newKey);
        expect(result).toBe("OK");

        const newValue = await redis.get(newKey);
        expect(newValue).toBe("old-value");

        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should rename a key only if new key does not exist with RENAMENX", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-nx";
        const newKey = "new-key-nx";
        const value = "test-value";

        await redis.set(oldKey, value);

        const result1 = await redis.renamenx(oldKey, newKey);
        expect(result1).toBe(1);

        const newValue = await redis.get(newKey);
        expect(newValue).toBe(value);

        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should not rename if new key exists with RENAMENX", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-nx-fail";
        const newKey = "new-key-nx-fail";

        await redis.set(oldKey, "old-value");
        await redis.set(newKey, "existing-value");

        const result = await redis.renamenx(oldKey, newKey);
        expect(result).toBe(0);

        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBe("old-value");

        const newValue = await redis.get(newKey);
        expect(newValue).toBe("existing-value");
      });

      test("should set multiple keys with MSET", async () => {
        const redis = ctx.redis;

        const result = await redis.mset("mset-key1", "value1", "mset-key2", "value2", "mset-key3", "value3");
        expect(result).toBe("OK");

        const value1 = await redis.get("mset-key1");
        expect(value1).toBe("value1");
        const value2 = await redis.get("mset-key2");
        expect(value2).toBe("value2");
        const value3 = await redis.get("mset-key3");
        expect(value3).toBe("value3");
      });

      test("should set multiple keys only if none exist with MSETNX", async () => {
        const redis = ctx.redis;

        const result1 = await redis.msetnx("msetnx-key1", "value1", "msetnx-key2", "value2");
        expect(result1).toBe(1);

        const value1 = await redis.get("msetnx-key1");
        expect(value1).toBe("value1");
        const value2 = await redis.get("msetnx-key2");
        expect(value2).toBe("value2");

        const result2 = await redis.msetnx("msetnx-key1", "newvalue", "msetnx-key3", "value3");
        expect(result2).toBe(0);

        const unchangedValue = await redis.get("msetnx-key1");
        expect(unchangedValue).toBe("value1");

        const nonExistentKey = await redis.get("msetnx-key3");
        expect(nonExistentKey).toBeNull();
      });

      test("should manage key expiration", async () => {
        const redis = ctx.redis;

        const tempKey = "temporary";
        await redis.set(tempKey, "will expire");

        const result = await redis.expire(tempKey, 60);

        expect(result).toMatchInlineSnapshot(`1`);

        const ttl = await redis.ttl(tempKey);
        expectType<number>(ttl, "number");
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      test("should set key with expiration using SETEX", async () => {
        const redis = ctx.redis;
        const key = "setex-test-key";
        const value = "test-value";

        const result = await redis.setex(key, 10, value);
        expect(result).toBe("OK");

        const getValue = await redis.get(key);
        expect(getValue).toBe(value);

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(10);
      });

      test("should set key with expiration using PSETEX", async () => {
        const redis = ctx.redis;
        const key = "psetex-test-key";
        const value = "test-value";

        const result = await redis.psetex(key, 5000, value);
        expect(result).toBe("OK");

        const getValue = await redis.get(key);
        expect(getValue).toBe(value);

        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5000);
      });

      test("should set expiration with EXPIREAT using Unix timestamp", async () => {
        const redis = ctx.redis;
        const key = "expireat-test-key";
        await redis.set(key, "test-value");

        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.expireat(key, futureTimestamp);
        expect(result).toBe(1);

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      test("should return 0 for EXPIREAT on non-existent key", async () => {
        const redis = ctx.redis;
        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.expireat("nonexistent-expireat-key", futureTimestamp);
        expect(result).toBe(0);
      });

      test("should set expiration with PEXPIRE in milliseconds", async () => {
        const redis = ctx.redis;
        const key = "pexpire-test-key";
        await redis.set(key, "test-value");

        const result = await redis.pexpire(key, 5000);
        expect(result).toBe(1);

        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5050);
      });

      test("should return 0 for PEXPIRE on non-existent key", async () => {
        const redis = ctx.redis;
        const result = await redis.pexpire("nonexistent-pexpire-key", 5000);
        expect(result).toBe(0);
      });

      test("should set expiration with PEXPIREAT using Unix timestamp in milliseconds", async () => {
        const redis = ctx.redis;
        const key = "pexpireat-test-key";
        await redis.set(key, "test-value");

        const futureTimestampMs = Date.now() + 5000;
        const result = await redis.pexpireat(key, futureTimestampMs);
        expect(result).toBe(1);

        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5050);
      });

      test("should return 0 for PEXPIREAT on non-existent key", async () => {
        const redis = ctx.redis;
        const futureTimestampMs = Date.now() + 5000;
        const result = await redis.pexpireat("nonexistent-pexpireat-key", futureTimestampMs);
        expect(result).toBe(0);
      });

      test("should determine the type of a key with TYPE", async () => {
        const redis = ctx.redis;

        await redis.set("string-key", "value");
        const stringType = await redis.type("string-key");
        expect(stringType).toBe("string");

        await redis.lpush("list-key", "value");
        const listType = await redis.type("list-key");
        expect(listType).toBe("list");

        await redis.sadd("set-key", "value");
        const setType = await redis.type("set-key");
        expect(setType).toBe("set");

        await redis.send("HSET", ["hash-key", "field", "value"]);
        const hashType = await redis.type("hash-key");
        expect(hashType).toBe("hash");

        const noneType = await redis.type("nonexistent-key");
        expect(noneType).toBe("none");
      });

      test("should update last access time with TOUCH", async () => {
        const redis = ctx.redis;

        await redis.set("touch-key1", "value1");
        await redis.set("touch-key2", "value2");

        const touchedCount = await redis.touch("touch-key1", "touch-key2");
        expect(touchedCount).toBe(2);

        const mixedCount = await redis.touch("touch-key1", "nonexistent-key");
        expect(mixedCount).toBe(1);

        const noneCount = await redis.touch("nonexistent-key1", "nonexistent-key2");
        expect(noneCount).toBe(0);
      });

      test("should get and set bits", async () => {
        const redis = ctx.redis;
        const bitKey = "mybitkey";

        const oldValue = await redis.setbit(bitKey, 7, 1);
        expect(oldValue).toBe(0);

        const bitValue = await redis.getbit(bitKey, 7);
        expect(bitValue).toBe(1);

        const unsetBit = await redis.getbit(bitKey, 100);
        expect(unsetBit).toBe(0);

        const oldValue2 = await redis.setbit(bitKey, 7, 0);
        expect(oldValue2).toBe(1);

        const bitValue2 = await redis.getbit(bitKey, 7);
        expect(bitValue2).toBe(0);
      });

      test("should handle multiple bit operations", async () => {
        const redis = ctx.redis;
        const bitKey = "multibit";

        await redis.setbit(bitKey, 0, 1);
        await redis.setbit(bitKey, 3, 1);
        await redis.setbit(bitKey, 7, 1);

        expect(await redis.getbit(bitKey, 0)).toBe(1);
        expect(await redis.getbit(bitKey, 1)).toBe(0);
        expect(await redis.getbit(bitKey, 2)).toBe(0);
        expect(await redis.getbit(bitKey, 3)).toBe(1);
        expect(await redis.getbit(bitKey, 4)).toBe(0);
        expect(await redis.getbit(bitKey, 5)).toBe(0);
        expect(await redis.getbit(bitKey, 6)).toBe(0);
        expect(await redis.getbit(bitKey, 7)).toBe(1);

        const count = await redis.bitcount(bitKey);
        expect(count).toBe(3);
      });

      test("should get range of string", async () => {
        const redis = ctx.redis;
        const key = "rangetest";
        await redis.set(key, "Hello World");

        const result1 = await redis.getrange(key, 0, 4);
        expect(result1).toBe("Hello");

        const result2 = await redis.getrange(key, 6, 10);
        expect(result2).toBe("World");

        const result3 = await redis.getrange(key, -5, -1);
        expect(result3).toBe("World");

        const result4 = await redis.getrange(key, 0, -1);
        expect(result4).toBe("Hello World");
      });

      test("should set range of string", async () => {
        const redis = ctx.redis;
        const key = "setrangetest";
        await redis.set(key, "Hello World");

        const newLength = await redis.setrange(key, 6, "Redis");
        expect(newLength).toBe(11);

        const result = await redis.get(key);
        expect(result).toBe("Hello Redis");

        const key2 = "newkey";
        const newLength2 = await redis.setrange(key2, 5, "Redis");
        expect(newLength2).toBeGreaterThanOrEqual(10);
      });

      test("should append to string with APPEND", async () => {
        const redis = ctx.redis;
        const key = "append-test";

        const len1 = await redis.append(key, "Hello");
        expect(len1).toBe(5);

        const len2 = await redis.append(key, " World");
        expect(len2).toBe(11);

        const value = await redis.get(key);
        expect(value).toBe("Hello World");
      });

      test("should delete keys with DEL", async () => {
        const redis = ctx.redis;

        await redis.set("del-key1", "value1");
        await redis.set("del-key2", "value2");
        await redis.set("del-key3", "value3");

        const count1 = await redis.del("del-key1");
        expect(count1).toBe(1);

        const value1 = await redis.get("del-key1");
        expect(value1).toBeNull();

        const count2 = await redis.del("del-key2", "del-key3");
        expect(count2).toBe(2);

        const count3 = await redis.del("nonexistent");
        expect(count3).toBe(0);
      });

      test("should serialize key with DUMP", async () => {
        const redis = ctx.redis;
        const key = "dump-test";

        await redis.set(key, "test-value");

        const serialized = await redis.dump(key);
        expect(serialized).toBeDefined();
        expect(serialized).not.toBeNull();

        const empty = await redis.dump("nonexistent");
        expect(empty).toBeNull();
      });

      test("should get value as Buffer with getBuffer", async () => {
        const redis = ctx.redis;
        const key = "getbuffer-test";

        await redis.set(key, "test-value");

        const buffer = await redis.getBuffer(key);
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer?.toString()).toBe("test-value");

        const empty = await redis.getBuffer("nonexistent");
        expect(empty).toBeNull();
      });

      test("should get and delete with GETDEL", async () => {
        const redis = ctx.redis;
        const key = "getdel-test";

        await redis.set(key, "test-value");

        const value = await redis.getdel(key);
        expect(value).toBe("test-value");

        const deleted = await redis.get(key);
        expect(deleted).toBeNull();

        const empty = await redis.getdel("nonexistent");
        expect(empty).toBeNull();
      });

      test("should get and set expiration with GETEX", async () => {
        const redis = ctx.redis;
        const key = "getex-test";

        await redis.set(key, "test-value");

        const value1 = await redis.getex(key, "EX", 60);
        expect(value1).toBe("test-value");
        const ttl1 = await redis.ttl(key);
        expect(ttl1).toBeGreaterThan(0);
        expect(ttl1).toBeLessThanOrEqual(60);

        const value2 = await redis.getex(key, "PX", 5000);
        expect(value2).toBe("test-value");
        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5000);

        const empty = await redis.getex("nonexistent", "EX", 60);
        expect(empty).toBeNull();
      });

      test("should get old value and set new with GETSET", async () => {
        const redis = ctx.redis;
        const key = "getset-test";

        const old1 = await redis.getset(key, "value1");
        expect(old1).toBeNull();

        const old2 = await redis.getset(key, "value2");
        expect(old2).toBe("value1");

        const current = await redis.get(key);
        expect(current).toBe("value2");
      });

      test("should get string length with STRLEN", async () => {
        const redis = ctx.redis;
        const key = "strlen-test";

        const len1 = await redis.strlen(key);
        expect(len1).toBe(0);

        await redis.set(key, "Hello");
        const len2 = await redis.strlen(key);
        expect(len2).toBe(5);

        await redis.set(key, "Hello World");
        const len3 = await redis.strlen(key);
        expect(len3).toBe(11);
      });

      test("should get substring with SUBSTR", async () => {
        const redis = ctx.redis;
        const key = "substr-test";

        await redis.set(key, "Hello World");

        const result = await redis.substr(key, 0, 4);
        expect(result).toBe("Hello");
      });

      test("should get expiration time with EXPIRETIME", async () => {
        const redis = ctx.redis;
        const key = "expiretime-test";

        await redis.set(key, "value");

        const futureTs = Math.floor(Date.now() / 1000) + 60;
        await redis.expireat(key, futureTs);

        const expireTime = await redis.expiretime(key);
        expect(expireTime).toBeGreaterThan(0);
        expect(expireTime).toBeLessThanOrEqual(futureTs);

        const key2 = "no-expire";
        await redis.set(key2, "value");
        const noExpire = await redis.expiretime(key2);
        expect(noExpire).toBe(-1);

        const nonExist = await redis.expiretime("nonexistent");
        expect(nonExist).toBe(-2);
      });

      test("should get expiration time in ms with PEXPIRETIME", async () => {
        const redis = ctx.redis;
        const key = "pexpiretime-test";

        await redis.set(key, "value");

        const futureTs = Date.now() + 5000;
        await redis.pexpireat(key, futureTs);

        const pexpireTime = await redis.pexpiretime(key);
        expect(pexpireTime).toBeGreaterThan(0);
        expect(pexpireTime).toBeLessThanOrEqual(futureTs);

        const key2 = "no-expire";
        await redis.set(key2, "value");
        const noExpire = await redis.pexpiretime(key2);
        expect(noExpire).toBe(-1);

        const nonExist = await redis.pexpiretime("nonexistent");
        expect(nonExist).toBe(-2);
      });

      test("should remove expiration with PERSIST", async () => {
        const redis = ctx.redis;
        const key = "persist-test";

        await redis.set(key, "value");
        await redis.expire(key, 60);

        const ttlBefore = await redis.ttl(key);
        expect(ttlBefore).toBeGreaterThan(0);

        const result = await redis.persist(key);
        expect(result).toBe(1);

        const ttlAfter = await redis.ttl(key);
        expect(ttlAfter).toBe(-1);

        const result2 = await redis.persist(key);
        expect(result2).toBe(0);

        const result3 = await redis.persist("nonexistent");
        expect(result3).toBe(0);
      });

      test("should get multiple values with MGET", async () => {
        const redis = ctx.redis;

        await redis.set("mget-key1", "value1");
        await redis.set("mget-key2", "value2");
        await redis.set("mget-key3", "value3");

        const values = await redis.mget("mget-key1", "mget-key2", "mget-key3");
        expect(values).toEqual(["value1", "value2", "value3"]);

        const mixed = await redis.mget("mget-key1", "nonexistent", "mget-key2");
        expect(mixed).toEqual(["value1", null, "value2"]);

        const allNull = await redis.mget("none1", "none2", "none3");
        expect(allNull).toEqual([null, null, null]);
      });

      test("should set only if not exists with SETNX", async () => {
        const redis = ctx.redis;
        const key = "setnx-test";

        const result1 = await redis.setnx(key, "value1");
        expect(result1).toBe(1);

        const value1 = await redis.get(key);
        expect(value1).toBe("value1");

        const result2 = await redis.setnx(key, "value2");
        expect(result2).toBe(0);

        const value2 = await redis.get(key);
        expect(value2).toBe("value1");
      });

      test("should add to HyperLogLog with PFADD", async () => {
        const redis = ctx.redis;
        const key = "pfadd-test";

        const result1 = await redis.pfadd(key, "element1");
        expect(result1).toBe(1);

        const result2 = await redis.pfadd(key, "element2");
        expect(result2).toBe(1);

        const result3 = await redis.pfadd(key, "element1");
        expect(result3).toBe(0);
      });

      test("should implement TTL command correctly for different cases", async () => {
        const redis = ctx.redis;

        const tempKey = "ttl-test-key";
        await redis.set(tempKey, "ttl test value");
        await redis.expire(tempKey, 60);

        const ttl = await redis.ttl(tempKey);
        expectType<number>(ttl, "number");
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);

        const permanentKey = "permanent-key";
        await redis.set(permanentKey, "no expiry");
        const noExpiry = await redis.ttl(permanentKey);
        expect(noExpiry).toMatchInlineSnapshot(`-1`);

        const nonExistentKey = "non-existent-" + randomUUIDv7();
        const noKey = await redis.ttl(nonExistentKey);
        expect(noKey).toMatchInlineSnapshot(`-2`);
      });

      test("should copy a key to a new key with COPY", async () => {
        const redis = ctx.redis;
        const sourceKey = "copy-source";
        const destKey = "copy-dest";

        await redis.set(sourceKey, "Hello World");

        const result = await redis.copy(sourceKey, destKey);
        expect(result).toBe(1);

        const sourceValue = await redis.get(sourceKey);
        const destValue = await redis.get(destKey);
        expect(sourceValue).toBe("Hello World");
        expect(destValue).toBe("Hello World");

        const result2 = await redis.copy(sourceKey, destKey);
        expect(result2).toBe(0);
      });

      test("should copy a key with REPLACE option", async () => {
        const redis = ctx.redis;
        const sourceKey = "copy-replace-source";
        const destKey = "copy-replace-dest";

        await redis.set(sourceKey, "New Value");
        await redis.set(destKey, "Old Value");

        const result = await redis.copy(sourceKey, destKey, "REPLACE");
        expect(result).toBe(1);

        const destValue = await redis.get(destKey);
        expect(destValue).toBe("New Value");
      });

      test("should unlink one or more keys asynchronously with UNLINK", async () => {
        const redis = ctx.redis;

        await redis.set("unlink-key1", "value1");
        await redis.set("unlink-key2", "value2");
        await redis.set("unlink-key3", "value3");

        const result = await redis.unlink("unlink-key1", "unlink-key2", "unlink-key3");
        expect(result).toBe(3);

        expect(await redis.get("unlink-key1")).toBeNull();
        expect(await redis.get("unlink-key2")).toBeNull();
        expect(await redis.get("unlink-key3")).toBeNull();
      });

      test("should unlink with non-existent keys", async () => {
        const redis = ctx.redis;

        await redis.set("unlink-exists", "value");

        const result = await redis.unlink("unlink-exists", "unlink-nonexist1", "unlink-nonexist2");
        expect(result).toBe(1);

        expect(await redis.get("unlink-exists")).toBeNull();
      });

      test("should return a random key with RANDOMKEY", async () => {
        const redis = ctx.redis;

        const emptyResult = await redis.randomkey();
        expect(emptyResult).toBeNull();

        await redis.set("random-key1", "value1");
        await redis.set("random-key2", "value2");
        await redis.set("random-key3", "value3");

        const randomKey = await redis.randomkey();
        expect(randomKey).toBeDefined();
        expect(randomKey).not.toBeNull();
        expect(["random-key1", "random-key2", "random-key3"]).toContain<string | null>(randomKey);

        const value = await redis.get(randomKey!);
        expect(value).toBeDefined();
      });

      test("should iterate keys with SCAN", async () => {
        const redis = ctx.redis;

        const testKeys = ["scan-test:1", "scan-test:2", "scan-test:3", "scan-test:4", "scan-test:5"];
        for (const key of testKeys) {
          await redis.set(key, "value");
        }

        let cursor = "0";
        const foundKeys: string[] = [];
        do {
          const [nextCursor, keys] = await redis.scan(cursor);
          foundKeys.push(...keys);
          cursor = nextCursor;
        } while (cursor !== "0");

        for (const testKey of testKeys) {
          expect(foundKeys).toContain(testKey);
        }
      });

      test("should iterate keys with SCAN and MATCH pattern", async () => {
        const redis = ctx.redis;

        await redis.set("user:1", "alice");
        await redis.set("user:2", "bob");
        await redis.set("post:1", "hello");
        await redis.set("post:2", "world");

        let cursor = "0";
        const userKeys: string[] = [];
        do {
          const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "user:*");
          userKeys.push(...keys);
          cursor = nextCursor;
        } while (cursor !== "0");

        expect(userKeys).toContain("user:1");
        expect(userKeys).toContain("user:2");
        expect(userKeys).not.toContain("post:1");
        expect(userKeys).not.toContain("post:2");
      });

      test("should reject invalid object argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan({} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid array argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan([] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid null argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan(null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid source key in COPY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.copy({} as any, "dest");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'copy'."`);
      });

      test("should reject invalid destination key in COPY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.copy("source", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'copy'."`);
      });

      test("should reject invalid option in COPY", async () => {
        const redis = ctx.redis;
        await redis.set("copy-invalid-opt-source", "value");
        expect(async () => {
          await redis.copy("copy-invalid-opt-source", "copy-invalid-opt-dest", "NOTVALID" as any);
        }).toThrowErrorMatchingInlineSnapshot(`"ERR syntax error"`);
      });

      test("should reject invalid old key in RENAME", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.rename({} as any, "newkey");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'rename'."`);
      });

      test("should reject invalid new key in RENAME", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.rename("oldkey", null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected newkey to be a string or buffer for 'rename'."`);
      });

      test("should reject invalid key in GETRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.getrange({} as any, 0, 5);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'getrange'."`);
      });

      test("should reject invalid key in SETRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setrange(undefined as any, 0, "value");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'setrange'."`);
      });

      test("should reject invalid key in INCRBY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.incrby([] as any, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'incrby'."`);
      });

      test("should reject invalid value in MSET", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.mset("key", {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'mset'."`);
      });

      test("should reject invalid value in MSETNX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.msetnx("key1", "value1", "key2", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'msetnx'."`);
      });

      test("should reject invalid key in SETBIT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setbit({} as any, 0, 1);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'setbit'."`);
      });

      test("should reject invalid key in SETEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setex(null as any, 10, "value");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'setex'."`);
      });

      test("should reject invalid key in PSETEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.psetex([] as any, 1000, "value");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'psetex'."`);
      });

      test("should reject invalid key in UNLINK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.unlink({} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'unlink'."`);
      });

      test("should reject invalid additional key in UNLINK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.unlink("valid-key", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'unlink'."`);
      });

      test("should reject invalid key in TOUCH", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.touch(null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"The "key" argument must be specified"`);
      });

      test("should reject invalid additional key in TOUCH", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.touch("valid-key", {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'touch'."`);
      });

      test("should reject invalid key in EXPIREAT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.expireat({} as any, 1234567890);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'expireat'."`);
      });

      test("should reject invalid key in PEXPIRE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.pexpire([] as any, 5000);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'pexpire'."`);
      });

      test("should reject invalid key in PEXPIREAT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.pexpireat(null as any, 1234567890000);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'pexpireat'."`);
      });
    });

    describe("String commands", () => {
      test("should append value to key with APPEND", async () => {
        const redis = ctx.redis;
        const key = "append-test";

        const length1 = await redis.append(key, "Hello");
        expect(length1).toBe(5);

        const value1 = await redis.get(key);
        expect(value1).toBe("Hello");

        const length2 = await redis.append(key, " World");
        expect(length2).toBe(11);

        const value2 = await redis.get(key);
        expect(value2).toBe("Hello World");
      });

      test("should delete one or more keys with DEL", async () => {
        const redis = ctx.redis;

        await redis.set("del-test-1", "value1");
        await redis.set("del-test-2", "value2");
        await redis.set("del-test-3", "value3");

        const result1 = await redis.del("del-test-1");
        expect(result1).toBe(1);

        expect(await redis.get("del-test-1")).toBeNull();

        const result2 = await redis.del("del-test-2", "del-test-3");
        expect(result2).toBe(2);

        expect(await redis.get("del-test-2")).toBeNull();
        expect(await redis.get("del-test-3")).toBeNull();

        const result3 = await redis.del("del-test-nonexistent");
        expect(result3).toBe(0);
      });

      test("should serialize key with DUMP", async () => {
        const redis = ctx.redis;
        const key = "dump-test";

        await redis.set(key, "Hello World");

        const serialized = await redis.dump(key);
        expect(serialized).toBeDefined();
        expect(serialized).not.toBeNull();

        expect(typeof serialized === "string" || Buffer.isBuffer(serialized)).toBe(true);

        const nonExistent = await redis.dump("dump-test-nonexistent");
        expect(nonExistent).toBeNull();
      });

      test("should get value as Buffer with getBuffer", async () => {
        const redis = ctx.redis;
        const key = "getbuffer-test";

        await redis.set(key, "Hello Buffer");

        const buffer = await redis.getBuffer(key);
        expect(buffer).toBeDefined();
        expect(buffer).not.toBeNull();
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer!.toString()).toBe("Hello Buffer");

        const nonExistent = await redis.getBuffer("getbuffer-nonexistent");
        expect(nonExistent).toBeNull();
      });

      test("should get and delete key with GETDEL", async () => {
        const redis = ctx.redis;
        const key = "getdel-test";

        await redis.set(key, "Delete me");

        const value = await redis.getdel(key);
        expect(value).toBe("Delete me");

        const check = await redis.get(key);
        expect(check).toBeNull();

        const nonExistent = await redis.getdel("getdel-nonexistent");
        expect(nonExistent).toBeNull();
      });

      test("should get key with expiration using GETEX with EX", async () => {
        const redis = ctx.redis;
        const key = "getex-ex-test";

        await redis.set(key, "Expire me");

        const value = await redis.getex(key, "EX", 10);
        expect(value).toBe("Expire me");

        const check = await redis.get(key);
        expect(check).toBe("Expire me");

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(10);
      });

      test("should get key with expiration using GETEX with PX", async () => {
        const redis = ctx.redis;
        const key = "getex-px-test";

        await redis.set(key, "Expire me");

        const value = await redis.getex(key, "PX", 5000);
        expect(value).toBe("Expire me");

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(5);
      });

      test("should get key with expiration using GETEX with EXAT", async () => {
        const redis = ctx.redis;
        const key = "getex-exat-test";

        await redis.set(key, "Expire at timestamp");

        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const value = await redis.getex(key, "EXAT", futureTimestamp);
        expect(value).toBe("Expire at timestamp");

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      test("should get key with expiration using GETEX with PXAT", async () => {
        const redis = ctx.redis;
        const key = "getex-pxat-test";

        await redis.set(key, "Expire at timestamp");

        const futureTimestamp = Date.now() + 60000;
        const value = await redis.getex(key, "PXAT", futureTimestamp);
        expect(value).toBe("Expire at timestamp");

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      test("should persist key expiration using GETEX with PERSIST", async () => {
        const redis = ctx.redis;
        const key = "getex-persist-test";

        await redis.set(key, "Remove expiration", "EX", 100);

        const ttlBefore = await redis.ttl(key);
        expect(ttlBefore).toBeGreaterThan(0);

        const value = await redis.getex(key, "PERSIST");
        expect(value).toBe("Remove expiration");

        const ttlAfter = await redis.ttl(key);
        expect(ttlAfter).toBe(-1);
      });

      test("should get non-existent key with GETEX", async () => {
        const redis = ctx.redis;

        const value = await redis.getex("getex-nonexistent", "EX", 10);
        expect(value).toBeNull();
      });

      test("should get and set in one operation with GETSET", async () => {
        const redis = ctx.redis;
        const key = "getset-test";

        const oldValue1 = await redis.getset(key, "new value");
        expect(oldValue1).toBeNull();

        const check1 = await redis.get(key);
        expect(check1).toBe("new value");

        const oldValue2 = await redis.getset(key, "newer value");
        expect(oldValue2).toBe("new value");

        const check2 = await redis.get(key);
        expect(check2).toBe("newer value");
      });

      test("should get string length with STRLEN", async () => {
        const redis = ctx.redis;
        const key = "strlen-test";

        const length1 = await redis.strlen("strlen-nonexistent");
        expect(length1).toBe(0);

        await redis.set(key, "Hello World");
        const length2 = await redis.strlen(key);
        expect(length2).toBe(11);

        await redis.set(key, "Hi");
        const length3 = await redis.strlen(key);
        expect(length3).toBe(2);
      });
    });

    describe("List Operations", () => {
      test("should get list length with LLEN", async () => {
        const redis = ctx.redis;
        const key = "llen-test";

        const len1 = await redis.llen(key);
        expect(len1).toBe(0);

        await redis.lpush(key, "one", "two", "three");

        const len2 = await redis.llen(key);
        expect(len2).toBe(3);

        await redis.lpop(key);
        const len3 = await redis.llen(key);
        expect(len3).toBe(2);
      });

      test("should pop left with LPOP", async () => {
        const redis = ctx.redis;
        const key = "lpop-test";

        await redis.lpush(key, "three", "two", "one");

        const elem1 = await redis.lpop(key);
        expect(elem1).toBe("one");

        const elem2 = await redis.lpop(key, 2);
        expect(elem2).toEqual(["two", "three"]);

        const empty = await redis.lpop(key);
        expect(empty).toBeNull();
      });

      test("should push to existing list with LPUSHX", async () => {
        const redis = ctx.redis;
        const key = "lpushx-test";

        const len1 = await redis.lpushx(key, "value");
        expect(len1).toBe(0);

        await redis.lpush(key, "one");

        const len2 = await redis.lpushx(key, "two");
        expect(len2).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["two", "one"]);
      });

      test("should pop right with RPOP", async () => {
        const redis = ctx.redis;
        const key = "rpop-test";

        await redis.rpush(key, "one", "two", "three");

        const elem1 = await redis.rpop(key);
        expect(elem1).toBe("three");

        const elem2 = await redis.rpop(key, 2);
        expect(elem2).toEqual(["two", "one"]);

        const empty = await redis.rpop(key);
        expect(empty).toBeNull();
      });

      test("should push to existing list with RPUSHX", async () => {
        const redis = ctx.redis;
        const key = "rpushx-test";

        const len1 = await redis.rpushx(key, "value");
        expect(len1).toBe(0);

        await redis.rpush(key, "one");

        const len2 = await redis.rpushx(key, "two");
        expect(len2).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["one", "two"]);
      });

      test("should get range of elements with LRANGE", async () => {
        const redis = ctx.redis;
        const key = "lrange-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["one", "two", "three"]);

        const firstTwo = await redis.lrange(key, 0, 1);
        expect(firstTwo).toEqual(["one", "two"]);

        const lastTwo = await redis.lrange(key, -2, -1);
        expect(lastTwo).toEqual(["two", "three"]);

        const middle = await redis.lrange(key, 1, 1);
        expect(middle).toEqual(["two"]);

        const outOfRange = await redis.lrange(key, 10, 20);
        expect(outOfRange).toEqual([]);

        const nonExistent = await redis.lrange("nonexistent-list", 0, -1);
        expect(nonExistent).toEqual([]);
      });

      test("should get element at index with LINDEX", async () => {
        const redis = ctx.redis;
        const key = "lindex-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const first = await redis.lindex(key, 0);
        expect(first).toBe("one");

        const second = await redis.lindex(key, 1);
        expect(second).toBe("two");

        const third = await redis.lindex(key, 2);
        expect(third).toBe("three");

        const last = await redis.lindex(key, -1);
        expect(last).toBe("three");

        const secondLast = await redis.lindex(key, -2);
        expect(secondLast).toBe("two");

        const outOfRange = await redis.lindex(key, 10);
        expect(outOfRange).toBeNull();

        const outOfRangeNeg = await redis.lindex(key, -10);
        expect(outOfRangeNeg).toBeNull();

        const nonExistent = await redis.lindex("nonexistent-list", 0);
        expect(nonExistent).toBeNull();
      });

      test("should set element at index with LSET", async () => {
        const redis = ctx.redis;
        const key = "lset-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const result1 = await redis.lset(key, 0, "zero");
        expect(result1).toBe("OK");

        const first = await redis.lindex(key, 0);
        expect(first).toBe("zero");

        const result2 = await redis.lset(key, -1, "last");
        expect(result2).toBe("OK");

        const last = await redis.lindex(key, -1);
        expect(last).toBe("last");

        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["zero", "two", "last"]);
      });

      test("should handle LSET errors", async () => {
        const redis = ctx.redis;

        await redis.lpush("lset-error-test", "value");

        expect(async () => {
          await redis.lset("lset-error-test", 10, "newvalue");
        }).toThrow(/index out of range/i);

        expect(async () => {
          await redis.lset("nonexistent-list", 0, "value");
        }).toThrow(/no such key/i);

        await redis.set("string-key", "value");
        expect(async () => {
          await redis.lset("string-key", 0, "value");
        }).toThrow(/wrong.*type|WRONGTYPE/i);
      });

      test("should handle LRANGE with various ranges", async () => {
        const redis = ctx.redis;
        const key = "lrange-advanced";

        for (let i = 5; i >= 1; i--) {
          await redis.lpush(key, String(i));
        }

        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["1", "2", "3", "4", "5"]);

        const invalid = await redis.lrange(key, 3, 1);
        expect(invalid).toEqual([]);

        const mixed = await redis.lrange(key, -3, 4);
        expect(mixed).toEqual(["3", "4", "5"]);

        const bothNeg = await redis.lrange(key, -4, -2);
        expect(bothNeg).toEqual(["2", "3", "4"]);
      });

      test("should handle LINDEX and LSET with numbers", async () => {
        const redis = ctx.redis;
        const key = "list-numbers";

        await redis.lpush(key, "100");
        await redis.lpush(key, "200");
        await redis.lpush(key, "300");

        const elem = await redis.lindex(key, 1);
        expect(elem).toBe("200");

        await redis.lset(key, 1, "250");
        const updated = await redis.lindex(key, 1);
        expect(updated).toBe("250");
      });

      test("should insert element before pivot with LINSERT", async () => {
        const redis = ctx.redis;
        const key = "linsert-before-test";

        await redis.lpush(key, "World");
        await redis.lpush(key, "Hello");

        const result = await redis.linsert(key, "BEFORE", "World", "There");
        expect(result).toBe(3);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["Hello", "There", "World"]);
      });

      test("should insert element after pivot with LINSERT", async () => {
        const redis = ctx.redis;
        const key = "linsert-after-test";

        await redis.lpush(key, "World");
        await redis.lpush(key, "Hello");

        const result = await redis.linsert(key, "AFTER", "Hello", "Beautiful");
        expect(result).toBe(3);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["Hello", "Beautiful", "World"]);
      });

      test("should handle LINSERT when pivot not found", async () => {
        const redis = ctx.redis;
        const key = "linsert-notfound-test";

        await redis.lpush(key, "value1");
        await redis.lpush(key, "value2");

        const result = await redis.linsert(key, "BEFORE", "nonexistent", "newvalue");
        expect(result).toBe(-1);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["value2", "value1"]);
      });

      test("should handle LINSERT on non-existent key", async () => {
        const redis = ctx.redis;

        const result = await redis.linsert("nonexistent-list", "BEFORE", "pivot", "element");
        expect(result).toBe(0);
      });

      test("should remove elements from head with LREM", async () => {
        const redis = ctx.redis;
        const key = "lrem-positive-test";

        await redis.rpush(key, "hello");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");

        const result = await redis.lrem(key, 2, "hello");
        expect(result).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["world", "hello"]);
      });

      test("should remove elements from tail with LREM", async () => {
        const redis = ctx.redis;
        const key = "lrem-negative-test";

        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "hello");

        const result = await redis.lrem(key, -2, "hello");
        expect(result).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["hello", "world"]);
      });

      test("should remove all occurrences with LREM count=0", async () => {
        const redis = ctx.redis;
        const key = "lrem-all-test";

        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "foo");
        await redis.rpush(key, "hello");

        const result = await redis.lrem(key, 0, "hello");
        expect(result).toBe(3);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["world", "foo"]);
      });

      test("should handle LREM when element not found", async () => {
        const redis = ctx.redis;
        const key = "lrem-notfound-test";

        await redis.rpush(key, "value1");
        await redis.rpush(key, "value2");

        const result = await redis.lrem(key, 1, "nonexistent");
        expect(result).toBe(0);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["value1", "value2"]);
      });

      test("should trim list to range with LTRIM", async () => {
        const redis = ctx.redis;
        const key = "ltrim-test";

        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");
        await redis.rpush(key, "four");

        const result = await redis.ltrim(key, 1, 2);
        expect(result).toBe("OK");

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["two", "three"]);
      });

      test("should handle LTRIM with negative indexes", async () => {
        const redis = ctx.redis;
        const key = "ltrim-negative-test";

        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");
        await redis.rpush(key, "four");
        await redis.rpush(key, "five");

        const result = await redis.ltrim(key, -3, -1);
        expect(result).toBe("OK");

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["three", "four", "five"]);
      });

      test("should handle LTRIM with out of range indexes", async () => {
        const redis = ctx.redis;
        const key = "ltrim-outofrange-test";

        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");

        const result = await redis.ltrim(key, 0, 100);
        expect(result).toBe("OK");

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["one", "two", "three"]);
      });

      test("should empty list with LTRIM when stop < start", async () => {
        const redis = ctx.redis;
        const key = "ltrim-empty-test";

        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");

        const result = await redis.ltrim(key, 2, 0);
        expect(result).toBe("OK");

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual([]);
      });

      test("should block and pop element with BLPOP", async () => {
        const redis = ctx.redis;
        const key = "blpop-test";

        await redis.lpush(key, "value1");

        const result = await redis.blpop(key, 0.1);
        expect(result).toEqual([key, "value1"]);

        const timeout = await redis.blpop(key, 0.1);
        expect(timeout).toBeNull();
      });

      test("should block and pop element with BRPOP", async () => {
        const redis = ctx.redis;
        const key = "brpop-test";

        await redis.lpush(key, "value2");
        await redis.lpush(key, "value1");

        const result = await redis.brpop(key, 0.1);
        expect(result).toEqual([key, "value2"]);

        await redis.brpop(key, 0.1);
        const timeout = await redis.brpop(key, 0.1);
        expect(timeout).toBeNull();
      });

      test("should pop from first non-empty list with BLPOP", async () => {
        const redis = ctx.redis;
        const key1 = "blpop-list1";
        const key2 = "blpop-list2";

        await redis.lpush(key2, "value2");

        const result = await redis.blpop(key1, key2, 0.1);
        expect(result).toEqual([key2, "value2"]);
      });

      test("should pop elements with LMPOP LEFT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-left-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const result = await redis.lmpop(1, key, "LEFT");
        expect(result).toEqual([key, ["one"]]);

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["two", "three"]);
      });

      test("should pop elements with LMPOP RIGHT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-right-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const result = await redis.lmpop(1, key, "RIGHT");
        expect(result).toEqual([key, ["three"]]);

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["one", "two"]);
      });

      test("should pop multiple elements with LMPOP COUNT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-count-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const result = await redis.lmpop(1, key, "LEFT", "COUNT", 2);
        expect(result).toEqual([key, ["one", "two"]]);

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["three"]);
      });

      test("should return null for LMPOP on empty list", async () => {
        const redis = ctx.redis;

        const result = await redis.lmpop(1, "nonexistent-list", "LEFT");
        expect(result).toBeNull();
      });

      test("should pop from first non-empty list with LMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "lmpop-empty";
        const key2 = "lmpop-full";

        await redis.lpush(key2, "value");

        const result = await redis.lmpop(2, key1, key2, "LEFT");
        expect(result).toEqual([key2, ["value"]]);
      });

      test("should find position of element with LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-test";

        await redis.lpush(key, "d");
        await redis.lpush(key, "b");
        await redis.lpush(key, "c");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");

        const pos1 = await redis.lpos(key, "b");
        expect(pos1).toBe(1);

        const pos2 = await redis.lpos(key, "a");
        expect(pos2).toBe(0);

        const pos3 = await redis.lpos(key, "d");
        expect(pos3).toBe(4);

        const pos4 = await redis.lpos(key, "x");
        expect(pos4).toBeNull();
      });

      test("should find position with RANK option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-rank-test";

        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");

        const first = await redis.lpos(key, "b");
        expect(first).toBe(0);

        const second = await redis.lpos(key, "b", "RANK", 2);
        expect(second).toBe(2);

        const third = await redis.lpos(key, "b", "RANK", 3);
        expect(third).toBe(4);

        const fourth = await redis.lpos(key, "b", "RANK", 4);
        expect(fourth).toBeNull();

        const fromEnd = await redis.lpos(key, "b", "RANK", -1);
        expect(fromEnd).toBe(4);

        const fromEnd2 = await redis.lpos(key, "b", "RANK", -2);
        expect(fromEnd2).toBe(2);
      });

      test("should find multiple positions with COUNT option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-count-test";

        await redis.lpush(key, "c");
        await redis.lpush(key, "b");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");

        const all = await redis.lpos(key, "b", "COUNT", 0);
        expect(all).toEqual([0, 2, 3]);

        const first2 = await redis.lpos(key, "b", "COUNT", 2);
        expect(first2).toEqual([0, 2]);

        const more = await redis.lpos(key, "b", "COUNT", 10);
        expect(more).toEqual([0, 2, 3]);

        const none = await redis.lpos(key, "x", "COUNT", 5);
        expect(none).toEqual([]);
      });

      test("should find position with MAXLEN option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-maxlen-test";

        for (let i = 5; i >= 1; i--) {
          await redis.lpush(key, String(i));
        }
        await redis.lpush(key, "target");

        const found = await redis.lpos(key, "target", "MAXLEN", 6);
        expect(found).toBe(0);

        const notFound = await redis.lpos(key, "5", "MAXLEN", 3);
        expect(notFound).toBeNull();

        const found3 = await redis.lpos(key, "3", "MAXLEN", 10);
        expect(found3).toBe(3);
      });

      test("should move element from source to destination with LMOVE", async () => {
        const redis = ctx.redis;
        const source = "lmove-source";
        const dest = "lmove-dest";

        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");

        const result1 = await redis.lmove(source, dest, "LEFT", "RIGHT");
        expect(result1).toBe("one");

        const sourceList1 = await redis.lrange(source, 0, -1);
        expect(sourceList1).toEqual(["two", "three"]);

        const destList1 = await redis.lrange(dest, 0, -1);
        expect(destList1).toEqual(["one"]);

        const result2 = await redis.lmove(source, dest, "RIGHT", "LEFT");
        expect(result2).toBe("three");

        const sourceList2 = await redis.lrange(source, 0, -1);
        expect(sourceList2).toEqual(["two"]);

        const destList2 = await redis.lrange(dest, 0, -1);
        expect(destList2).toEqual(["three", "one"]);
      });

      test("should handle all LMOVE direction combinations", async () => {
        const redis = ctx.redis;

        await redis.lpush("src1", "b", "a");
        const res1 = await redis.lmove("src1", "dst1", "LEFT", "LEFT");
        expect(res1).toBe("a");
        expect(await redis.lrange("dst1", 0, -1)).toEqual(["a"]);

        await redis.lpush("src2", "b", "a");
        const res2 = await redis.lmove("src2", "dst2", "LEFT", "RIGHT");
        expect(res2).toBe("a");
        expect(await redis.lrange("dst2", 0, -1)).toEqual(["a"]);

        await redis.lpush("src3", "b", "a");
        const res3 = await redis.lmove("src3", "dst3", "RIGHT", "LEFT");
        expect(res3).toBe("b");
        expect(await redis.lrange("dst3", 0, -1)).toEqual(["b"]);

        await redis.lpush("src4", "b", "a");
        const res4 = await redis.lmove("src4", "dst4", "RIGHT", "RIGHT");
        expect(res4).toBe("b");
        expect(await redis.lrange("dst4", 0, -1)).toEqual(["b"]);
      });

      test("should return null for LMOVE on empty source", async () => {
        const redis = ctx.redis;

        const result = await redis.lmove("empty-source", "some-dest", "LEFT", "RIGHT");
        expect(result).toBeNull();

        const destList = await redis.lrange("some-dest", 0, -1);
        expect(destList).toEqual([]);
      });

      test("should handle LMOVE to same list", async () => {
        const redis = ctx.redis;
        const key = "circular-list";

        await redis.lpush(key, "c", "b", "a");

        const result = await redis.lmove(key, key, "LEFT", "RIGHT");
        expect(result).toBe("a");
        expect(await redis.lrange(key, 0, -1)).toEqual(["b", "c", "a"]);
      });

      test("should pop from source and push to dest with RPOPLPUSH", async () => {
        const redis = ctx.redis;
        const source = "rpoplpush-source";
        const dest = "rpoplpush-dest";

        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");

        const result = await redis.rpoplpush(source, dest);
        expect(result).toBe("three");

        const sourceList = await redis.lrange(source, 0, -1);
        expect(sourceList).toEqual(["one", "two"]);

        const destList = await redis.lrange(dest, 0, -1);
        expect(destList).toEqual(["three"]);

        const result2 = await redis.rpoplpush(source, dest);
        expect(result2).toBe("two");

        const sourceList2 = await redis.lrange(source, 0, -1);
        expect(sourceList2).toEqual(["one"]);

        const destList2 = await redis.lrange(dest, 0, -1);
        expect(destList2).toEqual(["two", "three"]);
      });

      test("should return null for RPOPLPUSH on empty source", async () => {
        const redis = ctx.redis;

        const result = await redis.rpoplpush("empty-source", "some-dest");
        expect(result).toBeNull();
      });

      test("should handle RPOPLPUSH to same list (circular)", async () => {
        const redis = ctx.redis;
        const key = "circular-rpoplpush";

        await redis.lpush(key, "c", "b", "a");

        const result = await redis.rpoplpush(key, key);
        expect(result).toBe("c");
        expect(await redis.lrange(key, 0, -1)).toEqual(["c", "a", "b"]);
      });

      test("should block and move element with BLMOVE", async () => {
        const redis = ctx.redis;
        const source = "blmove-source";
        const dest = "blmove-dest";

        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");

        const result = await redis.blmove(source, dest, "RIGHT", "LEFT", 0.1);
        expect(result).toBe("three");

        const sourceRemaining = await redis.lrange(source, 0, -1);
        expect(sourceRemaining).toEqual(["one", "two"]);

        const destElements = await redis.lrange(dest, 0, -1);
        expect(destElements).toEqual(["three"]);

        const result2 = await redis.blmove(source, dest, "LEFT", "RIGHT", 0.1);
        expect(result2).toBe("one");

        const finalSource = await redis.lrange(source, 0, -1);
        expect(finalSource).toEqual(["two"]);

        const finalDest = await redis.lrange(dest, 0, -1);
        expect(finalDest).toEqual(["three", "one"]);
      });

      test("should timeout and return null with BLMOVE on empty list", async () => {
        const redis = ctx.redis;

        const result = await redis.blmove("empty-source", "dest", "LEFT", "RIGHT", 0.1);
        expect(result).toBeNull();
      });

      test("should block and pop multiple elements with BLMPOP", async () => {
        const redis = ctx.redis;
        const key = "blmpop-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const result = await redis.blmpop(0.1, 1, key, "LEFT");
        expect(result).toEqual([key, ["one"]]);

        const result2 = await redis.blmpop(0.1, 1, key, "RIGHT", "COUNT", 2);
        expect(result2).toEqual([key, ["three", "two"]]);

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual([]);
      });

      test("should pop from first non-empty list with BLMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "blmpop-empty";
        const key2 = "blmpop-full";

        await redis.lpush(key2, "value");

        const result = await redis.blmpop(0.1, 2, key1, key2, "LEFT");
        expect(result).toEqual([key2, ["value"]]);
      });

      test("should timeout and return null with BLMPOP on empty lists", async () => {
        const redis = ctx.redis;

        const result = await redis.blmpop(0.1, 2, "empty-list1", "empty-list2", "LEFT");
        expect(result).toBeNull();
      });

      test("should block and move element with BRPOPLPUSH", async () => {
        const redis = ctx.redis;
        const source = "brpoplpush-source";
        const dest = "brpoplpush-dest";

        await redis.lpush(source, "value2");
        await redis.lpush(source, "value1");

        const result = await redis.brpoplpush(source, dest, 0.1);
        expect(result).toBe("value2");

        const sourceRemaining = await redis.lrange(source, 0, -1);
        expect(sourceRemaining).toEqual(["value1"]);

        const destElements = await redis.lrange(dest, 0, -1);
        expect(destElements).toEqual(["value2"]);

        const result2 = await redis.brpoplpush(source, dest, 0.1);
        expect(result2).toBe("value1");

        const finalSource = await redis.lrange(source, 0, -1);
        expect(finalSource).toEqual([]);

        const finalDest = await redis.lrange(dest, 0, -1);
        expect(finalDest).toEqual(["value1", "value2"]);
      });

      test("should timeout and return null with BRPOPLPUSH on empty list", async () => {
        const redis = ctx.redis;

        const result = await redis.brpoplpush("empty-source", "dest", 0.1);
        expect(result).toBeNull();
      });

      test("should get list length with LLEN", async () => {
        const redis = ctx.redis;
        const key = "llen-test";

        const empty = await redis.llen(key);
        expect(empty).toBe(0);

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const length = await redis.llen(key);
        expect(length).toBe(3);

        const nonExistent = await redis.llen("nonexistent-list");
        expect(nonExistent).toBe(0);
      });

      test("should pop element from head with LPOP", async () => {
        const redis = ctx.redis;
        const key = "lpop-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const first = await redis.lpop(key);
        expect(first).toBe("one");

        const second = await redis.lpop(key);
        expect(second).toBe("two");

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["three"]);

        const last = await redis.lpop(key);
        expect(last).toBe("three");

        const empty = await redis.lpop(key);
        expect(empty).toBeNull();

        const nonExistent = await redis.lpop("nonexistent-list");
        expect(nonExistent).toBeNull();
      });

      test("should pop element from tail with RPOP", async () => {
        const redis = ctx.redis;
        const key = "rpop-test";

        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        const first = await redis.rpop(key);
        expect(first).toBe("three");

        const second = await redis.rpop(key);
        expect(second).toBe("two");

        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["one"]);

        const last = await redis.rpop(key);
        expect(last).toBe("one");

        const empty = await redis.rpop(key);
        expect(empty).toBeNull();

        const nonExistent = await redis.rpop("nonexistent-list");
        expect(nonExistent).toBeNull();
      });

      test("should push element to head only if key exists with LPUSHX", async () => {
        const redis = ctx.redis;
        const key = "lpushx-test";

        const nonExistent = await redis.lpushx(key, "value");
        expect(nonExistent).toBe(0);

        const exists = await redis.exists(key);
        expect(exists).toBe(false);

        await redis.lpush(key, "initial");

        const result = await redis.lpushx(key, "new");
        expect(result).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["new", "initial"]);

        const result2 = await redis.lpushx(key, "newer");
        expect(result2).toBe(3);

        const finalList = await redis.lrange(key, 0, -1);
        expect(finalList).toEqual(["newer", "new", "initial"]);
      });

      test("should push element to tail only if key exists with RPUSHX", async () => {
        const redis = ctx.redis;
        const key = "rpushx-test";

        const nonExistent = await redis.rpushx(key, "value");
        expect(nonExistent).toBe(0);

        const exists = await redis.exists(key);
        expect(exists).toBe(false);

        await redis.lpush(key, "initial");

        const result = await redis.rpushx(key, "new");
        expect(result).toBe(2);

        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["initial", "new"]);

        const result2 = await redis.rpushx(key, "newer");
        expect(result2).toBe(3);

        const finalList = await redis.lrange(key, 0, -1);
        expect(finalList).toEqual(["initial", "new", "newer"]);
      });
    });

    describe("Set Operations", () => {
      test("should get set cardinality with SCARD", async () => {
        const redis = ctx.redis;
        const key = "scard-test";

        const count1 = await redis.scard(key);
        expect(count1).toBe(0);

        await redis.sadd(key, "one", "two", "three");
        const count2 = await redis.scard(key);
        expect(count2).toBe(3);

        await redis.sadd(key, "two");
        const count3 = await redis.scard(key);
        expect(count3).toBe(3);
      });

      test("should get set difference with SDIFF", async () => {
        const redis = ctx.redis;
        const key1 = "sdiff-test1";
        const key2 = "sdiff-test2";

        await redis.sadd(key1, "a", "b", "c", "d");
        await redis.sadd(key2, "c", "d", "e");

        const diff = await redis.sdiff(key1, key2);
        expect(diff.sort()).toEqual(["a", "b"]);

        const diff2 = await redis.sdiff(key1, "nonexistent");
        expect(diff2.sort()).toEqual(["a", "b", "c", "d"]);
      });

      test("should check set membership with SISMEMBER", async () => {
        const redis = ctx.redis;
        const key = "sismember-test";

        await redis.sadd(key, "one", "two", "three");

        const result1 = await redis.sismember(key, "one");
        expect(result1).toBe(true);

        const result2 = await redis.sismember(key, "nonexistent");
        expect(result2).toBe(false);

        const result3 = await redis.sismember("nonexistent", "member");
        expect(result3).toBe(false);
      });

      test("should move member between sets with SMOVE", async () => {
        const redis = ctx.redis;
        const source = "smove-source";
        const dest = "smove-dest";

        await redis.sadd(source, "one", "two", "three");
        await redis.sadd(dest, "four");

        const result1 = await redis.smove(source, dest, "one");
        expect(result1).toBe(true);

        const sourceMembers = await redis.smembers(source);
        expect(sourceMembers.sort()).toEqual(["three", "two"]);

        const destMembers = await redis.smembers(dest);
        expect(destMembers.sort()).toEqual(["four", "one"]);

        const result2 = await redis.smove(source, dest, "nonexistent");
        expect(result2).toBe(false);
      });

      test("should pop random member with SPOP", async () => {
        const redis = ctx.redis;
        const key = "spop-test";

        await redis.sadd(key, "one", "two", "three", "four");

        const popped1 = await redis.spop(key);
        expect(["one", "two", "three", "four"]).toContain<string | null>(popped1);

        const remaining1 = await redis.scard(key);
        expect(remaining1).toBe(3);

        const popped2 = await redis.spop(key, 2);
        expect(Array.isArray(popped2)).toBe(true);
        expect(popped2).toBeDefined();
        expect(popped2!.length).toBe(2);

        const remaining2 = await redis.scard(key);
        expect(remaining2).toBe(1);

        await redis.spop(key);
        const empty = await redis.spop(key);
        expect(empty).toBeNull();
      });

      test("should publish to sharded channel with SPUBLISH", async () => {
        const redis = ctx.redis;

        const result = await redis.spublish("test-channel", "test-message");
        expect(typeof result).toBe("number");
        expect(result).toBeGreaterThanOrEqual(0);
      });

      test("should get random member with SRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "srandmember-test";

        await redis.sadd(key, "one", "two", "three");

        const member1 = await redis.srandmember(key);
        expect(["one", "two", "three"]).toContain<string | null>(member1);

        const members = await redis.srandmember(key, 2);
        expect(Array.isArray(members)).toBe(true);
        expect(members!.length).toBeLessThanOrEqual(2);

        const count = await redis.scard(key);
        expect(count).toBe(3);

        const empty = await redis.srandmember("nonexistent");
        expect(empty).toBeNull();
      });

      test("should remove members with SREM", async () => {
        const redis = ctx.redis;
        const key = "srem-test";

        await redis.sadd(key, "one", "two", "three", "four");

        const count1 = await redis.srem(key, "one");
        expect(count1).toBe(1);

        const count2 = await redis.srem(key, "two", "three");
        expect(count2).toBe(2);

        const remaining = await redis.smembers(key);
        expect(remaining).toEqual(["four"]);

        const count3 = await redis.srem(key, "nonexistent");
        expect(count3).toBe(0);
      });

      test("should get set union with SUNION", async () => {
        const redis = ctx.redis;
        const key1 = "sunion-test1";
        const key2 = "sunion-test2";

        await redis.sadd(key1, "a", "b", "c");
        await redis.sadd(key2, "c", "d", "e");

        const union = await redis.sunion(key1, key2);
        expect(union.sort()).toEqual(["a", "b", "c", "d", "e"]);

        const union2 = await redis.sunion(key1, "nonexistent");
        expect(union2.sort()).toEqual(["a", "b", "c"]);
      });

      test("should store set union with SUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "sunionstore-test1";
        const key2 = "sunionstore-test2";
        const dest = "sunionstore-dest";

        await redis.sadd(key1, "a", "b", "c");
        await redis.sadd(key2, "c", "d", "e");

        const count = await redis.sunionstore(dest, key1, key2);
        expect(count).toBe(5);

        const stored = await redis.smembers(dest);
        expect(stored.sort()).toEqual(["a", "b", "c", "d", "e"]);

        await redis.sadd(dest, "z");
        const count2 = await redis.sunionstore(dest, key1, key2);
        expect(count2).toBe(5);

        const stored2 = await redis.smembers(dest);
        expect(stored2.sort()).toEqual(["a", "b", "c", "d", "e"]);
        expect(stored2).not.toContain("z");
      });

      test("should return intersection of two sets with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const result = await redis.sinter(key1, key2);
        expect(result.sort()).toEqual(["b", "c"]);
      });

      test("should return intersection of multiple sets with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const key3 = "set3";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");
        await redis.sadd(key3, "c");
        await redis.sadd(key3, "d");
        await redis.sadd(key3, "e");

        const result = await redis.sinter(key1, key2, key3);
        expect(result).toEqual(["c"]);
      });

      test("should return empty array when sets have no intersection with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const result = await redis.sinter(key1, key2);
        expect(result).toEqual([]);
      });

      test("should return empty array when one set does not exist with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "nonexistent";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");

        const result = await redis.sinter(key1, key2);
        expect(result).toEqual([]);
      });

      test("should store intersection in destination with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(2);

        const members = await redis.smembers(dest);
        expect(members.sort()).toEqual(["b", "c"]);
      });

      test("should overwrite existing destination with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        await redis.sadd(dest, "old");
        await redis.sadd(dest, "data");

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");

        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(1);

        const members = await redis.smembers(dest);
        expect(members).toEqual(["b"]);
      });

      test("should return 0 when storing empty intersection with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        await redis.sadd(key1, "a");
        await redis.sadd(key2, "b");

        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(0);

        const members = await redis.smembers(dest);
        expect(members).toEqual([]);
      });

      test("should return cardinality of intersection with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const count = await redis.sintercard(2, key1, key2);
        expect(count).toBe(2);
      });

      test("should return 0 for empty intersection with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key2, "b");

        const count = await redis.sintercard(2, key1, key2);
        expect(count).toBe(0);
      });

      test("should support LIMIT option with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key1, "d");
        await redis.sadd(key2, "a");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const count = await redis.sintercard(2, key1, key2, "LIMIT", 2);
        expect(count).toBe(2);
      });

      test("should throw error when SINTER receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error
          await redis.sinter();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sinter' command"`);
      });

      test("should throw error when SINTERSTORE receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error
          await redis.sinterstore();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sinterstore' command"`);
      });

      test("should throw error when SINTERCARD receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error
          await redis.sintercard();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sintercard' command"`);
      });

      test("should store set difference with SDIFFSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const key3 = "set3";
        const dest = "diff-result";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key1, "d");

        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");

        await redis.sadd(key3, "d");

        const count1 = await redis.sdiffstore(dest, key1, key2);
        expect(count1).toBe(2);

        const members1 = await redis.smembers(dest);
        expect(members1.sort()).toEqual(["a", "d"]);

        const count2 = await redis.sdiffstore(dest, key1, key2, key3);
        expect(count2).toBe(1);

        const members2 = await redis.smembers(dest);
        expect(members2).toEqual(["a"]);
      });

      test("should throw error with SDIFFSTORE on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).sdiffstore();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sdiffstore' command"`);
      });

      test("should check multiple members with SMISMEMBER", async () => {
        const redis = ctx.redis;
        const key = "test-set";

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");

        const result = await redis.smismember(key, "a", "b", "d", "e");
        expect(result).toEqual([1, 1, 0, 0]);

        const result2 = await redis.smismember(key, "c");
        expect(result2).toEqual([1]);

        const result3 = await redis.smismember("nonexistent", "a", "b");
        expect(result3).toEqual([0, 0]);
      });

      test("should throw error with SMISMEMBER on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).smismember();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'smismember' command"`);
      });

      test("should scan set members with SSCAN", async () => {
        const redis = ctx.redis;
        const key = "scan-set";

        for (let i = 0; i < 20; i++) {
          await redis.sadd(key, `member${i}`);
        }

        let cursor = "0";
        const allMembers: string[] = [];

        do {
          const [nextCursor, members] = await redis.sscan(key, cursor);
          allMembers.push(...members);
          cursor = nextCursor;
        } while (cursor !== "0");

        expect(allMembers.length).toBe(20);
        expect(new Set(allMembers).size).toBe(20);

        for (let i = 0; i < 20; i++) {
          expect(allMembers).toContain(`member${i}`);
        }
      });

      test("should scan set with MATCH pattern using SSCAN", async () => {
        const redis = ctx.redis;
        const key = "scan-pattern-set";

        await redis.sadd(key, "user:1");
        await redis.sadd(key, "user:2");
        await redis.sadd(key, "user:3");
        await redis.sadd(key, "admin:1");
        await redis.sadd(key, "admin:2");

        const [cursor, members] = await redis.sscan(key, "0", "MATCH", "user:*");

        let allUserMembers: string[] = [...members];
        let scanCursor = cursor;

        while (scanCursor !== "0") {
          const [nextCursor, nextMembers] = await redis.sscan(key, scanCursor, "MATCH", "user:*");
          allUserMembers.push(...nextMembers);
          scanCursor = nextCursor;
        }

        const userMembers = allUserMembers.filter(m => m.startsWith("user:"));
        expect(userMembers.length).toBeGreaterThanOrEqual(0);
      });

      test("should scan empty set with SSCAN", async () => {
        const redis = ctx.redis;
        const key = "empty-scan-set";

        const [cursor, members] = await redis.sscan(key, "0");
        expect(cursor).toBe("0");
        expect(members).toEqual([]);
      });

      test("should throw error with SSCAN on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).sscan();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sscan' command"`);
      });

      test("should get cardinality of set with SCARD", async () => {
        const redis = ctx.redis;
        const key = "scard-test";

        const emptyCount = await redis.scard(key);
        expect(emptyCount).toBe(0);

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");

        const count = await redis.scard(key);
        expect(count).toBe(3);

        await redis.sadd(key, "a");
        const sameCount = await redis.scard(key);
        expect(sameCount).toBe(3);
      });

      test("should get difference of sets with SDIFF", async () => {
        const redis = ctx.redis;
        const key1 = "sdiff-test1";
        const key2 = "sdiff-test2";
        const key3 = "sdiff-test3";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key1, "d");

        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");

        await redis.sadd(key3, "d");

        const diff1 = await redis.sdiff(key1, key2);
        expect(diff1.sort()).toEqual(["a", "d"]);

        const diff2 = await redis.sdiff(key1, key2, key3);
        expect(diff2.sort()).toEqual(["a"]);

        const diff3 = await redis.sdiff(key1, "nonexistent");
        expect(diff3.sort()).toEqual(["a", "b", "c", "d"]);

        const diff4 = await redis.sdiff(key2, key1);
        expect(diff4).toEqual([]);
      });

      test("should check if member exists in set with SISMEMBER", async () => {
        const redis = ctx.redis;
        const key = "sismember-test";

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");

        const exists1 = await redis.sismember(key, "a");
        expect(exists1).toBe(true);

        const exists2 = await redis.sismember(key, "b");
        expect(exists2).toBe(true);

        const notExists = await redis.sismember(key, "z");
        expect(notExists).toBe(false);

        const notExistsSet = await redis.sismember("nonexistent", "a");
        expect(notExistsSet).toBe(false);
      });

      test("should move member between sets with SMOVE", async () => {
        const redis = ctx.redis;
        const source = "smove-source";
        const dest = "smove-dest";

        await redis.sadd(source, "a");
        await redis.sadd(source, "b");
        await redis.sadd(source, "c");

        await redis.sadd(dest, "x");
        await redis.sadd(dest, "y");

        const moved = await redis.smove(source, dest, "b");
        expect(moved).toBe(true);

        const sourceMembers = await redis.smembers(source);
        expect(sourceMembers.sort()).toEqual(["a", "c"]);

        const destMembers = await redis.smembers(dest);
        expect(destMembers.sort()).toEqual(["b", "x", "y"]);

        const notMoved = await redis.smove(source, dest, "z");
        expect(notMoved).toBe(false);

        const notMoved2 = await redis.smove("nonexistent", dest, "a");
        expect(notMoved2).toBe(false);
      });

      test("should remove and return random member with SPOP", async () => {
        const redis = ctx.redis;
        const key = "spop-test";

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");
        await redis.sadd(key, "d");
        await redis.sadd(key, "e");

        const popped = await redis.spop(key);
        expect(popped).toBeDefined();
        expect(["a", "b", "c", "d", "e"]).toContain<string | null>(popped);

        const remaining = await redis.scard(key);
        expect(remaining).toBe(4);

        const poppedMultiple = await redis.spop(key, 2);
        expect(Array.isArray(poppedMultiple)).toBe(true);
        expect(poppedMultiple!.length).toBe(2);
        poppedMultiple!.forEach(member => {
          expect(["a", "b", "c", "d", "e"]).toContain(member);
        });

        const remainingAfter = await redis.scard(key);
        expect(remainingAfter).toBe(2);

        await redis.spop(key, 10);
        const emptyPop = await redis.spop(key);
        expect(emptyPop).toBeNull();
      });

      test("should publish to sharded channel with SPUBLISH", async () => {
        const redis = ctx.redis;
        const channel = "spublish-channel";

        const count = await redis.spublish(channel, "test message");
        expect(typeof count).toBe("number");
        expect(count).toBe(0);
      });

      test("should get random member without removing with SRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "srandmember-test";

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");
        await redis.sadd(key, "d");
        await redis.sadd(key, "e");

        const random = await redis.srandmember(key);
        expect(random).toBeDefined();
        expect(["a", "b", "c", "d", "e"]).toContain<string | null>(random);

        const count = await redis.scard(key);
        expect(count).toBe(5);

        const randomMultiple = await redis.srandmember(key, 3);
        expect(Array.isArray(randomMultiple)).toBe(true);
        expect(randomMultiple!.length).toBe(3);
        randomMultiple!.forEach(member => {
          expect(["a", "b", "c", "d", "e"]).toContain(member);
        });

        const countAfter = await redis.scard(key);
        expect(countAfter).toBe(5);

        const tooMany = await redis.srandmember(key, 10);
        expect(Array.isArray(tooMany)).toBe(true);
        expect(tooMany!.length).toBe(5);

        const withDuplicates = await redis.srandmember(key, -10);
        expect(withDuplicates!.length).toBe(10);
        withDuplicates!.forEach(member => {
          expect(["a", "b", "c", "d", "e"]).toContain(member);
        });

        const emptyRandom = await redis.srandmember("nonexistent");
        expect(emptyRandom).toBeNull();
      });

      test("should remove members from set with SREM", async () => {
        const redis = ctx.redis;
        const key = "srem-test";

        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");
        await redis.sadd(key, "d");
        await redis.sadd(key, "e");

        const removed1 = await redis.srem(key, "a");
        expect(removed1).toBe(1);

        const members1 = await redis.smembers(key);
        expect(members1.sort()).toEqual(["b", "c", "d", "e"]);

        const removed2 = await redis.srem(key, "b", "c", "z");
        expect(removed2).toBe(2);

        const members2 = await redis.smembers(key);
        expect(members2.sort()).toEqual(["d", "e"]);

        const removed3 = await redis.srem(key, "nonexistent");
        expect(removed3).toBe(0);

        const removed4 = await redis.srem("nonexistent", "a");
        expect(removed4).toBe(0);
      });

      test("should get union of sets with SUNION", async () => {
        const redis = ctx.redis;
        const key1 = "sunion-test1";
        const key2 = "sunion-test2";
        const key3 = "sunion-test3";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");

        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");
        await redis.sadd(key2, "e");

        await redis.sadd(key3, "e");
        await redis.sadd(key3, "f");
        await redis.sadd(key3, "g");

        const union1 = await redis.sunion(key1, key2);
        expect(union1.sort()).toEqual(["a", "b", "c", "d", "e"]);

        const union2 = await redis.sunion(key1, key2, key3);
        expect(union2.sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);

        const union3 = await redis.sunion(key1, "nonexistent");
        expect(union3.sort()).toEqual(["a", "b", "c"]);

        const union4 = await redis.sunion("nonexistent1", "nonexistent2");
        expect(union4).toEqual([]);
      });

      test("should store union of sets with SUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "sunionstore-test1";
        const key2 = "sunionstore-test2";
        const key3 = "sunionstore-test3";
        const dest = "sunionstore-dest";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");

        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");
        await redis.sadd(key2, "e");

        await redis.sadd(key3, "e");
        await redis.sadd(key3, "f");

        const count1 = await redis.sunionstore(dest, key1, key2);
        expect(count1).toBe(5);

        const members1 = await redis.smembers(dest);
        expect(members1.sort()).toEqual(["a", "b", "c", "d", "e"]);

        const count2 = await redis.sunionstore(dest, key1, key2, key3);
        expect(count2).toBe(6);

        const members2 = await redis.smembers(dest);
        expect(members2.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);

        const count3 = await redis.sunionstore(dest, key1, "nonexistent");
        expect(count3).toBe(3);

        const members3 = await redis.smembers(dest);
        expect(members3.sort()).toEqual(["a", "b", "c"]);

        const count4 = await redis.sunionstore(dest, "nonexistent1", "nonexistent2");
        expect(count4).toBe(0);

        const members4 = await redis.smembers(dest);
        expect(members4).toEqual([]);
      });
    });

    describe("Sorted Set Operations", () => {
      test("should get cardinality with ZCARD", async () => {
        const redis = ctx.redis;
        const key = "zcard-test";

        const count1 = await redis.zcard(key);
        expect(count1).toBe(0);

        await redis.zadd(key, 1, "one", 2, "two", 3, "three");

        const count2 = await redis.zcard(key);
        expect(count2).toBe(3);

        await redis.zadd(key, 4, "one");
        const count3 = await redis.zcard(key);
        expect(count3).toBe(3);
      });

      test("should pop max with ZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-test";

        await redis.zadd(key, 1, "one", 2, "two", 3, "three", 4, "four");

        const result1 = await redis.zpopmax(key);
        expect(result1).toEqual(["four", 4]);

        const result2 = await redis.zpopmax(key, 2);
        expect(result2).toEqual([
          ["three", 3],
          ["two", 2],
        ]);

        const remaining = await redis.zcard(key);
        expect(remaining).toBe(1);

        await redis.zpopmax(key);
        const empty = await redis.zpopmax(key);
        expect(empty).toEqual([]);
      });

      test("should pop min with ZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-test";

        await redis.zadd(key, 1, "one", 2, "two", 3, "three", 4, "four");

        const result1 = await redis.zpopmin(key);
        expect(result1).toEqual(["one", 1]);

        const result2 = await redis.zpopmin(key, 2);
        expect(result2).toEqual([
          ["two", 2],
          ["three", 3],
        ]);

        const remaining = await redis.zcard(key);
        expect(remaining).toBe(1);

        await redis.zpopmin(key);
        const empty = await redis.zpopmin(key);
        expect(empty).toEqual([]);
      });

      test("should get random member with ZRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "zrandmember-test";

        await redis.zadd(key, 1, "one", 2, "two", 3, "three");

        const result1 = await redis.zrandmember(key);
        expect(result1).toBeDefined();
        expect(["one", "two", "three"]).toContain<string | null>(result1);

        const result2 = await redis.zrandmember(key, 2);
        expect(Array.isArray(result2)).toBe(true);
        expect(result2!.length).toBeLessThanOrEqual(2);

        result2!.forEach((member: string) => {
          expect(["one", "two", "three"]).toContain(member);
        });

        const result3 = await redis.zrandmember(key, 1, "WITHSCORES");

        expect<([string, number][] | null)[]>([[["one", 1]], [["two", 2]], [["three", 3]]]).toContainEqual(result3);

        const emptyKey = "zrandmember-empty-" + randomUUIDv7();
        const empty = await redis.zrandmember(emptyKey);
        expect(empty).toBeNull();
      });

      test("should get rank with ZRANK", async () => {
        const redis = ctx.redis;
        const key = "zrank-test";

        await redis.zadd(key, 1, "one", 2, "two", 3, "three");

        const rank1 = await redis.zrank(key, "one");
        expect(rank1).toBe(0);

        const rank2 = await redis.zrank(key, "two");
        expect(rank2).toBe(1);

        const rank3 = await redis.zrank(key, "three");
        expect(rank3).toBe(2);

        const rank4 = await redis.zrank(key, "nonexistent");
        expect(rank4).toBeNull();
      });

      test("should get reverse rank with ZREVRANK", async () => {
        const redis = ctx.redis;
        const key = "zrevrank-test";

        await redis.zadd(key, 1, "one", 2, "two", 3, "three");

        const rank1 = await redis.zrevrank(key, "three");
        expect(rank1).toBe(0);

        const rank2 = await redis.zrevrank(key, "two");
        expect(rank2).toBe(1);

        const rank3 = await redis.zrevrank(key, "one");
        expect(rank3).toBe(2);

        const rank4 = await redis.zrevrank(key, "nonexistent");
        expect(rank4).toBeNull();
      });

      test("should increment score with ZINCRBY", async () => {
        const redis = ctx.redis;
        const key = "zincrby-test";

        await redis.send("ZADD", [key, "1.0", "member1", "2.0", "member2"]);

        const newScore1 = await redis.zincrby(key, 2.5, "member1");
        expect(newScore1).toBe(3.5);

        const newScore2 = await redis.zincrby(key, -1.5, "member2");
        expect(newScore2).toBe(0.5);

        const newScore3 = await redis.zincrby(key, 5, "member3");
        expect(newScore3).toBe(5);
      });

      test("should count members in score range with ZCOUNT", async () => {
        const redis = ctx.redis;
        const key = "zcount-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const count1 = await redis.zcount(key, "-inf", "+inf");
        expect(count1).toBe(5);

        const count2 = await redis.zcount(key, 2, 4);
        expect(count2).toBe(3);

        const count3 = await redis.zcount(key, 1, 3);
        expect(count3).toBe(3);

        const count4 = await redis.zcount(key, 10, 20);
        expect(count4).toBe(0);
      });

      test("should count members in lexicographical range with ZLEXCOUNT", async () => {
        const redis = ctx.redis;
        const key = "zlexcount-test";

        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        const count1 = await redis.zlexcount(key, "-", "+");
        expect(count1).toBe(5);

        const count2 = await redis.zlexcount(key, "[banana", "[date");
        expect(count2).toBe(3);

        const count3 = await redis.zlexcount(key, "(banana", "(date");
        expect(count3).toBe(1);

        const count4 = await redis.zlexcount(key, "[zebra", "[zoo");
        expect(count4).toBe(0);
      });

      test("should compute difference between sorted sets with ZDIFF", async () => {
        const redis = ctx.redis;
        const key1 = "zdiff-test1";
        const key2 = "zdiff-test2";
        const key3 = "zdiff-test3";

        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three", "4", "four"]);
        await redis.send("ZADD", [key2, "1", "one", "2", "two"]);
        await redis.send("ZADD", [key3, "3", "three"]);

        const diff1 = await redis.zdiff(2, key1, key2);
        expect(diff1).toEqual(["three", "four"]);

        const diff2 = await redis.zdiff(3, key1, key2, key3);
        expect(diff2).toEqual(["four"]);

        const diff3 = await redis.zdiff(2, key1, key2, "WITHSCORES");
        expect(diff3).toEqual([
          ["three", 3],
          ["four", 4],
        ]);

        const diff4 = await redis.zdiff(2, key1, "nonexistent");
        expect(diff4.length).toBe(4);
        expect(diff4).toEqual(["one", "two", "three", "four"]);

        const diff5 = await redis.zdiff(2, key2, key1);
        expect(diff5).toEqual([]);
      });

      test("should store difference between sorted sets with ZDIFFSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zdiffstore-test1";
        const key2 = "zdiffstore-test2";
        const dest = "zdiffstore-dest";

        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three"]);
        await redis.send("ZADD", [key2, "1", "one"]);

        const count = await redis.zdiffstore(dest, 2, key1, key2);
        expect(count).toBe(2);

        const members = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(members).toEqual(["two", "three"]);

        const membersWithScores = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(membersWithScores).toEqual([
          ["two", 2],
          ["three", 3],
        ]);

        const count2 = await redis.zdiffstore(dest, 2, key2, key1);
        expect(count2).toBe(0);

        const finalCount = await redis.send("ZCARD", [dest]);
        expect(finalCount).toBe(0);
      });

      test("should count intersection with ZINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "zintercard-test1";
        const key2 = "zintercard-test2";
        const key3 = "zintercard-test3";

        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three"]);
        await redis.send("ZADD", [key2, "1", "one", "2", "two", "4", "four"]);
        await redis.send("ZADD", [key3, "1", "one", "5", "five"]);

        const count1 = await redis.zintercard(2, key1, key2);
        expect(count1).toBe(2);

        const count2 = await redis.zintercard(3, key1, key2, key3);
        expect(count2).toBe(1);

        const count3 = await redis.zintercard(2, key1, key2, "LIMIT", 1);
        expect(count3).toBe(1);

        const count4 = await redis.zintercard(2, key1, key3);
        expect(count4).toBe(1);

        const count5 = await redis.zintercard(2, key1, "nonexistent");
        expect(count5).toBe(0);
      });

      test("should reject invalid arguments in ZDIFF", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zdiff({} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zdiff'."`);
      });

      test("should reject invalid arguments in ZDIFFSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zdiffstore("dest", {} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zdiffstore'."`,
        );
      });

      test("should reject invalid arguments in ZINTERCARD", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zintercard({} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zintercard'."`,
        );
      });

      test("should remove members by rank with ZREMRANGEBYRANK", async () => {
        const redis = ctx.redis;
        const key = "zremrangebyrank-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const removed1 = await redis.zremrangebyrank(key, 0, 1);
        expect(removed1).toBe(2);

        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(3);

        const removed2 = await redis.zremrangebyrank(key, -1, -1);
        expect(removed2).toBe(1);

        const final = await redis.send("ZCARD", [key]);
        expect(final).toBe(2);
      });

      test("should remove members by score range with ZREMRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zremrangebyscore-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const removed1 = await redis.zremrangebyscore(key, 2, 4);
        expect(removed1).toBe(3);

        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(2);

        const removed2 = await redis.zremrangebyscore(key, "-inf", "+inf");
        expect(removed2).toBe(2);
      });

      test("should remove members by lexicographical range with ZREMRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zremrangebylex-test";

        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        const removed1 = await redis.zremrangebylex(key, "[banana", "[date");
        expect(removed1).toBe(3);

        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(2);

        const removed2 = await redis.zremrangebylex(key, "-", "+");
        expect(removed2).toBe(2);
      });

      test("should reject invalid key in ZINCRBY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zincrby({} as any, 1, "member");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zincrby'."`);
      });

      test("should reject invalid key in ZCOUNT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zcount([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zcount'."`);
      });

      test("should reject invalid key in ZLEXCOUNT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zlexcount(null as any, "[a", "[z");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zlexcount'."`);
      });

      test("should reject invalid key in ZREMRANGEBYRANK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebyrank({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zremrangebyrank'."`);
      });

      test("should reject invalid key in ZREMRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebyscore([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zremrangebyscore'."`);
      });

      test("should reject invalid key in ZREMRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebylex(null as any, "[a", "[z");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'zremrangebylex'."`);
      });

      test("should remove one or more members with ZREM", async () => {
        const redis = ctx.redis;
        const key = "zrem-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        const removed1 = await redis.zrem(key, "two");
        expect(removed1).toBe(1);

        const removed2 = await redis.zrem(key, "one", "three");
        expect(removed2).toBe(2);

        const removed3 = await redis.zrem(key, "nonexistent");
        expect(removed3).toBe(0);

        const removed4 = await redis.zrem(key, "four", "nothere");
        expect(removed4).toBe(1);
      });

      test("should get scores with ZMSCORE", async () => {
        const redis = ctx.redis;
        const key = "zmscore-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const scores1 = await redis.zmscore(key, "two");
        expect(scores1).toEqual([2.7]);

        const scores2 = await redis.zmscore(key, "one", "three");
        expect(scores2).toEqual([1.5, 3.9]);

        const scores3 = await redis.zmscore(key, "one", "nonexistent", "three");
        expect(scores3).toEqual([1.5, null, 3.9]);

        const scores4 = await redis.zmscore(key, "nothere", "alsonothere");
        expect(scores4).toEqual([null, null]);
      });

      test("should reject invalid key in ZREM", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrem({} as any, "member");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zrem'."`);
      });

      test("should reject invalid key in ZMSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zmscore([] as any, "member");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zmscore'."`,
        );
      });

      test("should add members to sorted set with ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-basic-test";

        const added1 = await redis.zadd(key, "1", "one");
        expect(added1).toBe(1);

        const added2 = await redis.zadd(key, "2", "two", "3", "three");
        expect(added2).toBe(2);

        const added3 = await redis.zadd(key, "1.5", "one");
        expect(added3).toBe(0);

        const score = await redis.zscore(key, "one");
        expect(score).toBe(1.5);
      });

      test("should add members with NX option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-nx-test";

        await redis.zadd(key, "1", "one");

        const added1 = await redis.zadd(key, "NX", "2", "one");
        expect(added1).toBe(0);

        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(1);

        const added2 = await redis.zadd(key, "NX", "2", "two");
        expect(added2).toBe(1);

        const score2 = await redis.zscore(key, "two");
        expect(score2).toBe(2);
      });

      test("should update members with XX option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-xx-test";

        await redis.zadd(key, "1", "one");

        const updated1 = await redis.zadd(key, "XX", "2", "one");
        expect(updated1).toBe(0);

        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(2);

        const added = await redis.zadd(key, "XX", "3", "three");
        expect(added).toBe(0);

        const score2 = await redis.zscore(key, "three");
        expect(score2).toBeNull();
      });

      test("should return changed count with CH option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-ch-test";

        await redis.zadd(key, "1", "one", "2", "two");

        const changed = await redis.zadd(key, "CH", "1.5", "one", "3", "three");
        expect(changed).toBe(2);
      });

      test("should increment score with INCR option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-incr-test";

        await redis.zadd(key, "1", "one");

        const newScore = await redis.zadd(key, "INCR", "2.5", "one");
        expect(newScore).toBe(3.5);

        const score = await redis.zscore(key, "one");
        expect(score).toBe(3.5);
      });

      test("should handle GT option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-gt-test";

        await redis.zadd(key, "5", "one");

        const updated1 = await redis.zadd(key, "GT", "3", "one");
        expect(updated1).toBe(0);

        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(5);

        const updated2 = await redis.zadd(key, "GT", "7", "one");
        expect(updated2).toBe(0);

        const score2 = await redis.zscore(key, "one");
        expect(score2).toBe(7);
      });

      test("should handle LT option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-lt-test";

        await redis.zadd(key, "5", "one");

        const updated1 = await redis.zadd(key, "LT", "7", "one");
        expect(updated1).toBe(0);

        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(5);

        const updated2 = await redis.zadd(key, "LT", "3", "one");
        expect(updated2).toBe(0);

        const score2 = await redis.zscore(key, "one");
        expect(score2).toBe(3);
      });

      test("should iterate sorted set with ZSCAN", async () => {
        const redis = ctx.redis;
        const key = "zscan-test";

        await redis.zadd(key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five");

        let cursor = "0";
        const allElements: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor);
          allElements.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        expect(allElements.length).toBe(10);

        const members = allElements.filter((_, index) => index % 2 === 0);
        expect(members).toContain("one");
        expect(members).toContain("two");
        expect(members).toContain("three");
        expect(members).toContain("four");
        expect(members).toContain("five");
      });

      test("should iterate sorted set with ZSCAN and MATCH", async () => {
        const redis = ctx.redis;
        const key = "zscan-match-test";

        await redis.zadd(key, "1", "user:1", "2", "user:2", "3", "post:1", "4", "post:2");

        let cursor = "0";
        const userElements: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor, "MATCH", "user:*");
          userElements.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        const members = userElements.filter((_, index) => index % 2 === 0);

        expect(members).toContain("user:1");
        expect(members).toContain("user:2");
        expect(members).not.toContain("post:1");
        expect(members).not.toContain("post:2");
      });

      test("should iterate sorted set with ZSCAN and COUNT", async () => {
        const redis = ctx.redis;
        const key = "zscan-count-test";

        const promises: Promise<number>[] = [];
        for (let i = 0; i < 100; i++) {
          promises.push(redis.zadd(key, String(i), `member:${i}`));
        }
        await Promise.all(promises);

        let cursor = "0";
        const allElements: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor, "COUNT", "10");
          allElements.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        expect(allElements.length).toBe(200);

        const members = allElements.filter((_, index) => index % 2 === 0);
        expect(members.length).toBe(100);
        for (let i = 0; i < 100; i++) {
          expect(members).toContain(`member:${i}`);
        }

        cursor = 0 as any;
        const allElements2: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor, "COUNT", "10");
          allElements2.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        expect(allElements2.length).toBe(200);
      });

      test("should reject invalid key in ZADD", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zadd({} as any, "1", "member");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zadd'."`);
      });

      test("should reject invalid key in ZSCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zscan([] as any, 0);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zscan'."`);
      });

      test("should return range of members with ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-basic-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const all = await redis.zrange(key, 0, -1);
        expect(all).toEqual(["one", "two", "three", "four", "five"]);

        const first3 = await redis.zrange(key, 0, 2);
        expect(first3).toEqual(["one", "two", "three"]);

        const last2 = await redis.zrange(key, -2, -1);
        expect(last2).toEqual(["four", "five"]);
      });

      test("should return members with scores using WITHSCORES option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-withscores-test";

        await redis.send("ZADD", [key, "1", "one", "2.5", "two", "3", "three"]);

        const result = await redis.zrange(key, 0, -1, "WITHSCORES");
        expect(result).toEqual([
          ["one", 1],
          ["two", 2.5],
          ["three", 3],
        ]);
      });

      test("should return members by score range with BYSCORE option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-byscore-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const range1 = await redis.zrange(key, "2", "4", "BYSCORE");
        expect(range1).toEqual(["two", "three", "four"]);

        const range2 = await redis.zrange(key, "(2", "4", "BYSCORE");
        expect(range2).toEqual(["three", "four"]);

        const all = await redis.zrange(key, "-inf", "+inf", "BYSCORE");
        expect(all).toEqual(["one", "two", "three", "four", "five"]);
      });

      test("should return members in reverse order with REV option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-rev-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        const reversed = await redis.zrange(key, 0, -1, "REV");
        expect(reversed).toEqual(["three", "two", "one"]);

        const top2 = await redis.zrange(key, 0, 1, "REV");
        expect(top2).toEqual(["three", "two"]);
      });

      test("should support LIMIT option with BYSCORE in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-limit-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result = await redis.zrange(key, "1", "5", "BYSCORE", "LIMIT", "1", "2");
        expect(result).toEqual(["two", "three"]);
      });

      test("should return members by lexicographical range with BYLEX option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-bylex-test";

        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date"]);

        const range1 = await redis.zrange(key, "[banana", "[cherry", "BYLEX");
        expect(range1).toEqual(["banana", "cherry"]);

        const range2 = await redis.zrange(key, "(banana", "(date", "BYLEX");
        expect(range2).toEqual(["cherry"]);
      });

      test("should return members in reverse order with ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const all = await redis.zrevrange(key, 0, -1);
        expect(all).toEqual(["five", "four", "three", "two", "one"]);

        const top3 = await redis.zrevrange(key, 0, 2);
        expect(top3).toEqual(["five", "four", "three"]);

        const last2 = await redis.zrevrange(key, -2, -1);
        expect(last2).toEqual(["two", "one"]);
      });

      test("should return members with scores using WITHSCORES option in ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-withscores-test";

        await redis.send("ZADD", [key, "1.5", "one", "2", "two", "3.7", "three"]);

        const result = await redis.zrevrange(key, 0, -1, "WITHSCORES");
        expect(result).toEqual([
          ["three", 3.7],
          ["two", 2],
          ["one", 1.5],
        ]);
      });

      test("should handle empty sorted set with ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-empty-test";

        const result = await redis.zrange(key, 0, -1);
        expect(result).toEqual([]);
      });

      test("should handle empty sorted set with ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-empty-test";

        const result = await redis.zrevrange(key, 0, -1);
        expect(result).toEqual([]);
      });

      test("should reject invalid key in ZRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrange({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zrange'."`);
      });

      test("should reject invalid key in ZREVRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrange([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrange'."`,
        );
      });
      test("should return members by score range with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const all = await redis.zrangebyscore(key, "-inf", "+inf");
        expect(all).toEqual(["one", "two", "three", "four", "five"]);

        const range1 = await redis.zrangebyscore(key, 2, 4);
        expect(range1).toEqual(["two", "three", "four"]);

        const range2 = await redis.zrangebyscore(key, "(2", 4);
        expect(range2).toEqual(["three", "four"]);

        const range3 = await redis.zrangebyscore(key, 2, "(4");
        expect(range3).toEqual(["two", "three"]);

        const range4 = await redis.zrangebyscore(key, "(2", "(4");
        expect(range4).toEqual(["three"]);
      });

      test("should support WITHSCORES option with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-withscores-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const result = await redis.zrangebyscore(key, 1, 3, "WITHSCORES");
        expect(result).toEqual([
          ["one", 1.5],
          ["two", 2.7],
        ]);
      });

      test("should support LIMIT option with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-limit-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const limited1 = await redis.zrangebyscore(key, "-inf", "+inf", "LIMIT", 0, 2);
        expect(limited1).toEqual(["one", "two"]);

        const limited2 = await redis.zrangebyscore(key, "-inf", "+inf", "LIMIT", 1, 2);
        expect(limited2).toEqual(["two", "three"]);

        const limited3 = await redis.zrangebyscore(key, 2, 5, "LIMIT", 1, 2);
        expect(limited3).toEqual(["three", "four"]);
      });

      test("should support WITHSCORES with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-withscores-only-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES");
        expect(result).toEqual([
          ["one", 1],
          ["two", 2],
          ["three", 3],
          ["four", 4],
        ]);
      });

      test("should support LIMIT and WITHSCORES together with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-combined-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", 1, 2);
        expect(result).toEqual([
          ["two", 2],
          ["three", 3],
        ]);
      });

      test("should return members by score range in reverse with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const all = await redis.zrevrangebyscore(key, "+inf", "-inf");
        expect(all).toEqual(["five", "four", "three", "two", "one"]);

        const range1 = await redis.zrevrangebyscore(key, 4, 2);
        expect(range1).toEqual(["four", "three", "two"]);

        const range2 = await redis.zrevrangebyscore(key, "(4", "(2");
        expect(range2).toEqual(["three"]);

        const range3 = await redis.zrevrangebyscore(key, 4, "(2");
        expect(range3).toEqual(["four", "three"]);
      });

      test("should support WITHSCORES option with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-withscores-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const result = await redis.zrevrangebyscore(key, 3, 1, "WITHSCORES");
        expect(result).toEqual([
          ["two", 2.7],
          ["one", 1.5],
        ]);
      });

      test("should support LIMIT option with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-limit-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const limited1 = await redis.zrevrangebyscore(key, "+inf", "-inf", "LIMIT", 0, 2);
        expect(limited1).toEqual(["five", "four"]);

        const limited2 = await redis.zrevrangebyscore(key, "+inf", "-inf", "LIMIT", 1, 2);
        expect(limited2).toEqual(["four", "three"]);
      });

      test("should return members by lexicographical range with ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrangebylex-test";

        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        const all = await redis.zrangebylex(key, "-", "+");
        expect(all).toEqual(["apple", "banana", "cherry", "date", "elderberry"]);

        const range1 = await redis.zrangebylex(key, "[banana", "[date");
        expect(range1).toEqual(["banana", "cherry", "date"]);

        const range2 = await redis.zrangebylex(key, "(banana", "(date");
        expect(range2).toEqual(["cherry"]);

        const range3 = await redis.zrangebylex(key, "[banana", "(date");
        expect(range3).toEqual(["banana", "cherry"]);

        const range4 = await redis.zrangebylex(key, "-", "[cherry");
        expect(range4).toEqual(["apple", "banana", "cherry"]);

        const range5 = await redis.zrangebylex(key, "[cherry", "+");
        expect(range5).toEqual(["cherry", "date", "elderberry"]);
      });

      test("should support LIMIT option with ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrangebylex-limit-test";

        await redis.send("ZADD", [key, "0", "a", "0", "b", "0", "c", "0", "d", "0", "e", "0", "f", "0", "g"]);

        const limited1 = await redis.zrangebylex(key, "-", "+", "LIMIT", 0, 3);
        expect(limited1).toEqual(["a", "b", "c"]);

        const limited2 = await redis.zrangebylex(key, "-", "+", "LIMIT", 2, 3);
        expect(limited2).toEqual(["c", "d", "e"]);

        const limited3 = await redis.zrangebylex(key, "-", "+", "LIMIT", 5, 10);
        expect(limited3).toEqual(["f", "g"]);
      });

      test("should get cardinality of sorted set with ZCARD", async () => {
        const redis = ctx.redis;
        const key = "zcard-test";

        const count0 = await redis.zcard(key);
        expect(count0).toBe(0);

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        const count1 = await redis.zcard(key);
        expect(count1).toBe(3);

        await redis.send("ZADD", [key, "4", "four", "5", "five"]);

        const count2 = await redis.zcard(key);
        expect(count2).toBe(5);
      });

      test("should pop member with lowest score using ZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result1 = await redis.zpopmin(key);
        expect(result1).toEqual(["one", 1]);

        const result2 = await redis.zpopmin(key);
        expect(result2).toEqual(["two", 2]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(3);
      });

      test("should pop multiple members with ZPOPMIN using COUNT", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-count-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result = await redis.zpopmin(key, 3);
        expect(result).toEqual([
          ["one", 1],
          ["two", 2],
          ["three", 3],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should return empty array when ZPOPMIN on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "zpopmin-empty-test";

        const result = await redis.zpopmin(emptyKey);
        expect(result).toEqual([]);
      });

      test("should return empty array when ZPOPMIN on non-existent key", async () => {
        const redis = ctx.redis;
        const nonExistentKey = "zpopmin-nonexistent-" + randomUUIDv7();

        const result = await redis.zpopmin(nonExistentKey);
        expect(result).toEqual([]);
      });

      test("should handle ties in score with ZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-tie-test";

        await redis.send("ZADD", [key, "1", "a", "1", "b", "1", "c", "2", "d"]);

        const result = await redis.zpopmin(key, 2);
        expect(result).toEqual([
          ["a", 1],
          ["b", 1],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should pop member with highest score using ZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result1 = await redis.zpopmax(key);
        expect(result1).toEqual(["five", 5]);

        const result2 = await redis.zpopmax(key);
        expect(result2).toEqual(["four", 4]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(3);
      });

      test("should pop multiple members with ZPOPMAX using COUNT", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-count-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result = await redis.zpopmax(key, 3);
        expect(result).toEqual([
          ["five", 5],
          ["four", 4],
          ["three", 3],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should return empty array when ZPOPMAX on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "zpopmax-empty-test";

        const result = await redis.zpopmax(emptyKey);
        expect(result).toEqual([]);
      });

      test("should return empty array when ZPOPMAX on non-existent key", async () => {
        const redis = ctx.redis;
        const nonExistentKey = "zpopmax-nonexistent-" + randomUUIDv7();
        const result = await redis.zpopmax(nonExistentKey);
        expect(result).toEqual([]);
      });

      test("should handle ties in score with ZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-tie-test";

        await redis.send("ZADD", [key, "1", "a", "2", "b", "2", "c", "2", "d"]);

        const result = await redis.zpopmax(key, 2);
        expect(result).toEqual([
          ["d", 2],
          ["c", 2],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should get random member with ZRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "zrandmember-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result = await redis.zrandmember(key);
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
        expect(["one", "two", "three", "four", "five"]).toContain<string | null>(result);
      });

      test("should return null when ZRANDMEMBER on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "zrandmember-empty-test";

        const result = await redis.zrandmember(emptyKey);
        expect(result).toBeNull();
      });

      test("should get multiple random members with ZRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "zrandmember-count-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        const result = await redis.zrandmember(key, 2);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result!.length).toBe(2);

        for (const member of result!) {
          expect(["one", "two", "three"]).toContain(member);
        }

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(3);
      });

      test("should get random members with scores using WITHSCORES in ZRANDMEMBER", async () => {
        const redis = ctx.redis;
        const key = "zrandmember-withscores-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const result = await redis.zrandmember(key, 2, "WITHSCORES");
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result!.length).toBe(2);

        for (const item of result!) {
          expect(Array.isArray(item)).toBe(true);
          expect(item.length).toBe(2);
          expect(typeof item[0]).toBe("string");
          expect(typeof item[1]).toBe("number");
          expect(["one", "two", "three"]).toContain(item[0]);
        }
      });

      test("should allow negative count for ZRANDMEMBER to allow duplicates", async () => {
        const redis = ctx.redis;
        const key = "zrandmember-negative-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two"]);

        const result = await redis.zrandmember(key, -5);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result!.length).toBe(5);

        for (const member of result!) {
          expect(["one", "two"]).toContain(member);
        }
      });

      test("should get rank of member with ZRANK", async () => {
        const redis = ctx.redis;
        const key = "zrank-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const rank1 = await redis.zrank(key, "one");
        expect(rank1).toBe(0);

        const rank2 = await redis.zrank(key, "three");
        expect(rank2).toBe(2);

        const rank3 = await redis.zrank(key, "five");
        expect(rank3).toBe(4);

        const rank4 = await redis.zrank(key, "nonexistent");
        expect(rank4).toBeNull();
      });

      test("should get rank with score using WITHSCORE in ZRANK", async () => {
        const redis = ctx.redis;
        const key = "zrank-withscore-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const result = await redis.zrank(key, "two", "WITHSCORE");
        expect(result).toEqual([1, 2.7]);

        const result2 = await redis.zrank(key, "one", "WITHSCORE");
        expect(result2).toEqual([0, 1.5]);

        const result3 = await redis.zrank(key, "nonexistent", "WITHSCORE");
        expect(result3).toBeNull();
      });

      test("should handle ties in score with ZRANK", async () => {
        const redis = ctx.redis;
        const key = "zrank-tie-test";

        await redis.send("ZADD", [key, "1", "a", "1", "b", "1", "c", "2", "d"]);

        const rankA = await redis.zrank(key, "a");
        expect(rankA).toBe(0);

        const rankB = await redis.zrank(key, "b");
        expect(rankB).toBe(1);

        const rankC = await redis.zrank(key, "c");
        expect(rankC).toBe(2);

        const rankD = await redis.zrank(key, "d");
        expect(rankD).toBe(3);
      });

      test("should get reverse rank of member with ZREVRANK", async () => {
        const redis = ctx.redis;
        const key = "zrevrank-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const rank1 = await redis.zrevrank(key, "five");
        expect(rank1).toBe(0);

        const rank2 = await redis.zrevrank(key, "three");
        expect(rank2).toBe(2);

        const rank3 = await redis.zrevrank(key, "one");
        expect(rank3).toBe(4);

        const rank4 = await redis.zrevrank(key, "nonexistent");
        expect(rank4).toBeNull();
      });

      test("should get reverse rank with score using WITHSCORE in ZREVRANK", async () => {
        const redis = ctx.redis;
        const key = "zrevrank-withscore-test";

        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        const result = await redis.zrevrank(key, "two", "WITHSCORE");
        expect(result).toEqual([1, 2.7]);

        const result2 = await redis.zrevrank(key, "three", "WITHSCORE");
        expect(result2).toEqual([0, 3.9]);

        const result3 = await redis.zrevrank(key, "nonexistent", "WITHSCORE");
        expect(result3).toBeNull();
      });

      test("should handle ties in score with ZREVRANK", async () => {
        const redis = ctx.redis;
        const key = "zrevrank-tie-test";

        await redis.send("ZADD", [key, "1", "a", "2", "b", "2", "c", "2", "d"]);

        const rankD = await redis.zrevrank(key, "d");
        expect(rankD).toBe(0);

        const rankC = await redis.zrevrank(key, "c");
        expect(rankC).toBe(1);

        const rankB = await redis.zrevrank(key, "b");
        expect(rankB).toBe(2);

        const rankA = await redis.zrevrank(key, "a");
        expect(rankA).toBe(3);
      });
      test("should reject invalid key in ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangebyscore({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangebyscore'."`,
        );
      });

      test("should reject invalid key in ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrangebyscore([] as any, 10, 0);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrangebyscore'."`,
        );
      });

      test("should reject invalid key in ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangebylex(null as any, "-", "+");
        }).toThrowErrorMatchingInlineSnapshot(`"The "key" argument must be specified"`);
      });

      test("should return members in reverse lexicographical order with ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebylex-test";

        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        const all = await redis.zrevrangebylex(key, "+", "-");
        expect(all).toEqual(["elderberry", "date", "cherry", "banana", "apple"]);

        const range1 = await redis.zrevrangebylex(key, "[date", "[banana");
        expect(range1).toEqual(["date", "cherry", "banana"]);

        const range2 = await redis.zrevrangebylex(key, "(date", "(banana");
        expect(range2).toEqual(["cherry"]);

        const range3 = await redis.zrevrangebylex(key, "[elderberry", "(cherry");
        expect(range3).toEqual(["elderberry", "date"]);
      });

      test("should support LIMIT option with ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebylex-limit-test";

        await redis.send("ZADD", [key, "0", "a", "0", "b", "0", "c", "0", "d", "0", "e", "0", "f", "0", "g"]);

        const limited1 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "0", "3");
        expect(limited1).toEqual(["g", "f", "e"]);

        const limited2 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "2", "3");
        expect(limited2).toEqual(["e", "d", "c"]);

        const limited3 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "5", "10");
        expect(limited3).toEqual(["b", "a"]);
      });

      test("should store range of members with ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-source";
        const dest = "zrangestore-dest";

        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const count1 = await redis.zrangestore(dest, source, 1, 3);
        expect(count1).toBe(3);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["two", "three", "four"]);
      });

      test("should store range with BYSCORE option in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-byscore-source";
        const dest = "zrangestore-byscore-dest";

        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const count = await redis.zrangestore(dest, source, "2", "4", "BYSCORE");
        expect(count).toBe(3);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["two", 2],
          ["three", 3],
          ["four", 4],
        ]);
      });

      test("should store range in reverse order with REV option in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-rev-source";
        const dest = "zrangestore-rev-dest";

        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three"]);

        const count = await redis.zrangestore(dest, source, "0", "-1", "REV");
        expect(count).toBe(3);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["one", "two", "three"]);
      });

      test("should support LIMIT option with ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-limit-source";
        const dest = "zrangestore-limit-dest";

        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const count = await redis.zrangestore(dest, source, "-inf", "+inf", "BYSCORE", "LIMIT", "1", "2");
        expect(count).toBe(2);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["two", "three"]);
      });

      test("should reject invalid key in ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrangebylex({} as any, "+", "-");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrangebylex'."`,
        );
      });

      test("should reject invalid destination in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangestore([] as any, "source", 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangestore'."`,
        );
      });

      test("should reject invalid source in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangestore("dest", null as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangestore'."`,
        );
      });

      test("should compute intersection with ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-test-1";
        const key2 = "zinter-test-2";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        const result1 = await redis.zinter(2, key1, key2);
        expect(result1).toEqual(["b", "c"]);

        const result2 = await redis.zinter(2, key1, key2, "WITHSCORES");
        expect(result2).toEqual([
          ["b", 3],
          ["c", 5],
        ]);
      });

      test("should compute intersection with WEIGHTS in ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-weights-1";
        const key2 = "zinter-weights-2";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        const result = await redis.zinter(2, key1, key2, "WEIGHTS", "2", "3", "WITHSCORES");
        expect(result).toEqual([
          ["b", 7],
          ["c", 12],
        ]);
      });

      test("should compute intersection with AGGREGATE in ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-agg-1";
        const key2 = "zinter-agg-2";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        const result1 = await redis.zinter(2, key1, key2, "AGGREGATE", "MIN", "WITHSCORES");
        expect(result1).toEqual([
          ["b", 1],
          ["c", 2],
        ]);

        const result2 = await redis.zinter(2, key1, key2, "AGGREGATE", "MAX", "WITHSCORES");
        expect(result2).toEqual([
          ["b", 2],
          ["c", 3],
        ]);
      });

      test("should handle empty intersection with ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-empty-1";
        const key2 = "zinter-empty-2";

        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "1", "c", "2", "d");

        const result = await redis.zinter(2, key1, key2);
        expect(result).toEqual([]);
      });

      test("should store intersection with ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-test-1";
        const key2 = "zinterstore-test-2";
        const dest = "zinterstore-dest";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        const count = await redis.zinterstore(dest, 2, key1, key2);
        expect(count).toBe(2);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["b", 3],
          ["c", 5],
        ]);
      });

      test("should store intersection with WEIGHTS in ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-weights-1";
        const key2 = "zinterstore-weights-2";
        const dest = "zinterstore-weights-dest";

        await redis.zadd(key1, "1", "x", "2", "y");
        await redis.zadd(key2, "2", "x", "3", "y");

        const count = await redis.zinterstore(dest, 2, key1, key2, "WEIGHTS", "2", "3");
        expect(count).toBe(2);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["x", 8],
          ["y", 13],
        ]);
      });

      test("should store intersection with AGGREGATE in ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-agg-1";
        const key2 = "zinterstore-agg-2";
        const destMin = "zinterstore-agg-min";
        const destMax = "zinterstore-agg-max";

        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        const count1 = await redis.zinterstore(destMin, 2, key1, key2, "AGGREGATE", "MIN");
        expect(count1).toBe(2);
        const storedMin = await redis.send("ZRANGE", [destMin, "0", "-1", "WITHSCORES"]);
        expect(storedMin).toEqual([
          ["m", 1],
          ["n", 1],
        ]);

        const count2 = await redis.zinterstore(destMax, 2, key1, key2, "AGGREGATE", "MAX");
        expect(count2).toBe(2);
        const storedMax = await redis.send("ZRANGE", [destMax, "0", "-1", "WITHSCORES"]);
        expect(storedMax).toEqual([
          ["m", 2],
          ["n", 3],
        ]);
      });

      test("should handle empty result with ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-empty-1";
        const key2 = "zinterstore-empty-2";
        const dest = "zinterstore-empty-dest";

        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "1", "c", "2", "d");

        const count = await redis.zinterstore(dest, 2, key1, key2);
        expect(count).toBe(0);

        const exists = await redis.exists(dest);
        expect(exists).toBe(false);
      });

      test("should compute union with ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-test-1";
        const key2 = "zunion-test-2";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "4", "b", "5", "c", "6", "d");

        const result1 = await redis.zunion(2, key1, key2);
        expect(result1).toEqual(["a", "b", "d", "c"]);

        const result2 = await redis.zunion(2, key1, key2, "WITHSCORES");
        expect(result2).toEqual([
          ["a", 1],
          ["b", 6],
          ["d", 6],
          ["c", 8],
        ]);
      });

      test("should compute union with WEIGHTS in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-weights-1";
        const key2 = "zunion-weights-2";

        await redis.zadd(key1, "1", "x", "2", "y", "3", "z");
        await redis.zadd(key2, "2", "y", "3", "z", "4", "w");

        const result = await redis.zunion(2, key1, key2, "WEIGHTS", "2", "3", "WITHSCORES");
        expect(result).toEqual([
          ["x", 2],
          ["y", 10],
          ["w", 12],
          ["z", 15],
        ]);
      });

      test("should compute union with AGGREGATE MIN in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-min-1";
        const key2 = "zunion-min-2";

        await redis.zadd(key1, "1", "p", "3", "q");
        await redis.zadd(key2, "2", "p", "1", "q");

        const result = await redis.zunion(2, key1, key2, "AGGREGATE", "MIN", "WITHSCORES");
        expect(result).toEqual([
          ["p", 1],
          ["q", 1],
        ]);
      });

      test("should compute union with AGGREGATE MAX in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-max-1";
        const key2 = "zunion-max-2";

        await redis.zadd(key1, "1", "r", "3", "s");
        await redis.zadd(key2, "2", "r", "1", "s");

        const result = await redis.zunion(2, key1, key2, "AGGREGATE", "MAX", "WITHSCORES");
        expect(result).toEqual([
          ["r", 2],
          ["s", 3],
        ]);
      });

      test("should compute union with single set in ZUNION", async () => {
        const redis = ctx.redis;
        const key = "zunion-single";

        await redis.zadd(key, "1", "one", "2", "two", "3", "three");

        const result = await redis.zunion(1, key);
        expect(result).toEqual(["one", "two", "three"]);
      });

      test("should compute union with three sets in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-three-1";
        const key2 = "zunion-three-2";
        const key3 = "zunion-three-3";

        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "2", "b", "3", "c");
        await redis.zadd(key3, "3", "c", "4", "d");

        const result = await redis.zunion(3, key1, key2, key3, "WITHSCORES");
        expect(result).toEqual([
          ["a", 1],
          ["b", 4],
          ["d", 4],
          ["c", 6],
        ]);
      });

      test("should handle empty set in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-empty-1";
        const key2 = "zunion-empty-2";

        await redis.zadd(key1, "1", "a", "2", "b");

        const result = await redis.zunion(2, key1, key2);
        expect(result).toEqual(["a", "b"]);
      });

      test("should store union with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-test-1";
        const key2 = "zunionstore-test-2";
        const dest = "zunionstore-dest";

        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "4", "b", "5", "c", "6", "d");

        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(4);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["a", 1],
          ["b", 6],
          ["d", 6],
          ["c", 8],
        ]);
      });

      test("should store union with WEIGHTS in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-weights-1";
        const key2 = "zunionstore-weights-2";
        const dest = "zunionstore-weights-dest";

        await redis.zadd(key1, "1", "x", "2", "y");
        await redis.zadd(key2, "2", "x", "3", "y");

        const count = await redis.zunionstore(dest, 2, key1, key2, "WEIGHTS", "2", "3");
        expect(count).toBe(2);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["x", 8],
          ["y", 13],
        ]);
      });

      test("should store union with AGGREGATE MIN in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-agg-min-1";
        const key2 = "zunionstore-agg-min-2";
        const dest = "zunionstore-agg-min-dest";

        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        const count = await redis.zunionstore(dest, 2, key1, key2, "AGGREGATE", "MIN");
        expect(count).toBe(2);
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["m", 1],
          ["n", 1],
        ]);
      });

      test("should store union with AGGREGATE MAX in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-agg-max-1";
        const key2 = "zunionstore-agg-max-2";
        const dest = "zunionstore-agg-max-dest";

        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        const count = await redis.zunionstore(dest, 2, key1, key2, "AGGREGATE", "MAX");
        expect(count).toBe(2);
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["m", 2],
          ["n", 3],
        ]);
      });

      test("should overwrite existing destination with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-overwrite-1";
        const key2 = "zunionstore-overwrite-2";
        const dest = "zunionstore-overwrite-dest";

        await redis.zadd(dest, "100", "old");

        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "3", "c");

        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(3);

        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["a", "b", "c"]);
        expect(stored).not.toContain("old");
      });

      test("should handle empty sets with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-empty-1";
        const key2 = "zunionstore-empty-2";
        const dest = "zunionstore-empty-dest";

        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(0);

        const exists = await redis.exists(dest);
        expect(exists).toBe(false);
      });

      test("should reject invalid numkeys in ZUNION", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunion(-1, "key1");
        }).toThrowErrorMatchingInlineSnapshot(`"ERR at least 1 input key is needed for 'zunion' command"`);
      });

      test("should reject invalid key in ZUNION", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunion(1, {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zunion'."`);
      });

      test("should reject invalid destination in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunionstore([] as any, 2, "key1", "key2");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zunionstore'."`,
        );
      });

      test("should reject invalid source key in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunionstore("dest", 2, "key1", null as any);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zunionstore'."`,
        );
      });

      test("should pop members with MIN option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-min-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result1 = await redis.zmpop(1, key, "MIN");
        expect(result1).toEqual([key, [["one", 1]]]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(4);
      });

      test("should pop members with MAX option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-max-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result1 = await redis.zmpop(1, key, "MAX");
        expect(result1).toEqual([key, [["five", 5]]]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(4);
      });

      test("should pop multiple members with COUNT option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-count-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        const result = await redis.zmpop(1, key, "MIN", "COUNT", 3);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key);
        expect(result![1]).toEqual([
          ["one", 1],
          ["two", 2],
          ["three", 3],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should return null when ZMPOP on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "zmpop-empty-test";

        const result = await redis.zmpop(1, emptyKey, "MIN");
        expect(result).toBeNull();
      });

      test("should pop from first non-empty set with ZMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "zmpop-multi-test1";
        const key2 = "zmpop-multi-test2";
        const key3 = "zmpop-multi-test3";

        await redis.send("ZADD", [key2, "1", "one", "2", "two"]);

        const result = await redis.zmpop(3, key1, key2, key3, "MIN");
        expect(result).toEqual([key2, [["one", 1]]]);
      });

      test("should block and pop with BZMPOP", async () => {
        const redis = ctx.redis;
        const key = "bzmpop-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two"]);

        const result = await redis.bzmpop(0.1, 1, key, "MIN");
        expect(result).toEqual([key, [["one", 1]]]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(1);
      });

      test("should timeout with BZMPOP on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "bzmpop-timeout-test";

        const result = await redis.bzmpop(0.1, 1, emptyKey, "MIN");
        expect(result).toBeNull();
      });

      test("should block and pop multiple members with BZMPOP COUNT", async () => {
        const redis = ctx.redis;
        const key = "bzmpop-count-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        const result = await redis.bzmpop(0.5, 1, key, "MAX", "COUNT", 2);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key);
        expect(result![1]).toEqual([
          ["three", 3],
          ["two", 2],
        ]);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(1);
      });

      test("should reject invalid arguments in ZMPOP", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zmpop({} as any, "key1", "MIN");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zmpop'."`);
      });

      test("should reject invalid arguments in BZMPOP", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzmpop(1, {} as any, "key1", "MIN");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'bzmpop'."`);
      });

      test("should pop member with highest score using ZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-test";

        await redis.zadd(key, 1.0, "one", 2.0, "two", 3.0, "three");

        const result = await redis.zpopmax(key);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result![0]).toBe("three");
        expect(result![1]).toBe(3);

        const count = await redis.zcard(key);
        expect(count).toBe(2);
      });

      test("should pop member with lowest score using ZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-test";

        await redis.zadd(key, 1.0, "one", 2.0, "two", 3.0, "three");

        const result = await redis.zpopmin(key);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result![0]).toBe("one");
        expect(result![1]).toBe(1);

        const count = await redis.zcard(key);
        expect(count).toBe(2);
      });

      test("should return empty array for ZPOPMAX on empty set", async () => {
        const redis = ctx.redis;
        const key = "zpopmax-empty-test";

        const result = await redis.zpopmax(key);
        expect(result).toEqual([]);
      });

      test("should return empty array for ZPOPMIN on empty set", async () => {
        const redis = ctx.redis;
        const key = "zpopmin-empty-test";

        const result = await redis.zpopmin(key);
        expect(result).toEqual([]);
      });

      test("should block and pop lowest score with BZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "bzpopmin-test";

        await redis.send("ZADD", [key, "1.0", "one", "2.0", "two", "3.0", "three"]);

        const result = await redis.bzpopmin(key, 0.1);
        expect(result).toBeDefined();
        expect(result).toHaveLength(3);
        expect(result![0]).toBe(key);
        expect(result![1]).toBe("one");
        expect(result![2]).toBe(1);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should timeout with BZPOPMIN when no elements available", async () => {
        const redis = ctx.redis;
        const key = "bzpopmin-empty-test";

        const result = await redis.bzpopmin(key, 0.1);
        expect(result).toBeNull();
      });

      test("should block and pop highest score with BZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "bzpopmax-test";

        await redis.send("ZADD", [key, "1.0", "one", "2.0", "two", "3.0", "three"]);

        const result = await redis.bzpopmax(key, 0.1);
        expect(result).toBeDefined();
        expect(result).toHaveLength(3);
        expect(result![0]).toBe(key);
        expect(result![1]).toBe("three");
        expect(result![2]).toBe(3);

        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should timeout with BZPOPMAX when no elements available", async () => {
        const redis = ctx.redis;
        const key = "bzpopmax-empty-test";

        const result = await redis.bzpopmax(key, 0.1);
        expect(result).toBeNull();
      });

      test("should work with multiple keys in BZPOPMIN", async () => {
        const redis = ctx.redis;
        const key1 = "bzpopmin-multi-1";
        const key2 = "bzpopmin-multi-2";

        await redis.send("ZADD", [key2, "5.0", "five", "6.0", "six"]);

        const result = await redis.bzpopmin(key1, key2, 0.1);
        expect(result).toBeDefined();
        expect(result![0]).toBe(key2);
        expect(result![1]).toBe("five");
        expect(result![2]).toBe(5);
      });

      test("should work with multiple keys in BZPOPMAX", async () => {
        const redis = ctx.redis;
        const key1 = "bzpopmax-multi-1";
        const key2 = "bzpopmax-multi-2";

        await redis.send("ZADD", [key2, "5.0", "five", "6.0", "six"]);

        const result = await redis.bzpopmax(key1, key2, 0.5);
        expect(result).toBeDefined();
        expect(result![0]).toBe(key2);
        expect(result![1]).toBe("six");
        expect(result![2]).toBe(6);
      });

      test("should reject invalid arguments in BZPOPMIN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzpopmin({} as any, 1);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'bzpopmin'."`,
        );
      });

      test("should reject invalid arguments in BZPOPMAX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzpopmax([] as any, 1);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'bzpopmax'."`,
        );
      });
    });

    describe("Hash Operations", () => {
      test("should increment hash field by integer with HINCRBY", async () => {
        const redis = ctx.redis;
        const key = "hincrby-test";

        const val1 = await redis.hincrby(key, "field1", 5);
        expect(val1).toBe(5);

        const val2 = await redis.hincrby(key, "field1", 3);
        expect(val2).toBe(8);

        const val3 = await redis.hincrby(key, "field1", -2);
        expect(val3).toBe(6);
      });

      test("should increment hash field by float with HINCRBYFLOAT", async () => {
        const redis = ctx.redis;
        const key = "hincrbyfloat-test";

        const val1 = await redis.hincrbyfloat(key, "field1", 2.5);
        expect(val1).toBe("2.5");

        const val2 = await redis.hincrbyfloat(key, "field1", 1.3);
        expect(Number.parseFloat(val2)).toBeCloseTo(3.8);

        const val3 = await redis.hincrbyfloat(key, "field1", -0.8);
        expect(Number.parseFloat(val3)).toBeCloseTo(3.0);
      });

      test("should get all hash keys with HKEYS", async () => {
        const redis = ctx.redis;
        const key = "hkeys-test";

        const keys1 = await redis.hkeys(key);
        expect(keys1).toEqual([]);

        await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

        const keys2 = await redis.hkeys(key);
        expect(keys2.sort()).toEqual(["field1", "field2", "field3"]);
      });

      test("should get hash length with HLEN", async () => {
        const redis = ctx.redis;
        const key = "hlen-test";

        const len1 = await redis.hlen(key);
        expect(len1).toBe(0);

        await redis.hset(key, "field1", "value1", "field2", "value2");
        const len2 = await redis.hlen(key);
        expect(len2).toBe(2);

        await redis.hset(key, "field3", "value3");
        const len3 = await redis.hlen(key);
        expect(len3).toBe(3);
      });

      test("should get multiple hash values with HMGET where only two arguments are passed because the second is an array", async () => {
        const redis = ctx.redis;
        const key = "hmget-test";

        await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

        const values = await redis.hmget(key, ["field1", "field2", "field3"]);
        expect(values).toEqual(["value1", "value2", "value3"]);

        const mixed = await redis.hmget(key, ["field1", "nonexistent", "field2"]);
        expect(mixed).toEqual(["value1", null, "value2"]);
      });

      test("should get multiple hash values with HMGET", async () => {
        const redis = ctx.redis;
        const key = "hmget-test";

        await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

        const values = await redis.hmget(key, "field1", "field2", "field3");
        expect(values).toEqual(["value1", "value2", "value3"]);

        const mixed = await redis.hmget(key, "field1", "nonexistent", "field2");
        expect(mixed).toEqual(["value1", null, "value2"]);
      });

      test("should get all hash values with HVALS", async () => {
        const redis = ctx.redis;
        const key = "hvals-test";

        const vals1 = await redis.hvals(key);
        expect(vals1).toEqual([]);

        await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

        const vals2 = await redis.hvals(key);
        expect(vals2.sort()).toEqual(["value1", "value2", "value3"]);
      });

      test("should get hash field string length with HSTRLEN", async () => {
        const redis = ctx.redis;
        const key = "hstrlen-test";

        await redis.hset(key, "field1", "Hello", "field2", "World!");

        const len1 = await redis.hstrlen(key, "field1");
        expect(len1).toBe(5);

        const len2 = await redis.hstrlen(key, "field2");
        expect(len2).toBe(6);

        const len3 = await redis.hstrlen(key, "nonexistent");
        expect(len3).toBe(0);
      });

      test("should set hash field expiration with HEXPIRE", async () => {
        const redis = ctx.redis;
        const key = "hexpire-test";

        await redis.hset(key, "field1", "value1", "field2", "value2");

        const result = await redis.hexpire(key, 60, "FIELDS", 1, "field1");
        expect(result).toEqual([1]);

        const ttl = await redis.httl(key, "FIELDS", 1, "field1");
        expect(ttl[0]).toBeGreaterThan(0);
        expect(ttl[0]).toBeLessThanOrEqual(60);
      });

      test("should set hash field expiration at timestamp with HEXPIREAT", async () => {
        const redis = ctx.redis;
        const key = "hexpireat-test";

        await redis.hset(key, "field1", "value1");

        const futureTs = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.hexpireat(key, futureTs, "FIELDS", 1, "field1");
        expect(result).toEqual([1]);

        const ttl = await redis.httl(key, "FIELDS", 1, "field1");
        expect(ttl[0]).toBeGreaterThan(0);
      });

      test("should get hash field expiration time with HEXPIRETIME", async () => {
        const redis = ctx.redis;
        const key = "hexpiretime-test";

        await redis.hset(key, "field1", "value1");

        const futureTs = Math.floor(Date.now() / 1000) + 60;
        await redis.hexpireat(key, futureTs, "FIELDS", 1, "field1");

        const expireTime = await redis.hexpiretime(key, "FIELDS", 1, "field1");
        expect(expireTime[0]).toBeGreaterThan(0);
        expect(expireTime[0]).toBeLessThanOrEqual(futureTs);
      });

      test("should remove hash field expiration with HPERSIST", async () => {
        const redis = ctx.redis;
        const key = "hpersist-test";

        await redis.hset(key, "field1", "value1");
        await redis.hexpire(key, 60, "FIELDS", 1, "field1");

        const ttlBefore = await redis.httl(key, "FIELDS", 1, "field1");
        expect(ttlBefore[0]).toBeGreaterThan(0);

        const result = await redis.hpersist(key, "FIELDS", 1, "field1");
        expect(result).toEqual([1]);

        const ttlAfter = await redis.httl(key, "FIELDS", 1, "field1");
        expect(ttlAfter[0]).toBe(-1);
      });

      test("should set hash field expiration at timestamp in ms with HPEXPIREAT", async () => {
        const redis = ctx.redis;
        const key = "hpexpireat-test";

        await redis.hset(key, "field1", "value1");

        const futureTs = Date.now() + 5000;
        const result = await redis.hpexpireat(key, futureTs, "FIELDS", 1, "field1");
        expect(result).toEqual([1]);

        const pttl = await redis.hpttl(key, "FIELDS", 1, "field1");
        expect(pttl[0]).toBeGreaterThan(0);
      });

      test("should get hash field expiration time in ms with HPEXPIRETIME", async () => {
        const redis = ctx.redis;
        const key = "hpexpiretime-test";

        await redis.hset(key, "field1", "value1");

        const futureTs = Date.now() + 5000;
        await redis.hpexpireat(key, futureTs, "FIELDS", 1, "field1");

        const pexpireTime = await redis.hpexpiretime(key, "FIELDS", 1, "field1");
        expect(pexpireTime[0]).toBeGreaterThan(0);
        expect(pexpireTime[0]).toBeLessThanOrEqual(futureTs);
      });

      test("should set hash fields using object syntax", async () => {
        const redis = ctx.redis;
        const key = "hash-object-test";

        const result = await redis.hset(key, { field1: "value1", field2: "value2", field3: "value3" });
        expect(result).toBe(3);

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
        const value3 = await redis.hget(key, "field3");
        expect(value3).toBe("value3");
      });

      test("should set hash fields using variadic syntax", async () => {
        const redis = ctx.redis;
        const key = "hash-variadic-test";

        const result = await redis.hset(key, "field1", "value1", "field2", "value2");
        expect(result).toBe(2);

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
      });

      test("should set single hash field", async () => {
        const redis = ctx.redis;
        const key = "hash-single-test";

        const result = await redis.hset(key, "field1", "value1");
        expect(result).toBe(1);

        const value = await redis.hget(key, "field1");
        expect(value).toBe("value1");
      });

      test("should update existing hash fields", async () => {
        const redis = ctx.redis;
        const key = "hash-update-test";

        const result1 = await redis.hset(key, { field1: "value1", field2: "value2" });
        expect(result1).toBe(2);

        const result2 = await redis.hset(key, { field1: "new-value1", field3: "value3" });
        expect(result2).toBe(1);

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("new-value1");
        const value3 = await redis.hget(key, "field3");
        expect(value3).toBe("value3");
      });

      test("should work with HMSET using object syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-object-test";

        const result = await redis.hmset(key, { field1: "value1", field2: "value2" });
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
      });

      test("should work with HMSET using variadic syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-variadic-test";

        const result = await redis.hmset(key, "field1", "value1", "field2", "value2");
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
      });

      test("should work with HMSET using array syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-array-test";

        const result = await redis.hmset(key, ["field1", "value1", "field2", "value2"]);
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
      });

      test("should handle numeric field names and values", async () => {
        const redis = ctx.redis;
        const key = "hash-numeric-test";

        const result = await redis.hset(key, { 123: "value1", field2: 456 });
        expect(result).toBe(2);

        const value1 = await redis.hget(key, "123");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("456");
      });

      test("should throw error for odd number of variadic arguments", async () => {
        const redis = ctx.redis;
        const key = "hash-error-test";

        expect(async () => {
          await redis.hset(key, "field1", "value1", "field2");
        }).toThrow("HSET requires field-value pairs (even number of arguments after key)");
      });

      test("should throw error for empty object", async () => {
        const redis = ctx.redis;
        const key = "hash-empty-test";

        expect(async () => {
          await redis.hset(key, {});
        }).toThrow("HSET requires at least one field-value pair");
      });

      test("should throw error for array with odd number of elements", async () => {
        const redis = ctx.redis;
        const key = "hmset-error-test";

        expect(async () => {
          await redis.hmset(key, ["field1", "value1", "field2"]);
        }).toThrow("Array must have an even number of elements (field-value pairs)");
      });

      test("should handle large number of fields", async () => {
        const redis = ctx.redis;
        const key = "hash-large-test";

        const fields: Record<string, string> = {};
        for (let i = 0; i < 100; i++) {
          fields[`field${i}`] = `value${i}`;
        }

        const result = await redis.hset(key, fields);
        expect(result).toBe(100);

        const value0 = await redis.hget(key, "field0");
        expect(value0).toBe("value0");
        const value99 = await redis.hget(key, "field99");
        expect(value99).toBe("value99");
      });

      test("should set hash field only if it doesn't exist using hsetnx", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result1 = await redis.hsetnx(key, "name", "John");
        expect(result1).toBe(true);

        const result2 = await redis.hsetnx(key, "name", "Jane");
        expect(result2).toBe(false);

        const value = await redis.hget(key, "name");
        expect(value).toBe("John");

        const result3 = await redis.hsetnx(key, "age", "30");
        expect(result3).toBe(true);
      });

      test("should get and delete hash field using hgetdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const values = await redis.hgetdel(key, "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);

        const check = await redis.hget(key, "name");
        expect(check).toBeNull();

        const age = await redis.hget(key, "age");
        expect(age).toBe("30");
      });

      test("should get and delete multiple hash fields using hgetdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const values = await redis.hgetdel(key, "FIELDS", 2, "name", "city");
        expect(values).toEqual(["John", "NYC"]);

        expect(await redis.hget(key, "name")).toBeNull();
        expect(await redis.hget(key, "city")).toBeNull();
        expect(await redis.hget(key, "age")).toBe("30");
      });

      test("should get hash field with expiration using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const values = await redis.hgetex(key, "EX", 10, "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);

        const check = await redis.hget(key, "name");
        expect(check).toBe("John");

        const ttls = await redis.httl(key, "FIELDS", 1, "name");
        expect(ttls).toHaveLength(1);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(10);
      });

      test("should get hash fields without expiration using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const values = await redis.hgetex(key, "FIELDS", 2, "name", "age");
        expect(values).toEqual(["John", "30"]);
      });

      test("should get hash fields with PX expiration using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const values = await redis.hgetex(key, "PX", 5000, "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);

        const ttls = await redis.hpttl(key, "FIELDS", 1, "name");
        expect(ttls).toHaveLength(1);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(5000);
      });

      test("should get hash fields with EXAT using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const values = await redis.hgetex(key, "EXAT", futureTimestamp, "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);
      });

      test("should get hash fields with PXAT using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const futureTimestamp = Date.now() + 60000;
        const values = await redis.hgetex(key, "PXAT", futureTimestamp, "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);
      });

      test("should get hash fields with PERSIST using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hsetex(key, "EX", 100, "FIELDS", 1, "name", "John");

        const values = await redis.hgetex(key, "PERSIST", "FIELDS", 1, "name");
        expect(values).toEqual(["John"]);
      });

      test("should get multiple hash fields and return null for missing fields using hgetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const values = await redis.hgetex(key, "FIELDS", 3, "name", "age", "city");
        expect(values).toEqual(["John", null, null]);
      });

      test("should set hash field with expiration using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hsetex(key, "EX", 10, "FIELDS", 1, "name", "John");
        expect(result).toBe(1);

        const value = await redis.hget(key, "name");
        expect(value).toBe("John");

        const ttls = await redis.httl(key, "FIELDS", 1, "name");
        expect(ttls).toHaveLength(1);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(10);
      });

      test("should set multiple hash fields with expiration using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hsetex(key, "EX", 10, "FIELDS", 2, "name", "John", "age", "30");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBe("30");

        const ttls = await redis.httl(key, "FIELDS", 2, "name", "age");
        expect(ttls).toHaveLength(2);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(10);
        expect(ttls[1]).toBeGreaterThan(0);
        expect(ttls[1]).toBeLessThanOrEqual(10);
      });

      test("should set hash fields without expiration using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hsetex(key, "FIELDS", 2, "name", "John", "age", "30");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBe("30");

        const ttls = await redis.httl(key, "FIELDS", 2, "name", "age");
        expect(ttls).toEqual([-1, -1]);
      });

      test("should set hash fields with PX (milliseconds) using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hsetex(key, "PX", 5000, "FIELDS", 1, "name", "John");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
      });

      test("should set hash fields with EXAT (unix timestamp seconds) using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.hsetex(key, "EXAT", futureTimestamp, "FIELDS", 1, "name", "John");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
      });

      test("should set hash fields with PXAT (unix timestamp milliseconds) using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const futureTimestamp = Date.now() + 60000;
        const result = await redis.hsetex(key, "PXAT", futureTimestamp, "FIELDS", 1, "name", "John");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
      });

      test("should set hash fields with KEEPTTL using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hsetex(key, "EX", 100, "FIELDS", 1, "name", "John");

        const result = await redis.hsetex(key, "KEEPTTL", "FIELDS", 1, "name", "Jane");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("Jane");
      });

      test("should set hash fields with FNX flag using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const result1 = await redis.hsetex(key, "FNX", "FIELDS", 2, "name", "Jane", "age", "30");
        expect(result1).toBe(0);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBeNull();

        const result2 = await redis.hsetex(key, "FNX", "FIELDS", 2, "city", "NYC", "country", "USA");
        expect(result2).toBe(1);

        expect(await redis.hget(key, "city")).toBe("NYC");
        expect(await redis.hget(key, "country")).toBe("USA");
      });

      test("should set hash fields with FXX flag using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const result1 = await redis.hsetex(key, "FXX", "FIELDS", 2, "name", "Jane", "age", "30");
        expect(result1).toBe(0);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBeNull();

        await redis.hset(key, { age: "25" });
        const result2 = await redis.hsetex(key, "FXX", "FIELDS", 2, "name", "Jane", "age", "30");
        expect(result2).toBe(1);

        expect(await redis.hget(key, "name")).toBe("Jane");
        expect(await redis.hget(key, "age")).toBe("30");
      });

      test("should set hash fields with FNX and EX combined using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const result1 = await redis.hsetex(key, "FNX", "EX", 10, "FIELDS", 2, "name", "John", "age", "30");
        expect(result1).toBe(1);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBe("30");

        const result2 = await redis.hsetex(key, "FNX", "EX", 10, "FIELDS", 2, "name", "Jane", "age", "35");
        expect(result2).toBe(0);

        expect(await redis.hget(key, "name")).toBe("John");
        expect(await redis.hget(key, "age")).toBe("30");
      });

      test("should set hash fields with FXX and PX combined using hsetex", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const result = await redis.hsetex(key, "FXX", "PX", 5000, "FIELDS", 2, "name", "Jane", "age", "35");
        expect(result).toBe(1);

        expect(await redis.hget(key, "name")).toBe("Jane");
        expect(await redis.hget(key, "age")).toBe("35");
      });

      test("should check TTL of hash fields using httl", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hsetex(key, "EX", 100, "FIELDS", 1, "name", "John");
        await redis.hset(key, { age: "30" });

        const ttls = await redis.httl(key, "FIELDS", 3, "name", "age", "nonexistent");
        expect(ttls).toHaveLength(3);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(100);
        expect(ttls[1]).toBe(-1);
        expect(ttls[2]).toBe(-2);
      });

      test("should check TTL of hash fields using hpttl in milliseconds", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const expireResult = await redis.hpexpire(key, 5000, "FIELDS", 1, "name");
        expect(expireResult).toEqual([1]);

        const ttls = await redis.hpttl(key, "FIELDS", 2, "name", "age");
        expect(ttls).toHaveLength(2);
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(5000);
        expect(ttls[1]).toBe(-1);
      });

      test("should delete hash fields using hdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const deleted = await redis.hdel(key, "age");
        expect(deleted).toBe(1);

        const age = await redis.hget(key, "age");
        expect(age).toBeNull();

        const name = await redis.hget(key, "name");
        expect(name).toBe("John");
      });

      test("should delete multiple hash fields using hdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC", country: "USA" });

        const deleted = await redis.hdel(key, "age", "city");
        expect(deleted).toBe(2);

        const remaining = await redis.hgetall(key);
        expect(remaining).toEqual({ name: "John", country: "USA" });
      });

      test("should return empty object for hgetall on non-existent key", async () => {
        const redis = ctx.redis;
        const key = "nonexistent-hgetall-" + randomUUIDv7();
        const result = await redis.hgetall(key);
        expect(result).toEqual({});
      });

      test("should check if hash field exists using hexists", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const nameExists = await redis.hexists(key, "name");
        expect(nameExists).toBe(true);

        const emailExists = await redis.hexists(key, "email");
        expect(emailExists).toBe(false);
      });

      test("should get random field using hrandfield", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const field = await redis.hrandfield(key);
        expect(["name", "age", "city"]).toContain<string | null>(field);
      });

      test("should get multiple random fields using hrandfield with count", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const fields = await redis.hrandfield(key, 2);
        expect(fields).toBeInstanceOf(Array);
        expect(fields.length).toBe(2);
        fields.forEach(field => {
          expect(["name", "age", "city"]).toContain(field);
        });
      });

      test("should get random fields with values using hrandfield WITHVALUES", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const fullData = { name: "Andy", age: "30", city: "Cupertino" };
        await redis.hset(key, fullData);

        const result = await redis.hrandfield(key, 2, "WITHVALUES");
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(2);

        const obj = Object.fromEntries(result);

        expect(Object.keys(obj).length).toBe(2);

        for (const [field, value] of Object.entries(obj)) {
          expect(fullData).toHaveProperty(field, value);
        }
      });

      test("should scan hash using hscan", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const [cursor, fields] = await redis.hscan(key, 0);
        expect(typeof cursor).toBe("string");
        expect(fields).toBeInstanceOf(Array);
        expect(fields.length).toBe(6);

        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        expect(obj).toEqual({ name: "John", age: "30", city: "NYC" });
      });

      test("should scan hash with pattern using hscan MATCH", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { field1: "val1", field2: "val2", other: "val3" });

        const [cursor, fields] = await redis.hscan(key, 0, "MATCH", "field*");
        expect(typeof cursor).toBe("string");
        expect(fields).toBeInstanceOf(Array);

        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }

        expect(obj.field1).toBe("val1");
        expect(obj.field2).toBe("val2");
        expect(obj.other).toBeUndefined();
      });

      test("should scan hash with count using hscan COUNT", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        const fields: Record<string, string> = {};
        for (let i = 0; i < 20; i++) {
          fields[`field${i}`] = `value${i}`;
        }
        await redis.hset(key, fields);

        const [cursor, result] = await redis.hscan(key, 0, "COUNT", 5);
        expect(typeof cursor).toBe("string");
        expect(result).toBeInstanceOf(Array);

        expect(result.length).toBeGreaterThan(0);
      });

      test("should increment hash field by integer using hincrby", async () => {
        const redis = ctx.redis;
        const key = "hincrby-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { counter: "10" });

        const result1 = await redis.hincrby(key, "counter", 5);
        expect(result1).toBe(15);

        const result2 = await redis.hincrby(key, "counter", -3);
        expect(result2).toBe(12);

        const value = await redis.hget(key, "counter");
        expect(value).toBe("12");
      });

      test("should increment hash field from zero using hincrby", async () => {
        const redis = ctx.redis;
        const key = "hincrby-zero-test:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hincrby(key, "newfield", 42);
        expect(result).toBe(42);

        const value = await redis.hget(key, "newfield");
        expect(value).toBe("42");
      });

      test("should increment hash field by float using hincrbyfloat", async () => {
        const redis = ctx.redis;
        const key = "hincrbyfloat-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { price: "10.5" });

        const result1 = await redis.hincrbyfloat(key, "price", 2.3);
        expect(result1).toBe("12.8");

        const result2 = await redis.hincrbyfloat(key, "price", -0.8);
        expect(result2).toBe("12");

        const value = await redis.hget(key, "price");
        expect(value).toBe("12");
      });

      test("should increment hash field from zero using hincrbyfloat", async () => {
        const redis = ctx.redis;
        const key = "hincrbyfloat-zero-test:" + randomUUIDv7().substring(0, 8);

        const result = await redis.hincrbyfloat(key, "newfield", 3.14);
        expect(result).toBe("3.14");

        const value = await redis.hget(key, "newfield");
        expect(value).toBe("3.14");
      });

      test("should get all hash keys using hkeys", async () => {
        const redis = ctx.redis;
        const key = "hkeys-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const keys = await redis.hkeys(key);
        expect(keys).toBeInstanceOf(Array);
        expect(keys.length).toBe(3);
        expect(keys).toContain("name");
        expect(keys).toContain("age");
        expect(keys).toContain("city");
      });

      test("should return empty array for non-existent key using hkeys", async () => {
        const redis = ctx.redis;
        const key = "hkeys-nonexistent:" + randomUUIDv7().substring(0, 8);

        const keys = await redis.hkeys(key);
        expect(keys).toEqual([]);
      });

      test("should get hash length using hlen", async () => {
        const redis = ctx.redis;
        const key = "hlen-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const length = await redis.hlen(key);
        expect(length).toBe(3);

        await redis.hset(key, { country: "USA" });
        const newLength = await redis.hlen(key);
        expect(newLength).toBe(4);
      });

      test("should return 0 for non-existent key using hlen", async () => {
        const redis = ctx.redis;
        const key = "hlen-nonexistent:" + randomUUIDv7().substring(0, 8);

        const length = await redis.hlen(key);
        expect(length).toBe(0);
      });

      test("should get multiple hash values using hmget", async () => {
        const redis = ctx.redis;
        const key = "hmget-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const values = await redis.hmget(key, "name", "age", "city");
        expect(values).toEqual(["John", "30", "NYC"]);
      });

      test("should return null for missing fields using hmget", async () => {
        const redis = ctx.redis;
        const key = "hmget-missing-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const values = await redis.hmget(key, "name", "age", "city");
        expect(values).toEqual(["John", null, null]);
      });

      test("should get all hash values using hvals", async () => {
        const redis = ctx.redis;
        const key = "hvals-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const values = await redis.hvals(key);
        expect(values).toBeInstanceOf(Array);
        expect(values.length).toBe(3);
        expect(values).toContain("John");
        expect(values).toContain("30");
        expect(values).toContain("NYC");
      });

      test("should return empty array for non-existent key using hvals", async () => {
        const redis = ctx.redis;
        const key = "hvals-nonexistent:" + randomUUIDv7().substring(0, 8);

        const values = await redis.hvals(key);
        expect(values).toEqual([]);
      });

      test("should get hash field string length using hstrlen", async () => {
        const redis = ctx.redis;
        const key = "hstrlen-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", description: "Software Engineer" });

        const nameLen = await redis.hstrlen(key, "name");
        expect(nameLen).toBe(4);

        const descLen = await redis.hstrlen(key, "description");
        expect(descLen).toBe(17);
      });

      test("should return 0 for non-existent field using hstrlen", async () => {
        const redis = ctx.redis;
        const key = "hstrlen-nonexistent:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John" });

        const length = await redis.hstrlen(key, "age");
        expect(length).toBe(0);
      });

      test("should expire hash fields using hexpire", async () => {
        const redis = ctx.redis;
        const key = "hexpire-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const result = await redis.hexpire(key, 10, "FIELDS", 2, "name", "age");
        expect(result).toEqual([1, 1]);

        const ttls = await redis.httl(key, "FIELDS", 3, "name", "age", "city");
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(10);
        expect(ttls[1]).toBeGreaterThan(0);
        expect(ttls[1]).toBeLessThanOrEqual(10);
        expect(ttls[2]).toBe(-1);
      });

      test("should expire hash fields with NX flag using hexpire", async () => {
        const redis = ctx.redis;
        const key = "hexpire-nx-test:" + randomUUIDv7().substring(0, 8);

        await redis.hsetex(key, "EX", 100, "FIELDS", 1, "name", "John");
        await redis.hset(key, { age: "30" });

        const result = await redis.hexpire(key, 10, "NX", "FIELDS", 2, "name", "age");
        expect(result).toEqual([0, 1]);
      });

      test("should expire hash fields at specific time using hexpireat", async () => {
        const redis = ctx.redis;
        const key = "hexpireat-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.hexpireat(key, futureTimestamp, "FIELDS", 2, "name", "age");
        expect(result).toEqual([1, 1]);

        const ttls = await redis.httl(key, "FIELDS", 2, "name", "age");
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(60);
        expect(ttls[1]).toBeGreaterThan(0);
        expect(ttls[1]).toBeLessThanOrEqual(60);
      });

      test("should get hash field expiration time using hexpiretime", async () => {
        const redis = ctx.redis;
        const key = "hexpiretime-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const futureTimestamp = Math.floor(Date.now() / 1000) + 100;
        await redis.hexpireat(key, futureTimestamp, "FIELDS", 1, "name");

        const expiretimes = await redis.hexpiretime(key, "FIELDS", 2, "name", "age");
        expect(expiretimes).toHaveLength(2);
        expect(expiretimes[0]).toBeGreaterThan(0);
        expect(expiretimes[0]).toBeLessThanOrEqual(futureTimestamp);
        expect(expiretimes[1]).toBe(-1);
      });

      test("should expire hash fields at specific time in milliseconds using hpexpireat", async () => {
        const redis = ctx.redis;
        const key = "hpexpireat-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const futureTimestamp = Date.now() + 60000;
        const result = await redis.hpexpireat(key, futureTimestamp, "FIELDS", 2, "name", "age");
        expect(result).toEqual([1, 1]);

        const ttls = await redis.hpttl(key, "FIELDS", 2, "name", "age");
        expect(ttls[0]).toBeGreaterThan(0);
        expect(ttls[0]).toBeLessThanOrEqual(60100);
        expect(ttls[1]).toBeGreaterThan(0);
        expect(ttls[1]).toBeLessThanOrEqual(60100);
      });

      test("should get hash field expiration time in milliseconds using hpexpiretime", async () => {
        const redis = ctx.redis;
        const key = "hpexpiretime-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const futureTimestamp = Date.now() + 100000;
        await redis.hpexpireat(key, futureTimestamp, "FIELDS", 1, "name");

        const expiretimes = await redis.hpexpiretime(key, "FIELDS", 2, "name", "age");
        expect(expiretimes).toHaveLength(2);
        expect(expiretimes[0]).toBeGreaterThan(0);
        expect(expiretimes[0]).toBeLessThanOrEqual(futureTimestamp);
        expect(expiretimes[1]).toBe(-1);
      });

      test("should persist hash fields using hpersist", async () => {
        const redis = ctx.redis;
        const key = "hpersist-test:" + randomUUIDv7().substring(0, 8);

        await redis.hsetex(key, "EX", 100, "FIELDS", 2, "name", "John", "age", "30");

        const result = await redis.hpersist(key, "FIELDS", 2, "name", "age");
        expect(result).toEqual([1, 1]);

        const ttls = await redis.httl(key, "FIELDS", 2, "name", "age");
        expect(ttls).toEqual([-1, -1]);
      });

      test("should return 0 for fields without expiration using hpersist", async () => {
        const redis = ctx.redis;
        const key = "hpersist-noexpire-test:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const result = await redis.hpersist(key, "FIELDS", 2, "name", "age");
        expect(result).toEqual([-1, -1]);
      });
    });

    describe("Connection State", () => {
      test("should have a connected property", () => {
        const redis = ctx.redis;

        expect(typeof redis.connected).toBe("boolean");
      });
    });

    describe("RESP3 Data Types", () => {
      test("should handle hash maps (dictionaries) as command responses", async () => {
        const redis = ctx.redis;

        const userId = "user:" + randomUUIDv7().substring(0, 8);
        const setResult = await redis.send("HSET", [userId, "name", "John", "age", "30", "active", "true"]);
        expect(setResult).toBeDefined();

        const hash = await redis.send("HGETALL", [userId]);
        expect(hash).toBeDefined();

        if (typeof hash === "object" && hash !== null) {
          expect(hash).toHaveProperty("name");
          expect(hash).toHaveProperty("age");
          expect(hash).toHaveProperty("active");

          expect(hash.name).toBe("John");
          expect(hash.age).toBe("30");
          expect(hash.active).toBe("true");
        }
      });

      test("should handle sets as command responses", async () => {
        const redis = ctx.redis;

        const setKey = "colors:" + randomUUIDv7().substring(0, 8);
        const addResult = await redis.send("SADD", [setKey, "red", "blue", "green"]);
        expect(addResult).toBeDefined();

        const setMembers = await redis.send("SMEMBERS", [setKey]);
        expect(setMembers).toBeDefined();

        expect(Array.isArray(setMembers)).toBe(true);

        expect(setMembers).toContain("red");
        expect(setMembers).toContain("blue");
        expect(setMembers).toContain("green");
      });
    });

    describe("Connection Options", () => {
      test("connection errors", async () => {
        const url = new URL(connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL);
        url.username = "badusername";
        url.password = "secretpassword";
        const customRedis = new RedisClient(url.toString(), {
          tls: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tls : false,
        });

        expect(async () => {
          await customRedis.get("test");
        }).toThrowErrorMatchingInlineSnapshot(`"WRONGPASS invalid username-password pair or user is disabled."`);
      });

      const testKeyUniquePerDb = crypto.randomUUID();
      test.each([...Array(16).keys()])("Connecting to database with url $url succeeds", async (dbId: number) => {
        const redis = createClient(connectionType, {}, dbId);

        const testValue = await redis.get(testKeyUniquePerDb);
        expect(testValue).toBeNull();

        redis.close();
      });
    });

    describe("Reconnections", () => {
      test.skip("should automatically reconnect after connection drop", async () => {
        const TEST_KEY = "test-key";
        const TEST_VALUE = "test-value";

        if (!ctx.redis || !ctx.redis.connected) {
          ctx.redis = createClient(connectionType);
        }

        const valueBeforeStart = await ctx.redis.get(TEST_KEY);
        expect(valueBeforeStart).toBeNull();

        await ctx.redis.set(TEST_KEY, TEST_VALUE);
        const valueAfterSet = await ctx.redis.get(TEST_KEY);
        expect(valueAfterSet).toBe(TEST_VALUE);

        await ctx.restartServer();

        const valueAfterStop = await ctx.redis.get(TEST_KEY);
        expect(valueAfterStop).toBe(TEST_VALUE);
      });
    });

    describe("PUB/SUB", () => {
      var i = 0;
      const testChannel = () => {
        return `test-channel-${i++}`;
      };
      const testKey = () => {
        return `test-key-${i++}`;
      };
      const testValue = () => {
        return `test-value-${i++}`;
      };
      const testMessage = () => {
        return `test-message-${i++}`;
      };

      beforeEach(async () => {
        await ctx.cleanupSubscribers();
      });

      test("publishing to a channel does not fail", async () => {
        expect(await ctx.redis.publish(testChannel(), testMessage())).toBe(0);
      });

      test("setting in subscriber mode gracefully fails", async () => {
        const subscriber = await ctx.newSubscriberClient(connectionType);

        await subscriber.subscribe(testChannel(), () => {});

        expect(() => subscriber.set(testKey(), testValue())).toThrow(
          "RedisClient.prototype.set cannot be called while in subscriber mode",
        );

        await subscriber.unsubscribe(testChannel());
      });

      test("setting after unsubscribing works", async () => {
        const channel = testChannel();
        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});
        await subscriber.unsubscribe(channel);
        expect(ctx.redis.set(testKey(), testValue())).resolves.toEqual("OK");
      });

      test("subscribing to a channel receives messages", async () => {
        const TEST_MESSAGE_COUNT = 128;
        const subscriber = await ctx.newSubscriberClient(connectionType);
        const channel = testChannel();
        const message = testMessage();

        const counter = awaitableCounter();
        await subscriber.subscribe(channel, (message, channel) => {
          counter.increment();
          expect(channel).toBe(channel);
          expect(message).toBe(message);
        });

        Array.from({ length: TEST_MESSAGE_COUNT }).forEach(async () => {
          expect(await ctx.redis.publish(channel, message)).toBe(1);
        });

        await counter.untilValue(TEST_MESSAGE_COUNT);
        expect(counter.count()).toBe(TEST_MESSAGE_COUNT);
      });

      test("messages are received in order", async () => {
        const channel = testChannel();

        await ctx.redis.set("START-TEST", "1");
        const TEST_MESSAGE_COUNT = 1024;
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const counter = awaitableCounter();
        var receivedMessages: string[] = [];
        await subscriber.subscribe(channel, message => {
          receivedMessages.push(message);
          counter.increment();
        });

        const sentMessages = Array.from({ length: TEST_MESSAGE_COUNT }).map(() => {
          return randomUUIDv7();
        });
        await Promise.all(
          sentMessages.map(async message => {
            expect(await ctx.redis.publish(channel, message)).toBe(1);
          }),
        );

        await counter.untilValue(TEST_MESSAGE_COUNT);
        expect(receivedMessages.length).toBe(sentMessages.length);
        expect(receivedMessages).toEqual(sentMessages);

        await subscriber.unsubscribe(channel);

        await ctx.redis.set("STOP-TEST", "1");
      });

      test("subscribing to multiple channels receives messages", async () => {
        const TEST_MESSAGE_COUNT = 128;
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const channels = [testChannel(), testChannel()];
        const counter = awaitableCounter();

        var receivedMessages: { [channel: string]: string[] } = {};
        await subscriber.subscribe(channels, (message, channel) => {
          receivedMessages[channel] = receivedMessages[channel] || [];
          receivedMessages[channel].push(message);
          counter.increment();
        });

        var sentMessages: { [channel: string]: string[] } = {};
        for (let i = 0; i < TEST_MESSAGE_COUNT; i++) {
          const channel = channels[randomCoinFlip() ? 0 : 1];
          const message = randomUUIDv7();

          expect(await ctx.redis.publish(channel, message)).toBe(1);

          sentMessages[channel] = sentMessages[channel] || [];
          sentMessages[channel].push(message);
        }

        await counter.untilValue(TEST_MESSAGE_COUNT);

        expect(Object.keys(receivedMessages).sort()).toEqual(Object.keys(sentMessages).sort());

        for (const channel of channels) {
          if (sentMessages[channel]) {
            expect(receivedMessages[channel]).toEqual(sentMessages[channel]);
          }
        }

        await subscriber.unsubscribe(channels);
      });

      test("unsubscribing from specific channels while remaining subscribed to others", async () => {
        const channel1 = "channel-1";
        const channel2 = "channel-2";
        const channel3 = "channel-3";

        const subscriber = createClient(connectionType);
        await subscriber.connect();

        let receivedMessages: { [channel: string]: string[] } = {};

        const counter = awaitableCounter();

        await subscriber.subscribe([channel1, channel2, channel3], (message, channel) => {
          receivedMessages[channel] = receivedMessages[channel] || [];
          receivedMessages[channel].push(message);
          counter.increment();
        });

        expect(await ctx.redis.publish(channel1, "msg1-before")).toBe(1);
        expect(await ctx.redis.publish(channel2, "msg2-before")).toBe(1);
        expect(await ctx.redis.publish(channel3, "msg3-before")).toBe(1);

        await counter.untilValue(3);
        await subscriber.unsubscribe(channel2);

        expect(await ctx.redis.publish(channel1, "msg1-after")).toBe(1);
        expect(await ctx.redis.publish(channel2, "msg2-after")).toBe(0);
        expect(await ctx.redis.publish(channel3, "msg3-after")).toBe(1);

        await counter.untilValue(5);

        expect(receivedMessages[channel1]).toEqual(["msg1-before", "msg1-after"]);
        expect(receivedMessages[channel2]).toEqual(["msg2-before"]);
        expect(receivedMessages[channel3]).toEqual(["msg3-before", "msg3-after"]);

        await subscriber.unsubscribe([channel1, channel3]);
      });

      test("subscribing to the same channel multiple times", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();
        const channel = testChannel();

        const counter = awaitableCounter();

        let callCount = 0;
        const listener = () => {
          callCount++;
          counter.increment();
        };

        let callCount2 = 0;
        const listener2 = () => {
          callCount2++;
          counter.increment();
        };

        await subscriber.subscribe(channel, listener);
        await subscriber.subscribe(channel, listener2);

        expect(await ctx.redis.publish(channel, "test-message")).toBe(1);

        await counter.untilValue(2);

        expect(callCount).toBe(1);
        expect(callCount2).toBe(1);

        await subscriber.unsubscribe(channel);
      });

      test("empty string messages", async () => {
        const channel = "empty-message-channel";
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        const counter = awaitableCounter();
        let receivedMessage: string | undefined = undefined;
        await subscriber.subscribe(channel, message => {
          receivedMessage = message;
          counter.increment();
        });

        expect(await ctx.redis.publish(channel, "")).toBe(1);
        await counter.untilValue(1);

        expect(receivedMessage).not.toBeUndefined();
        expect(receivedMessage!).toBe("");

        await subscriber.unsubscribe(channel);
      });

      test("special characters in channel names", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        const specialChannels = [
          "channel:with:colons",
          "channel with spaces",
          "channel-with-unicode-😀",
          "channel[with]brackets",
          "channel@with#special$chars",
        ];

        for (const channel of specialChannels) {
          const counter = awaitableCounter();
          let received = false;
          await subscriber.subscribe(channel, () => {
            received = true;
            counter.increment();
          });

          expect(await ctx.redis.publish(channel, "test")).toBe(1);
          await counter.untilValue(1);

          expect(received).toBe(true);
          await subscriber.unsubscribe(channel);
        }
      });

      test("ping works in subscription mode", async () => {
        const channel = "ping-test-channel";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        const pong = await subscriber.ping();
        expect(pong).toBe("PONG");

        const customPing = await subscriber.ping("hello");
        expect(customPing).toBe("hello");
      });

      test("publish does not work from a subscribed client", async () => {
        const channel = "self-publish-channel";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        expect(async () => subscriber.publish(channel, "self-published")).toThrow(
          "RedisClient.prototype.publish cannot be called while in subscriber mode.",
        );
      });

      test("complete unsubscribe restores normal command mode", async () => {
        const channel = "restore-test-channel";
        const testKey = "restore-test-key";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        expect(() => subscriber.set(testKey, testValue())).toThrow(
          "RedisClient.prototype.set cannot be called while in subscriber mode.",
        );

        await subscriber.unsubscribe();

        const result = await ctx.redis.set(testKey, "value");
        expect(result).toBe("OK");

        const value = await ctx.redis.get(testKey);
        expect(value).toBe("value");
      });

      test("publishing without subscribers succeeds", async () => {
        const channel = "no-subscribers-channel";

        expect(await ctx.redis.publish(channel, "message")).toBe(0);
      });

      test("unsubscribing from non-subscribed channels", async () => {
        const channel = "never-subscribed-channel";

        expect(() => ctx.redis.unsubscribe(channel)).toThrow(
          "RedisClient.prototype.unsubscribe can only be called while in subscriber mode.",
        );
      });

      test("high volume pub/sub", async () => {
        const channel = testChannel();

        const MESSAGE_COUNT = 1000;
        const MESSAGE_SIZE = 1024 * 1024;

        let byteCounter = awaitableCounter(5_000); // 5s timeout
        const subscriber = await ctx.redis.duplicate();
        await subscriber.subscribe(channel, message => {
          byteCounter.incrementBy(message.length);
        });

        for (let i = 0; i < MESSAGE_COUNT; i++) {
          await ctx.redis.publish(channel, "X".repeat(MESSAGE_SIZE));
        }

        expect(await byteCounter.untilValue(MESSAGE_COUNT * MESSAGE_SIZE)).toBe(MESSAGE_COUNT * MESSAGE_SIZE);
        subscriber.close();
      });

      test("callback errors don't crash the client (without IPC)", async () => {
        const channel = "error-callback-channel";

        const subscriberProc = spawn({
          cmd: [bunExe(), `${__dirname}/valkey.failing-subscriber-no-ipc.ts`],
          stdout: "pipe",
          stderr: "inherit",
          stdin: "pipe",
          env: { ...process.env, NODE_ENV: "development" },
        });

        const reader = subscriberProc.stdout.getReader();
        async function* readLines() {
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              yield line;
            }
          }
        }

        async function waitForChildMessage<MsgT extends Message>(expectedEvent: MsgT["event"]): Promise<MsgT> {
          for await (const line of readLines()) {
            const parsed = JSON.parse(line);
            if (typeof parsed !== "object") {
              throw new Error("Expected object message");
            }
            if (parsed.event === undefined || typeof parsed.event !== "string") {
              throw new Error("Expected event field as a string");
            }
            if (parsed.event !== expectedEvent) {
              throw new Error(`Expected event ${expectedEvent} but got ${parsed.event}`);
            }
            return parsed as MsgT;
          }
          throw new Error("Input stream unexpectedly closed");
        }

        async function messageChild<MsgT extends Message>(msg: MsgT): Promise<void> {
          subscriberProc.stdin!.write(JSON.stringify(msg) + "\n");
        }

        try {
          // Wait for the process to announce it is ready for messages.
          await waitForChildMessage("ready-for-url");

          // Tell the child to start and connect to Redis.
          await messageChild({
            event: "start",
            url: connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL,
            tlsPaths: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tlsPaths : undefined,
          });
          await waitForChildMessage("ready");

          expect(await ctx.redis.publish(channel, "message1")).toBeGreaterThanOrEqual(1);
          expect(await waitForChildMessage("message")).toMatchObject({ index: 1 });

          // This should throw inside the child process, so it should notify us.
          expect(await ctx.redis.publish(channel, "message2")).toBeGreaterThanOrEqual(1);
          await waitForChildMessage("exception");

          expect(await ctx.redis.publish(channel, "message1")).toBeGreaterThanOrEqual(1);
          expect(await waitForChildMessage("message")).toMatchObject({ index: 3 });
        } finally {
          subscriberProc.kill();
          await subscriberProc.exited;
        }
      });

      test("callback errors don't crash the client", async () => {
        const channel = "error-callback-channel";

        const STEP_WAITING_FOR_URL = 1;
        const STEP_SUBSCRIBED = 2;
        const STEP_FIRST_MESSAGE = 3;
        const STEP_SECOND_MESSAGE = 4;
        const STEP_THIRD_MESSAGE = 5;

        const stepCounter = awaitableCounter();
        let currentMessage: any = {};

        const subscriberProc = spawn({
          cmd: [bunExe(), `${__dirname}/valkey.failing-subscriber.ts`],
          stdout: "inherit",
          stderr: "inherit",
          ipc: msg => {
            currentMessage = msg;
            stepCounter.increment();
          },
          env: {
            ...process.env,
            NODE_ENV: "development",
          },
        });

        await stepCounter.untilValue(STEP_WAITING_FOR_URL);
        expect(currentMessage.event).toBe("waiting-for-url");
        subscriberProc.send({
          event: "start",
          url: connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL,
          tlsPaths: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tlsPaths : undefined,
        } as RedisTestStartMessage);

        try {
          await stepCounter.untilValue(STEP_SUBSCRIBED);
          expect(currentMessage.event).toBe("ready");

          expect(await ctx.redis.publish(channel, "message1")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_FIRST_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(1);

          expect(await ctx.redis.publish(channel, "message2")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_SECOND_MESSAGE);
          expect(currentMessage.event).toBe("exception");
          //expect(currentMessage.index).toBe(2);

          expect(await ctx.redis.publish(channel, "message3")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_THIRD_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(3);
        } finally {
          subscriberProc.kill();
          await subscriberProc.exited;
        }
      });

      test("subscriptions return correct counts", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        expect(await subscriber.subscribe("chan1", () => {})).toBe(1);
        expect(await subscriber.subscribe("chan2", () => {})).toBe(2);
      });

      test("unsubscribing from listeners", async () => {
        const channel = "error-callback-channel";

        const subscriber = createClient(connectionType);
        await subscriber.connect();

        const counter = awaitableCounter();
        let messageCount1 = 0;
        const listener1 = () => {
          messageCount1++;
          counter.increment();
        };
        await subscriber.subscribe(channel, listener1);

        let messageCount2 = 0;
        const listener2 = () => {
          messageCount2++;
          counter.increment();
        };
        await subscriber.subscribe(channel, listener2);

        await ctx.redis.publish(channel, "message1");
        await counter.untilValue(2);

        expect(messageCount1).toBe(1);
        expect(messageCount2).toBe(1);

        console.log("Unsubscribing listener2");
        await subscriber.unsubscribe(channel, listener2);

        await ctx.redis.publish(channel, "message1");
        await counter.untilValue(3);

        expect(messageCount1).toBe(2);
        expect(messageCount2).toBe(1);
      });
    });

    describe("duplicate()", () => {
      test("should create duplicate of connected client that gets connected", async () => {
        const duplicate = await ctx.redis.duplicate();

        expect(duplicate.connected).toBe(true);
        expect(duplicate).not.toBe(ctx.redis);

        await ctx.redis.set("test-original", "original-value");
        await duplicate.set("test-duplicate", "duplicate-value");

        expect(await ctx.redis.get("test-duplicate")).toBe("duplicate-value");
        expect(await duplicate.get("test-original")).toBe("original-value");

        duplicate.close();
      });

      test("should preserve connection configuration in duplicate", async () => {
        await ctx.redis.connect();

        const duplicate = await ctx.redis.duplicate();

        const testKey = `duplicate-config-test-${randomUUIDv7().substring(0, 8)}`;
        const testValue = "test-value";

        await ctx.redis.set(testKey, testValue);
        const retrievedValue = await duplicate.get(testKey);

        expect(retrievedValue).toBe(testValue);

        duplicate.close();
      });

      test("should allow duplicate to work independently from original", async () => {
        const duplicate = await ctx.redis.duplicate();

        duplicate.close();

        const testKey = `independent-test-${randomUUIDv7().substring(0, 8)}`;
        const testValue = "independent-value";

        await ctx.redis.set(testKey, testValue);
        const retrievedValue = await ctx.redis.get(testKey);

        expect(retrievedValue).toBe(testValue);
      });

      test("should handle duplicate of client in subscriber mode", async () => {
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const testChannel = "test-subscriber-duplicate";

        await subscriber.subscribe(testChannel, () => {});

        const duplicate = await subscriber.duplicate();

        expect(() => duplicate.set("test-key", "test-value")).not.toThrow();

        await subscriber.unsubscribe(testChannel);
      });

      test("should create multiple duplicates from same client", async () => {
        await ctx.redis.connect();

        const duplicate1 = await ctx.redis.duplicate();
        const duplicate2 = await ctx.redis.duplicate();
        const duplicate3 = await ctx.redis.duplicate();

        expect(duplicate1.connected).toBe(true);
        expect(duplicate2.connected).toBe(true);
        expect(duplicate3.connected).toBe(true);

        const testKey = `multi-duplicate-test-${randomUUIDv7().substring(0, 8)}`;
        await duplicate1.set(`${testKey}-1`, "value-1");
        await duplicate2.set(`${testKey}-2`, "value-2");
        await duplicate3.set(`${testKey}-3`, "value-3");

        expect(await duplicate1.get(`${testKey}-1`)).toBe("value-1");
        expect(await duplicate2.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate3.get(`${testKey}-3`)).toBe("value-3");

        expect(await duplicate1.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate2.get(`${testKey}-3`)).toBe("value-3");
        expect(await duplicate3.get(`${testKey}-1`)).toBe("value-1");

        duplicate1.close();
        duplicate2.close();
        duplicate3.close();
      });

      test("should duplicate client that failed to connect", async () => {
        const url = new URL(connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL);
        url.username = "invaliduser";
        url.password = "invalidpassword";
        const failedRedis = new RedisClient(url.toString(), {
          tls: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tls : false,
        });

        let connectionFailed = false;
        try {
          await failedRedis.connect();
        } catch {
          connectionFailed = true;
        }

        expect(connectionFailed).toBe(true);
        expect(failedRedis.connected).toBe(false);

        const duplicate = await failedRedis.duplicate();
        expect(duplicate.connected).toBe(false);
      });

      test("should handle duplicate timing with concurrent operations", async () => {
        await ctx.redis.connect();

        const testKey = `concurrent-test-${randomUUIDv7().substring(0, 8)}`;
        const originalOperation = ctx.redis.set(testKey, "original-value");

        const duplicate = await ctx.redis.duplicate();

        await originalOperation;

        expect(await duplicate.get(testKey)).toBe("original-value");

        duplicate.close();
      });
    });
  });
}
