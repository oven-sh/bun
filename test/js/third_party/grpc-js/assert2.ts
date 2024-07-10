/*
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import assert from "assert";

const toCall = new Map<() => void, number>();
const afterCallsQueue: Array<() => void> = [];

/**
 * Assert that the given function doesn't throw an error, and then return
 * its value.
 * @param fn The function to evaluate.
 */
export function noThrowAndReturn<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    assert.throws(() => {
      throw e;
    });
    throw e; // for type safety only
  }
}

/**
 * Helper function that returns true when every function wrapped with
 * mustCall has been called.
 */
function mustCallsSatisfied(): boolean {
  let result = true;
  toCall.forEach(value => {
    result = result && value === 0;
  });
  return result;
}

export function clearMustCalls(): void {
  afterCallsQueue.length = 0;
}

/**
 * Wraps a function to keep track of whether it was called or not.
 * @param fn The function to wrap.
 */
// tslint:disable:no-any
export function mustCall<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
  const existingValue = toCall.get(fn);
  if (existingValue !== undefined) {
    toCall.set(fn, existingValue + 1);
  } else {
    toCall.set(fn, 1);
  }
  return (...args: any[]) => {
    const result = fn(...args);
    const existingValue = toCall.get(fn);
    if (existingValue !== undefined) {
      toCall.set(fn, existingValue - 1);
    }
    if (mustCallsSatisfied()) {
      afterCallsQueue.forEach(fn => fn());
      afterCallsQueue.length = 0;
    }
    return result;
  };
}

/**
 * Calls the given function when every function that was wrapped with
 * mustCall has been called.
 * @param fn The function to call once all mustCall-wrapped functions have
 *           been called.
 */
export function afterMustCallsSatisfied(fn: () => void): void {
  if (!mustCallsSatisfied()) {
    afterCallsQueue.push(fn);
  } else {
    fn();
  }
}
