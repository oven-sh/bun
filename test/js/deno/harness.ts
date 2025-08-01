import type { Server } from "bun";
import { serve, deepEquals, concatArrayBuffers } from "bun";
import { join } from "path";
import { hideFromStackTrace } from "harness";
import resources from "./resources.json";

type Fn = () => void | Promise<unknown>;
type Options = {
  permissions?:
    | "none"
    | {
        net?: boolean;
        read?: boolean;
      };
  ignore?: boolean;
};

/**
 * @example
 * const { test, assert } = createDenoTest(import.meta.path);
 * test(function testAssert() {
 *   assert(true);
 * });
 */
export function createDenoTest(path: string, defaultTimeout = 5000) {
  const { expect, test, beforeAll, afterAll } = Bun.jest(path);

  let server: Server;

  beforeAll(() => {
    server = serve({
      port: 0,
      fetch(request: Request): Response {
        const { url } = request;
        const { pathname, search } = new URL(url);
        if (pathname === "/echo_server") {
          return new Response(request.body, request);
        }
        const target = new URL(`${pathname}${search}`, resources.baseUrl);
        return Response.redirect(target.toString());
      },
    });
    globalThis.PORT = server.port;
  });

  afterAll(() => {
    if (server) {
      server.stop(true);
    }
  });

  // https://deno.land/api@v1.31.2?s=Deno.test

  const denoTest = (arg0: Fn | Options, arg1?: Fn) => {
    if (typeof arg0 === "function") {
      test(arg0.name, arg0, defaultTimeout);
    } else if (typeof arg1 === "function") {
      if (
        arg0?.ignore === true ||
        arg0?.permissions === "none" ||
        arg0?.permissions?.net === false ||
        arg0?.permissions?.read === false
      ) {
        test.skip(arg1.name, arg1);
      } else {
        test(arg1.name, arg1);
      }
    } else {
      unimplemented(`test(${typeof arg0}, ${typeof arg1})`);
    }
  };

  denoTest.ignore = (arg0: Fn | Options, arg1?: Fn) => {
    if (typeof arg0 === "function") {
      test.skip(arg0.name, arg0);
    } else if (typeof arg1 === "function") {
      test.skip(arg1.name, arg1);
    } else {
      unimplemented(`test.ignore(${typeof arg0}, ${typeof arg1})`);
    }
  };

  denoTest.todo = (arg0: Fn | Options, arg1?: Fn) => {
    if (typeof arg0 === "function") {
      test.todo(arg0.name, arg0);
    } else if (typeof arg1 === "function") {
      test.todo(arg1.name, arg1);
    } else {
      unimplemented(`test.todo(${typeof arg0}, ${typeof arg1})`);
    }
  };

  // Deno's assertions implemented using expect().
  // https://github.com/denoland/deno/blob/main/cli/tests/unit/test_util.ts

  const assert = (condition: unknown, message?: string) => {
    expect(condition).toBeTruthy();
  };

  const assertFalse = (condition: unknown, message?: string) => {
    expect(condition).toBeFalsy();
  };

  const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).toEqual(expected);
  };

  const assertExists = (value: unknown, message?: string) => {
    expect(value).toBeDefined();
  };

  const assertNotEquals = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).not.toEqual(expected);
  };

  const assertStrictEquals = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).toStrictEqual(expected);
  };

  const assertNotStrictEquals = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).not.toStrictEqual(expected);
  };

  const assertAlmostEquals = (actual: unknown, expected: number, epsilon: number = 1e-7, message?: string) => {
    if (typeof actual === "number") {
      // TODO: toBeCloseTo()
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
    } else {
      expect(typeof actual).toBe("number");
    }
  };

  const assertGreaterThan = (actual: number, expected: number, message?: string) => {
    expect(actual).toBeGreaterThan(expected);
  }

  const assertGreaterThanOrEqual = (actual: number, expected: number, message?: string) => {
    expect(Math.ceil(actual)).toBeGreaterThanOrEqual(expected);
  }

  const assertLessThan = (actual: number, expected: number, message?: string) => {
    expect(actual).toBeLessThan(expected);
  }

  const assertLessThanOrEqual = (actual: number, expected: number, message?: string) => {
    expect(actual).toBeLessThanOrEqual(expected);
  }

  const assertInstanceOf = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).toBeInstanceOf(expected);
  };

  const assertNotInstanceOf = (actual: unknown, expected: unknown, message?: string) => {
    expect(actual).not.toBeInstanceOf(expected);
  };

  const assertStringIncludes = (actual: unknown, expected: string, message?: string) => {
    if (typeof actual === "string") {
      expect(actual).toContain(expected);
    } else {
      expect(typeof actual).toBe("string");
    }
  };

  const assertArrayIncludes = (actual: unknown, expected: unknown[], message?: string) => {
    if (Array.isArray(actual)) {
      for (const value of expected) {
        expect(actual).toContain(value);
      }
    } else {
      expect(Array.isArray(actual)).toBe(true);
    }
  };

  const assertMatch = (actual: unknown, expected: RegExp, message?: string) => {
    if (typeof actual === "string") {
      expect(expected.test(actual)).toBe(true);
    } else {
      expect(typeof actual).toBe("string");
    }
  };

  const assertNotMatch = (actual: unknown, expected: RegExp, message?: string) => {
    if (typeof actual === "string") {
      expect(expected.test(actual)).toBe(false);
    } else {
      expect(typeof actual).toBe("string");
    }
  };

  const assertObjectMatch = (actual: unknown, expected: Record<PropertyKey, unknown>, message?: string) => {
    if (typeof actual === "object") {
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
  };

  const assertThrows = (fn: () => void, message?: string) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeDefined();
      return;
    }
    throw new Error("Expected an error to be thrown");
  };

  const assertRejects = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
    } catch (error) {
      expect(error).toBeDefined();
      return;
    }
    throw new Error("Expected an error to be thrown");
  };

  const equal = (a: unknown, b: unknown) => {
    return deepEquals(a, b);
  };

  const fail = (message: string): never => {
    throw new Error(message);
  };

  const unimplemented = (message: string): never => {
    throw new Error(`Unimplemented: ${message}`);
  };

  const unreachable = (): never => {
    throw new Error("Unreachable");
  };

  // Copyright 2018+ the Deno authors. All rights reserved. MIT license.
  // https://github.com/denoland/deno/blob/main/ext/node/polyfills/_util/async.ts

  const deferred = () => {
    let methods;
    let state = "pending";
    const promise = new Promise((resolve, reject) => {
      methods = {
        async resolve(value: unknown) {
          await value;
          state = "fulfilled";
          resolve(value);
        },
        reject(reason?: unknown) {
          state = "rejected";
          reject(reason);
        },
      };
    });
    Object.defineProperty(promise, "state", { get: () => state });
    return Object.assign(promise, methods);
  };

  const delay = async (ms: number, options: { signal?: AbortSignal } = {}) => {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Delay was aborted.", "AbortError"));
    }
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(i);
        reject(new DOMException("Delay was aborted.", "AbortError"));
      };
      const done = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const i = setTimeout(done, ms);
      signal?.addEventListener("abort", abort, { once: true });
    });
  };

  // https://deno.land/std@0.171.0/bytes/concat.ts

  const concat = (...buffers: Uint8Array[]): Uint8Array => {
    return concatArrayBuffers(buffers, Infinity, true);
  };

  // https://deno.land/api@v1.31.1?s=Deno.readTextFile

  const readTextFile = async (path: string): Promise<string> => {
    return await Bun.file(join(import.meta.dir, 'fixtures', path)).text();
  };

  // Globals

  const window = {
    crypto,
  };

  // @ts-ignore
  globalThis.window = window;

  const internal = Symbol("Deno[internal]");
  const mockInternal = {
    get(target: unknown, property: unknown) {
      if (property === "inspectArgs") {
        return {};
      }
      throw new Error(`Deno[Deno.internal].${property}`);
    },
  };
  hideFromStackTrace(mockInternal.get);

  const mockInspect = () => {
    throw new Error("Deno.inspect()");
  };
  hideFromStackTrace(mockInspect);

  const Deno = {
    test: denoTest,
    readTextFile,
    internal,
    [internal]: new Proxy({}, mockInternal),
    inspect: mockInspect,
  };

  // @ts-ignore
  globalThis.Deno = Deno;

  const exports = {
    test: denoTest,
    assert,
    assertFalse,
    assertEquals,
    assertExists,
    assertNotEquals,
    assertStrictEquals,
    assertNotStrictEquals,
    assertAlmostEquals,
    assertGreaterThan,
    assertGreaterThanOrEqual,
    assertLessThan,
    assertLessThanOrEqual,
    assertInstanceOf,
    assertNotInstanceOf,
    assertStringIncludes,
    assertArrayIncludes,
    assertMatch,
    assertNotMatch,
    assertObjectMatch,
    assertThrows,
    assertRejects,
    equal,
    fail,
    unimplemented,
    unreachable,
    deferred,
    delay,
    concat,
  };

  for (const property of [...Object.values(exports), ...Object.values(Deno)]) {
    if (typeof property === "function") {
      hideFromStackTrace(property);
    }
  }

  return exports;
}

declare namespace Bun {
  function jest(path: string): typeof import("bun:test");
}
