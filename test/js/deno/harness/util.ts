// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://github.com/denoland/deno/blob/main/ext/node/polyfills/_util/async.ts

import { concatArrayBuffers } from "bun";

export function concat(...buffers: Uint8Array[]): Uint8Array {
  return new Uint8Array(concatArrayBuffers(buffers));
}

export function deferred<T>() {
  let methods;
  let state = "pending";
  const promise = new Promise<T>((resolve, reject) => {
    methods = {
      async resolve(value: T | PromiseLike<T>) {
        await value;
        state = "fulfilled";
        resolve(value);
      },
      reject(reason?: any) {
        state = "rejected";
        reject(reason);
      },
    };
  });
  Object.defineProperty(promise, "state", { get: () => state });
  return Object.assign(promise, methods);
}

export function delay(
  ms: number,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const { signal } = options;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Delay was aborted.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
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
}
