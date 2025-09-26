import { test, expect } from "bun:test";

test("issue #3521: expect.any and toMatchObject should not mutate the original object", () => {
  const obj = {
    foo: "foo",
    bar: "bar",
    nested: {
      value: 42,
      text: "hello",
    },
  };

  // Save original values to verify no mutation
  const originalBar = obj.bar;
  const originalNestedText = obj.nested.text;

  // Test with single property
  expect(obj).toMatchObject({
    bar: expect.any(String),
  });

  // Verify no mutation occurred
  expect(obj.bar).toBe(originalBar);
  expect(obj.bar).not.toContain("Any<String>");
  expect(obj.bar).toBe("bar");

  // Test with nested property
  expect(obj).toMatchObject({
    nested: {
      text: expect.any(String),
    },
  });

  // Verify nested property wasn't mutated
  expect(obj.nested.text).toBe(originalNestedText);
  expect(obj.nested.text).not.toContain("Any<String>");
  expect(obj.nested.text).toBe("hello");

  // Test with multiple matchers
  const complexObj = {
    str: "string",
    num: 42,
    bool: true,
    arr: [1, 2, 3],
    date: new Date(),
  };

  const originalComplexObj = {
    ...complexObj,
    arr: [...complexObj.arr],
    date: complexObj.date,
  };

  expect(complexObj).toMatchObject({
    str: expect.any(String),
    num: expect.any(Number),
    bool: expect.any(Boolean),
    arr: expect.any(Array),
    date: expect.any(Date),
  });

  // Verify all properties remain unchanged
  expect(complexObj.str).toBe(originalComplexObj.str);
  expect(complexObj.num).toBe(originalComplexObj.num);
  expect(complexObj.bool).toBe(originalComplexObj.bool);
  expect(complexObj.arr).toEqual(originalComplexObj.arr);
  expect(complexObj.date).toBe(originalComplexObj.date);

  // None of the properties should have been replaced with matcher representations
  expect(complexObj.str).not.toContain("Any<");
  expect(String(complexObj.num)).not.toContain("Any<");
  expect(String(complexObj.bool)).not.toContain("Any<");
  expect(String(complexObj.arr)).not.toContain("Any<");
  expect(String(complexObj.date)).not.toContain("Any<");
});

test("issue #3521: expect.objectContaining should not mutate the original object", () => {
  const obj = {
    meta: {
      id: "123",
      timestamp: Date.now(),
      nested: {
        deep: "value",
      },
    },
    data: "some data",
  };

  const originalMeta = { ...obj.meta };

  expect(obj).toMatchObject({
    meta: expect.objectContaining({
      id: expect.any(String),
      timestamp: expect.any(Number),
    }),
  });

  // Verify no mutations
  expect(obj.meta.id).toBe(originalMeta.id);
  expect(obj.meta.timestamp).toBe(originalMeta.timestamp);
  expect(obj.meta.id).not.toContain("Any<");
});