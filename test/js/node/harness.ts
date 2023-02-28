// @ts-ignore
import { gcTick, hideFromStackTrace } from "harness";
import assertNode from "node:assert";

type DoneCb = (err?: Error) => any;
function noop() {}
export function createTest(path: string) {
  const { expect, test, it, describe, beforeAll, afterAll, beforeEach, afterEach } = Bun.jest(path);

  hideFromStackTrace(expect);

  // Assert
  const strictEqual = (...args: any) => {
    // @ts-ignore
    assertNode.strictEqual.apply(this, args);
    expect(true).toBe(true);
  };

  const notStrictEqual = (...args: any) => {
    // @ts-ignore
    assertNode.notStrictEqual.apply(this, args);
    expect(true).toBe(true);
  };

  const deepStrictEqual = (...args: any) => {
    // @ts-ignore
    assertNode.deepStrictEqual.apply(this, args);
    expect(true).toBe(true);
  };

  const throws = (...args: any) => {
    // @ts-ignore
    assertNode.throws.apply(this, args);
    expect(true).toBe(true);
  };

  const ok = (...args: any) => {
    // @ts-ignore
    assertNode.ok.apply(this, args);
    expect(true).toBe(true);
  };

  const ifError = (...args: any) => {
    // @ts-ignore
    assertNode.ifError.apply(this, args);
    expect(true).toBe(true);
  };

  const match = (...args: any) => {
    // @ts-ignore
    assertNode.match.apply(this, args);
    expect(true).toBe(true);
  };

  const assert: typeof assertNode = function (...args: [any, ...any[]]) {
    assertNode(...args);
  } as any;

  hideFromStackTrace(strictEqual);
  hideFromStackTrace(notStrictEqual);
  hideFromStackTrace(deepStrictEqual);
  hideFromStackTrace(throws);
  hideFromStackTrace(ok);
  hideFromStackTrace(ifError);
  hideFromStackTrace(match);
  hideFromStackTrace(assert);

  Object.assign(assert, {
    strictEqual,
    deepStrictEqual,
    notStrictEqual,
    throws,
    ok,
    ifError,
    match,
  });

  // End assert

  const createCallCheckCtx = (done: DoneCb) => {
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
    function mustCall(fn?: (...args) => any, exact?: number) {
      return mustCallAtLeast(fn, exact);
    }

    function mustNotCall(reason: string = "function should not have been called") {
      const localDone = createDone();
      setTimeout(() => localDone(), 200);
      return () => {
        done(new Error(reason));
      };
    }

    function mustSucceed(fn: () => any, exact?: number) {
      return mustCall(function (err, ...args) {
        ifError(err);
        // @ts-ignore
        if (typeof fn === "function") return fn(...(args as []));
      }, exact);
    }

    function mustCallAtLeast(fn, minimum) {
      return _mustCallInner(fn, minimum, "minimum");
    }

    function _mustCallInner(fn, criteria = 1, field) {
      // @ts-ignore
      if (process._exiting) throw new Error("Cannot use common.mustCall*() in process exit handler");
      if (typeof fn === "number") {
        criteria = fn;
        fn = noop;
      } else if (fn === undefined) {
        fn = noop;
      }

      if (typeof criteria !== "number") throw new TypeError(`Invalid ${field} value: ${criteria}`);

      let actual = 0;
      let expected = criteria;

      // mustCallChecks.push(context);
      const done = createDone();
      const _return = (...args) => {
        try {
          // @ts-ignore
          const result = fn(...args);
          actual++;
          if (actual >= expected) {
            done();
          }
          return result;
        } catch (err) {
          if (err instanceof Error) done(err);
          else if (err?.toString) done(new Error(err?.toString()));
          else {
            console.error("Unknown error", err);
            done(new Error("Unknown error"));
          }
        }
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
      mustNotCall,
    };
  };

  function createDoneDotAll(done: DoneCb, globalTimeout?: number) {
    let toComplete = 0;
    let completed = 0;
    const globalTimer = globalTimeout
      ? setTimeout(() => {
          console.log("Global Timeout");
          done(new Error("Timed out!"));
        }, globalTimeout)
      : undefined;
    function createDoneCb(timeout?: number) {
      toComplete += 1;
      const timer =
        timeout !== undefined
          ? setTimeout(() => {
              console.log("Timeout");
              done(new Error("Timed out!"));
            }, timeout)
          : timeout;
      return (result?: Error) => {
        if (timer) clearTimeout(timer);
        if (globalTimer) clearTimeout(globalTimer);
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

  return {
    expect,
    test,
    it,
    describe,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    createDoneDotAll,
    strictEqual,
    notStrictEqual,
    deepStrictEqual,
    throws,
    ok,
    ifError,
    createCallCheckCtx,
    match,
    assert,
  };
}

declare namespace Bun {
  function jest(path: string): typeof import("bun:test");
}
