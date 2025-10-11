/**
 * @note this file patches `node:test` via the require cache.
 */
import { hideFromStackTrace, exampleSite } from "harness";
import assertNode from "node:assert";

type DoneCb = (err?: Error) => any;
function noop() {}
export function createTest(path: string) {
  const { expect, test, it, describe, beforeAll, afterAll, beforeEach, afterEach, mock } = Bun.jest(path);

  hideFromStackTrace(expect);

  // Assert
  const strictEqual = (...args: Parameters<typeof assertNode.strictEqual>) => {
    assertNode.strictEqual(...args);
    expect(true).toBe(true);
  };

  const notStrictEqual = (...args: Parameters<typeof assertNode.notStrictEqual>) => {
    assertNode.notStrictEqual(...args);
    expect(true).toBe(true);
  };

  const deepStrictEqual = (...args: Parameters<typeof assertNode.deepStrictEqual>) => {
    assertNode.deepStrictEqual(...args);
    expect(true).toBe(true);
  };

  const throws = (...args: Parameters<typeof assertNode.throws>) => {
    assertNode.throws(...args);
    expect(true).toBe(true);
  };

  const ok = (...args: Parameters<typeof assertNode.ok>) => {
    assertNode.ok(...args);
    expect(true).toBe(true);
  };

  const ifError = (...args: Parameters<typeof assertNode.ifError>) => {
    assertNode.ifError(...args);
    expect(true).toBe(true);
  };

  const match = (...args: Parameters<typeof assertNode.match>) => {
    assertNode.match(...args);
    expect(true).toBe(true);
  };

  interface NodeAssert {
    (args: any): void;
    strictEqual: typeof strictEqual;
    deepStrictEqual: typeof deepStrictEqual;
    notStrictEqual: typeof notStrictEqual;
    throws: typeof throws;
    ok: typeof ok;
    ifError: typeof ifError;
    match: typeof match;
  }
  const assert = function (...args: any[]) {
    // @ts-ignore
    assertNode(...args);
  } as NodeAssert;

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
    var timers: Timer[] = [];
    const createDone = createDoneDotAll(done, undefined, timers);

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
    function mustCall(fn?: (...args: any[]) => any, exact?: number) {
      return mustCallAtLeast(fn!, exact!);
    }

    function closeTimers() {
      timers.forEach(t => clearTimeout(t));
    }

    function mustNotCall(reason: string = "function should not have been called", optionalCb?: (err?: any) => void) {
      const localDone = createDone();
      timers.push(setTimeout(() => localDone(), 200));

      return () => {
        closeTimers();
        if (optionalCb) optionalCb.apply(undefined, reason ? [reason] : []);

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

    function mustCallAtLeast(fn: unknown, minimum: number) {
      return _mustCallInner(fn, minimum, "minimum");
    }

    function _mustCallInner(fn: unknown, criteria = 1, field: string) {
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
      const _return = (...args: any[]) => {
        try {
          // @ts-ignore
          const result = fn(...args);
          actual++;
          if (actual >= expected) {
            closeTimers();
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
          closeTimers();
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
      closeTimers,
    };
  };

  function createDoneDotAll(done: DoneCb, globalTimeout?: number, timers: Timer[] = []) {
    let toComplete = 0;
    let completed = 0;
    const globalTimer = globalTimeout
      ? (timers.push(
          setTimeout(() => {
            console.log("Global Timeout");
            done(new Error("Timed out!"));
          }, globalTimeout),
        ),
        timers[timers.length - 1])
      : undefined;
    function createDoneCb(timeout?: number) {
      toComplete += 1;
      const timer =
        timeout !== undefined
          ? (timers.push(
              setTimeout(() => {
                console.log("Timeout");
                done(new Error("Timed out!"));
              }, timeout),
            ),
            timers[timers.length - 1])
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
    mock,
  };
}
export { exampleSite };
declare namespace Bun {
  function jest(path: string): typeof import("bun:test");
}
