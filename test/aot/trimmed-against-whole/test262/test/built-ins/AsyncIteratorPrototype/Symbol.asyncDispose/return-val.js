// Copyright (C) 2023 Ron Buckton. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-%asynciteratorprototype%-@@asyncDispose
description: Return value of @@asyncDispose on %AsyncIteratorPrototype%
info: |
  %AsyncIteratorPrototype% [ @@asyncDispose ] ( )

  1. Let O be the this value.
  2. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  3. Let return be GetMethod(O, "return").
  4. IfAbruptRejectPromise(return, promiseCapability).
  5. If return is undefined, then
    a. Perform ! Call(promiseCapability.[[Resolve]], undefined, « undefined »).
  6. Else,
    a. Let result be Call(return, O, « undefined »).
    b. IfAbruptRejectPromise(result, promiseCapability).
    c. Let resultWrapper be Completion(PromiseResolve(%Promise%, result)).
    d. IfAbruptRejectPromise(resultWrapper, promiseCapability).
    e. Let unwrap be a new Abstract Closure that performs the following steps when called:
      i. Return undefined.
    f. Let onFulfilled be CreateBuiltinFunction(unwrap, 1, "", « »).
    g. Perform PerformPromiseThen(resultWrapper, onFulfilled, undefined, promiseCapability).
  7. Return promiseCapability.[[Promise]].

features: [explicit-resource-management]
---*/

async function* generator() {}
const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(generator.prototype))

assert(AsyncIteratorPrototype[Symbol.asyncDispose]() instanceof Promise);
