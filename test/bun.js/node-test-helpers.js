import { expect as expect_ } from "bun:test";
import { gcTick } from "gc";
import assertNode from "node:assert";

const expect = (actual) => {
  gcTick();
  const ret = expect_(actual);
  gcTick();
  return ret;
};

export const strictEqual = (...args) => {
  let error = null;
  try {
    assertNode.strictEqual(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

export const throws = (...args) => {
  let error = null;
  try {
    assertNode.throws(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

export const assert = (...args) => {
  let error = null;
  try {
    assertNode(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

export const assertOk = (...args) => {
  let error = null;
  try {
    assertNode.ok(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

export const createCallCheckCtx = (done, timeout = 1500) => {
  const createDone = createDoneDotAll(done);
  // const mustCallChecks = [];

  // failed.forEach(function (context) {
  //   console.log(
  //     "Mismatched %s function calls. Expected %s, actual %d.",
  //     context.name,
  //     context.messageSegment,
  //     context.actual
  //   );
  //   console.log(context.stack.split("\n").slice(2).join("\n"));
  // });

  // TODO: Implement this to be exact only
  function mustCall(fn, exact) {
    return mustCallAtLeast(fn, exact);
  }

  function mustSucceed(fn, exact) {
    return mustCall(function (err, ...args) {
      assert.ifError(err);
      if (typeof fn === "function") return fn.apply(this, args);
    }, exact);
  }

  function mustCallAtLeast(fn, minimum) {
    return _mustCallInner(fn, minimum, "minimum");
  }

  function _mustCallInner(fn, criteria = 1, field) {
    if (process._exiting)
      throw new Error("Cannot use common.mustCall*() in process exit handler");
    if (typeof fn === "number") {
      criteria = fn;
      fn = noop;
    } else if (fn === undefined) {
      fn = noop;
    }

    if (typeof criteria !== "number")
      throw new TypeError(`Invalid ${field} value: ${criteria}`);

    let actual = 0;
    let expected = criteria;

    // mustCallChecks.push(context);
    const done = createDone(timeout);
    const _return = (...args) => {
      const result = fn.apply(this, args);
      actual++;
      if (actual >= expected) {
        done();
      }
      return result;
    };
    // Function instances have own properties that may be relevant.
    // Let's replicate those properties to the returned function.
    // Refs: https://tc39.es/ecma262/#sec-function-instances
    Object.defineProperties(_return, {
      name: {
        value: fn.name,
        writable: false,
        enumerable: false,
        configurable: true,
      },
      length: {
        value: fn.length,
        writable: false,
        enumerable: false,
        configurable: true,
      },
    });
    return _return;
  }
  return {
    mustSucceed,
    mustCall,
    mustCallAtLeast,
  };
};

export function createDoneDotAll(done) {
  let toComplete = 0;
  let completed = 0;
  function createDoneCb(timeout) {
    toComplete += 1;
    const timer = setTimeout(() => done(new Error("Timed out!")), timeout);
    return (result) => {
      clearTimeout(timer);
      if (result instanceof Error) {
        done(result);
        return;
      }
      completed += 1;
      if (completed === toComplete) {
        done();
      }
    };
  }
  return createDoneCb;
}
