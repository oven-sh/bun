import { describe, expect, test } from "bun:test";

describe("Structured Clone Fast Path", () => {
  test("structuredClone should use a constant amount of memory for string inputs", () => {
    // Create a 100KB string to test fast path
    const largeString = Buffer.alloc(512 * 1024).toString();
    for (let i = 0; i < 100; i++) {
      structuredClone(largeString);
    }
    const rss = process.memoryUsage.rss();
    for (let i = 0; i < 10000; i++) {
      structuredClone(largeString);
    }
    const rss2 = process.memoryUsage.rss();
    const delta = rss2 - rss;
    expect(delta).toBeLessThan(1024 * 1024);
  });

  test("structuredClone should use a constant amount of memory for simple object inputs", () => {
    // Create a 100KB string to test fast path
    const largeValue = { property: Buffer.alloc(512 * 1024).toString() };
    for (let i = 0; i < 100; i++) {
      structuredClone(largeValue);
    }
    const rss = process.memoryUsage.rss();
    for (let i = 0; i < 10000; i++) {
      structuredClone(largeValue);
    }
    const rss2 = process.memoryUsage.rss();
    const delta = rss2 - rss;
    expect(delta).toBeLessThan(1024 * 1024);
  });

  test("structuredClone on object with simple properties can exceed JSFinalObject::maxInlineCapacity", () => {
    let largeValue = {};
    for (let i = 0; i < 100; i++) {
      largeValue["property" + i] = i;
    }

    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
    Bun.gc(true);
    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
  });
});
