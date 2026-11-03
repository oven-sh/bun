// The idioms of these tests: see README.md.
import { expect } from "bun:test";
import { bytes, dict, set, tuple } from "python:builtins";
import helpers from "./helpers.py";

/** `with manager as value: return body(value)` */
export const with_: (manager: any, body: (value: any) => any) => any = helpers.with_;
/** `async with manager as value: return await body(value)` */
export const asyncWith: (manager: any, body: (value: any) => Promise<any>) => Promise<any> = helpers.async_with;
/** `class name(*bases)`: the functions of `namespace` are its methods, and `this` in them is the instance. */
export const makeClass: (name: string, bases: any[], namespace: Record<string, any>, keywords?: any) => any =
  helpers.make_class;
/** A function of JavaScript for `property()`, `classmethod()` and the like: `this` is what Python passes first. */
export const method: (body: (this: any, ...args: any[]) => any) => any = helpers.method;
/** The warnings of the category that `body()` gave. */
export const warns: (category: any, body: () => void) => any[] = helpers.warns;
/** `owner.create_task(coroutine)`, for a promise: JavaScript never holds a coroutine. */
export const createTask: (owner: any, awaitable: any, keywords?: any) => any = helpers.create_task;
/** `function(*args, **kwargs)` */
export const call: (callee: any, args?: any, kwargs?: any) => any = helpers.call;

/** `(1, 2)` is `t(1, 2)`. */
export const t = (...items: any[]) => tuple(items);

/** `b"abc\xff"` is `b("abc\xff")`: a byte for each character. */
export const b = (text: string) => bytes(text, "latin-1");

/**
 * The literal of Python that the literal of JavaScript stands for, however deep: an object is a dict with str keys, a Map a
 * dict with any keys, a Set a set. An array is a list as it is, but for what it holds.
 */
export function py(value: any): any {
  if (Array.isArray(value)) return value.map(py);
  if (value instanceof Map) return dict(Array.from(value, ([key, item]) => [py(key), py(item)]));
  if (value instanceof Set) return set(Array.from(value, py));
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return dict(Object.entries(value).map(([key, item]) => [key, py(item)]));
  return value;
}

/**
 * `with self.assertRaises(type) as cm: body()`, and `cm.exception`. An array of types is the tuple of them there. With a
 * pattern: `assertRaisesRegex`, which searches `str(exception)`.
 */
export function raises(type: any, body: () => unknown, pattern?: RegExp | string): any {
  let thrown: any;
  let hasThrown = false;
  try {
    body();
  } catch (error) {
    thrown = error;
    hasThrown = true;
  }
  return checkRaised(type, hasThrown, thrown, pattern);
}

/** The same, where the body awaits. */
export async function raisesAsync(type: any, body: () => unknown, pattern?: RegExp | string): Promise<any> {
  let thrown: any;
  let hasThrown = false;
  try {
    await body();
  } catch (error) {
    thrown = error;
    hasThrown = true;
  }
  return checkRaised(type, hasThrown, thrown, pattern);
}

function checkRaised(type: any, hasThrown: boolean, thrown: any, pattern?: RegExp | string) {
  const types: any[] = Array.isArray(type) ? type : [type];
  if (!hasThrown) throw new Error(`${types.map(type => type.__name__ ?? type.name).join(" or ")} was not raised`);
  if (!types.some(type => thrown instanceof type)) expect(thrown).toBeInstanceOf(types[0]);
  if (pattern !== undefined) expect(thrown.message).toMatch(pattern);
  return thrown;
}
