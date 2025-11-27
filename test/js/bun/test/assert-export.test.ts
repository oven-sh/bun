import { assert, expect, test } from "bun:test";

test("assert is exported from bun:test", () => {
  expect(typeof assert).toBe("function");
});

test("assert(condition) works", () => {
  assert(true);
  assert(1);
  assert("non-empty string");

  expect(() => assert(false)).toThrow();
  expect(() => assert(0)).toThrow();
  expect(() => assert("")).toThrow();
});

test("assert with message works", () => {
  assert(true, "should not throw");

  expect(() => assert(false, "custom error message")).toThrow(/custom error message/);
});

test("assert.ok works", () => {
  assert.ok(true);
  assert.ok(1);

  expect(() => assert.ok(false)).toThrow();
});

test("assert.strictEqual works", () => {
  assert.strictEqual(1, 1);
  assert.strictEqual("hello", "hello");

  expect(() => assert.strictEqual(1, 2)).toThrow();
  expect(() => assert.strictEqual(1, "1")).toThrow();
});

test("assert.deepStrictEqual works", () => {
  assert.deepStrictEqual({ a: 1 }, { a: 1 });
  assert.deepStrictEqual([1, 2, 3], [1, 2, 3]);

  expect(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })).toThrow();
});

test("assert.notStrictEqual works", () => {
  assert.notStrictEqual(1, 2);
  assert.notStrictEqual(1, "1");

  expect(() => assert.notStrictEqual(1, 1)).toThrow();
});

test("assert.throws works", () => {
  assert.throws(() => {
    throw new Error("test error");
  });

  expect(() =>
    assert.throws(() => {
      // does not throw
    }),
  ).toThrow();
});

test("assert.doesNotThrow works", () => {
  assert.doesNotThrow(() => {
    // does not throw
  });

  expect(() =>
    assert.doesNotThrow(() => {
      throw new Error("test error");
    }),
  ).toThrow();
});

test("assert.rejects works", async () => {
  await assert.rejects(async () => {
    throw new Error("async error");
  });

  await expect(
    assert.rejects(async () => {
      // does not reject
    }),
  ).rejects.toThrow();
});

test("assert.doesNotReject works", async () => {
  await assert.doesNotReject(async () => {
    // does not reject
  });

  await expect(
    assert.doesNotReject(async () => {
      throw new Error("async error");
    }),
  ).rejects.toThrow();
});

test("assert.equal works (loose equality)", () => {
  assert.equal(1, 1);
  assert.equal(1, "1"); // loose equality allows this

  expect(() => assert.equal(1, 2)).toThrow();
});

test("assert.notEqual works (loose inequality)", () => {
  assert.notEqual(1, 2);

  expect(() => assert.notEqual(1, 1)).toThrow();
});

test("assert.deepEqual works", () => {
  assert.deepEqual({ a: 1 }, { a: 1 });
  assert.deepEqual([1, 2], [1, 2]);

  expect(() => assert.deepEqual({ a: 1 }, { a: 2 })).toThrow();
});

test("assert.notDeepEqual works", () => {
  assert.notDeepEqual({ a: 1 }, { a: 2 });

  expect(() => assert.notDeepEqual({ a: 1 }, { a: 1 })).toThrow();
});

test("assert.fail works", () => {
  expect(() => assert.fail()).toThrow();
  expect(() => assert.fail("custom message")).toThrow(/custom message/);
});

test("assert.ifError works", () => {
  assert.ifError(null);
  assert.ifError(undefined);

  expect(() => assert.ifError(new Error("test"))).toThrow();
  expect(() => assert.ifError("some error")).toThrow();
});

test("assert.match works", () => {
  assert.match("hello world", /world/);

  expect(() => assert.match("hello", /world/)).toThrow();
});

test("assert.doesNotMatch works", () => {
  assert.doesNotMatch("hello", /world/);

  expect(() => assert.doesNotMatch("hello world", /world/)).toThrow();
});
