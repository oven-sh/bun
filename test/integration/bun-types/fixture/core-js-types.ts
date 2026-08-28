import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/26868
//
// bun-types declares a few ECMAScript features on the standard global interfaces
// (ArrayBuffer, PromiseConstructor, Map, Uint8Array, ...) so that they type-check
// regardless of the `lib` setting. TypeScript's own lib.*.d.ts files and core-js's
// type definitions declare the same members. Interface merging turns a different
// signature into an extra overload, so the mismatch is silent until a library such
// as core-js re-declares the standard signature in an interface that extends the
// global one: then TS2430 "incorrectly extends" is reported against that library.
//
// core-js-types is not published yet, so this file stands in for it: every
// interface below extends a global interface that bun-types adds members to, and
// re-declares those members with the signatures from TypeScript's lib files (the
// file is named above each one), which is what core-js-types does. If a bun-types
// declaration drifts from the standard one, this file stops compiling. The
// `lib: []` case in bun-types.test.ts is the one that matters most: there the
// bun-types declarations are the only ones, like for a user on an older `lib`.

// lib.es2024.arraybuffer.d.ts
interface CoreJSArrayBuffer extends ArrayBuffer {
  resize(newByteLength?: number): void;
}

interface CoreJSArrayBufferConstructor extends ArrayBufferConstructor {
  new (byteLength: number, options?: { maxByteLength?: number }): ArrayBuffer;
}

// lib.es2024.sharedmemory.d.ts
interface CoreJSSharedArrayBuffer extends SharedArrayBuffer {
  grow(newByteLength?: number): void;
}

interface CoreJSSharedArrayBufferConstructor extends SharedArrayBufferConstructor {
  new (byteLength: number, options?: { maxByteLength?: number }): SharedArrayBuffer;
}

// lib.es2024.promise.d.ts and lib.es2025.promise.d.ts
declare global {
  interface PromiseWithResolvers<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  }
}

interface CoreJSPromiseConstructor extends PromiseConstructor {
  withResolvers<T>(): PromiseWithResolvers<T>;
  try<T, U extends unknown[]>(callbackFn: (...args: U) => T | PromiseLike<T>, ...args: U): Promise<Awaited<T>>;
}

// lib.esnext.array.d.ts
interface CoreJSArrayConstructor extends ArrayConstructor {
  fromAsync<T>(
    iterableOrArrayLike: AsyncIterable<T> | Iterable<T | PromiseLike<T>> | ArrayLike<T | PromiseLike<T>>,
  ): Promise<T[]>;
  fromAsync<T, U>(
    iterableOrArrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>,
    mapFn: (value: Awaited<T>, index: number) => U,
    thisArg?: any,
  ): Promise<Awaited<U>[]>;
}

// lib.es2022.error.d.ts and lib.esnext.error.d.ts
interface CoreJSErrorOptions extends ErrorOptions {
  cause?: unknown;
}

interface CoreJSError extends Error {
  cause?: unknown;
}

interface CoreJSErrorConstructor extends ErrorConstructor {
  new (message?: string, options?: ErrorOptions): Error;
  isError(error: unknown): error is Error;
}

// lib.esnext.collection.d.ts
interface CoreJSMap<K, V> extends Map<K, V> {
  getOrInsert(key: K, defaultValue: V): V;
  getOrInsertComputed(key: K, callback: (key: K) => V): V;
}

interface CoreJSWeakMap<K extends WeakKey, V> extends WeakMap<K, V> {
  getOrInsert(key: K, defaultValue: V): V;
  getOrInsertComputed(key: K, callback: (key: K) => V): V;
}

// lib.es2025.regexp.d.ts
interface CoreJSRegExpConstructor extends RegExpConstructor {
  escape(string: string): string;
}

// lib.esnext.typedarrays.d.ts
interface CoreJSUint8Array extends Uint8Array<ArrayBuffer> {
  toBase64(options?: { alphabet?: "base64" | "base64url" | undefined; omitPadding?: boolean | undefined }): string;
  setFromBase64(
    string: string,
    options?: {
      alphabet?: "base64" | "base64url" | undefined;
      lastChunkHandling?: "loose" | "strict" | "stop-before-partial" | undefined;
    },
  ): { read: number; written: number };
  toHex(): string;
  setFromHex(string: string): { read: number; written: number };
}

interface CoreJSUint8ArrayConstructor extends Uint8ArrayConstructor {
  fromBase64(
    string: string,
    options?: {
      alphabet?: "base64" | "base64url" | undefined;
      lastChunkHandling?: "loose" | "strict" | "stop-before-partial" | undefined;
    },
  ): Uint8Array<ArrayBuffer>;
  fromHex(string: string): Uint8Array<ArrayBuffer>;
}

// The merged declarations must also behave like the standard ones at use sites.
declare const buffer: ArrayBuffer;
expectType(buffer.resize(16)).is<void>();
expectType(buffer.resize()).is<void>();

declare const shared: SharedArrayBuffer;
expectType(shared.grow(16)).is<void>();
expectType(shared.grow()).is<void>();

new ArrayBuffer(8);
new ArrayBuffer(8, { maxByteLength: 16 });
new SharedArrayBuffer(8, { maxByteLength: 16 });

const withResolvers = Promise.withResolvers<number>();
expectType(withResolvers).is<PromiseWithResolvers<number>>();
expectType(withResolvers.promise).is<Promise<number>>();
withResolvers.resolve(1);
withResolvers.resolve(Promise.resolve(1));
// @ts-expect-error the value is required when T is not void
withResolvers.resolve();
withResolvers.reject(new Error("reason"));
withResolvers.reject();

// `resolve()` with no argument is the common case for `void` promises.
const { resolve, reject } = Promise.withResolvers<void>();
resolve();
reject();

expectType(Promise.try(() => 1)).is<Promise<number>>();
expectType(Promise.try(async () => "a")).is<Promise<string>>();
expectType(Promise.try((a: number, b: string) => `${a}${b}`, 1, "b")).is<Promise<string>>();

declare const asyncNumbers: AsyncIterable<number>;
expectType(Array.fromAsync([1, Promise.resolve(2)])).is<Promise<number[]>>();
expectType(Array.fromAsync(asyncNumbers)).is<Promise<number[]>>();
expectType(Array.fromAsync([1, 2], n => `${n}`)).is<Promise<string[]>>();
expectType(Array.fromAsync(asyncNumbers, async n => n > 1)).is<Promise<boolean[]>>();
Array.fromAsync(
  [1, 2],
  (n, index) => {
    expectType(n).is<number>();
    expectType(index).is<number>();
    return n;
  },
  { thisArg: true },
);

declare const caught: unknown;
if (Error.isError(caught)) {
  expectType(caught).is<Error>();
}

expectType(RegExp.escape("foo.bar")).is<string>();

const bytes = new Uint8Array(8);
expectType(bytes.setFromBase64("aGVsbG8=")).is<{ read: number; written: number }>();
bytes.setFromBase64("aGVsbG8", { alphabet: "base64", lastChunkHandling: "loose" });
// @ts-expect-error the second argument is an options object, not an offset
bytes.setFromBase64("aGVsbG8=", 2);
expectType(bytes.setFromHex("68656c6c6f")).is<{ read: number; written: number }>();
expectType(bytes.toBase64({ alphabet: "base64url", omitPadding: true })).is<string>();
expectType(bytes.toHex()).is<string>();
expectType(Uint8Array.fromBase64("aGVsbG8=", { lastChunkHandling: "strict" })).is<Uint8Array<ArrayBuffer>>();
expectType(Uint8Array.fromHex("68656c6c6f")).is<Uint8Array<ArrayBuffer>>();

export {};
