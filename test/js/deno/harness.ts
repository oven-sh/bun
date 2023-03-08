// Deno's test utilities implemented using expect().
// https://github.com/denoland/deno/blob/main/cli/tests/unit/test_util.ts

import { concatArrayBuffers } from "bun";
import { it, expect } from "bun:test";

export function test(fn: () => void): void {
  it(fn.name, fn);
}

export function assert(condition: unknown, message?: string): asserts condition is true {
  if (message) {
    it(message, () => assert(condition));
  } else {
    expect(condition).toBeTruthy();
  }
}

export function assertFalse(condition: unknown, message?: string): asserts condition is false {
  if (message) {
    it(message, () => assertFalse(condition));
  } else {
    expect(condition).toBeFalsy();
  }
}

export function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertEquals(actual, expected));
  } else {
    expect(actual).toEqual(expected);
  }
}

export function assertExists(value: unknown, message?: string): void {
  if (message) {
    it(message, () => assertExists(value));
  } else {
    expect(value).toBeDefined();
  }
}

export function assertNotEquals(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertNotEquals(actual, expected));
  } else {
    expect(actual).not.toEqual(expected);
  }
}

export function assertStrictEquals(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertStrictEquals(actual, expected));
  } else {
    expect(actual).toStrictEqual(expected);
  }
}

export function assertNotStrictEquals(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertNotStrictEquals(actual, expected));
  } else {
    expect(actual).not.toStrictEqual(expected);
  }
}

export function assertAlmostEquals(actual: unknown, expected: number, epsilon: number = 1e-7, message?: string): void {
  if (message) {
    it(message, () => assertAlmostEquals(actual, expected));
  } else if (typeof actual === "number") {
    // TODO: toBeCloseTo()
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
  } else {
    expect(typeof actual).toBe("number");
  }
}

export function assertInstanceOf(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertInstanceOf(actual, expected));
  } else if (typeof actual === "object") {
    if (actual !== null) {
      expect(actual).toHaveProperty("constructor", expected);
    } else {
      expect(actual).not.toBeNull();
    }
  } else {
    expect(typeof actual).toBe("object");
  }
}

export function assertNotInstanceOf(actual: unknown, expected: unknown, message?: string): void {
  if (message) {
    it(message, () => assertNotInstanceOf(actual, expected));
  } else if (typeof actual === "object") {
    if (actual !== null) {
      expect(actual).not.toHaveProperty("constructor", expected);
    } else {
      expect(actual).not.toBeNull();
    }
  } else {
    expect(typeof actual).toBe("object");
  }
}

export function assertStringIncludes(actual: unknown, expected: string, message?: string): void {
  if (message) {
    it(message, () => assertStringIncludes(actual, expected));
  } else if (typeof actual === "string") {
    expect(actual).toContain(expected);
  } else {
    expect(typeof actual).toBe("string");
  }
}

export function assertArrayIncludes(actual: unknown, expected: unknown[], message?: string): void {
  if (message) {
    it(message, () => assertArrayIncludes(actual, expected));
  } else if (Array.isArray(actual)) {
    for (const value of expected) {
      expect(actual).toContain(value);
    }
  } else {
    expect(Array.isArray(actual)).toBe(true);
  }
}

export function assertMatch(actual: unknown, expected: RegExp, message?: string): void {
  if (message) {
    it(message, () => assertMatch(actual, expected));
  } else if (typeof actual === "string") {
    expect(expected.test(actual)).toBe(true);
  } else {
    expect(typeof actual).toBe("string");
  }
}

export function assertNotMatch(actual: unknown, expected: RegExp, message?: string): void {
  if (message) {
    it(message, () => assertNotMatch(actual, expected));
  } else if (typeof actual === "string") {
    expect(expected.test(actual)).toBe(false);
  } else {
    expect(typeof actual).toBe("string");
  }
}

export function assertObjectMatch(actual: unknown, expected: Record<PropertyKey, unknown>, message?: string): void {
  if (message) {
    it(message, () => assertObjectMatch(actual, expected));
  } else if (typeof actual === "object") {
    // TODO: toMatchObject()
    if (actual !== null) {
      const expectedKeys = Object.keys(expected);
      for (const key of Object.keys(actual)) {
        if (!expectedKeys.includes(key)) {
          // @ts-ignore
          delete actual[key];
        }
      }
      expect(actual).toEqual(expected);
    } else {
      expect(actual).not.toBeNull();
    }
  } else {
    expect(typeof actual).toBe("object");
  }
}

export function assertThrows(fn: () => void, message?: string): void {
  if (message) {
    it(message, () => assertThrows(fn));
  } else {
    try {
      fn();
    } catch (error) {
      expect(error).toBeDefined();
      return;
    }
    throw new Error("Expected an error to be thrown");
  }
}

export async function assertRejects(fn: () => Promise<unknown>, message?: string): Promise<void> {
  if (message) {
    it(message, () => assertRejects(fn));
  } else {
    try {
      await fn();
    } catch (error) {
      expect(error).toBeDefined();
      return;
    }
    throw new Error("Expected an error to be thrown");
  }
}

export function equal(a: unknown, b: unknown): boolean {
  return Bun.deepEquals(a, b);
}

export function fail(message: string): never {
  throw new Error(message);
}

export function unimplemented(message: string): never {
  throw new Error(`Unimplemented: ${message}`);
}

export function unreachable(): never {
  throw new Error("Unreachable");
}

export function concat(...buffers: Uint8Array[]): Uint8Array {
  return new Uint8Array(concatArrayBuffers(buffers));
}

export function inspect(...args: unknown[]): string {
  return Bun.inspect(...args);
}

// @ts-expect-error
globalThis["Deno"] = {
  test,
  inspect,
};
