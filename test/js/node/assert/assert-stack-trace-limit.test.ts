/**
 * What a failed assertion does with Error.stackTraceLimit: the AssertionError constructor sets it to 0 while it builds
 * the message.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`, which is where the
 * expected values come from. It cannot import from "harness" for the same reason. The tests that node fails are
 * skipped there, each with what node does.
 */
import assert, { AssertionError } from "node:assert";
import { execFile } from "node:child_process";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const isNode = process.versions.bun === undefined;

// Not 0 and not the default: a limit that another test file of the same process left cannot pass for it.
const limitOfTest = 7;

/**
 * Calls `fn` with Error.stackTraceLimit at `limitOfTest`. What `fn` threw, and the limit that it left.
 * Error.prepareStackTrace and Error.stackTraceLimit are put back: they belong to the process, so every later test
 * would see them.
 */
function run(fn: () => unknown): { thrown: unknown; limit: unknown } {
  const { prepareStackTrace, stackTraceLimit } = Error;
  let thrown: unknown;
  let limit: unknown;
  Error.stackTraceLimit = limitOfTest;
  try {
    fn();
  } catch (error) {
    thrown = error;
  } finally {
    limit = Error.stackTraceLimit;
    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }
  return { thrown, limit };
}

describe("a failed assertion that throws something else leaves Error.stackTraceLimit as it was", () => {
  // In Bun the hook throws for an operand, while the message is built. In node that throw is ignored or there is none,
  // and the hook throws for the stack of the AssertionError, after the limit is back.
  const fromHook = new Error("from the hook");
  const throwFromHook = () => {
    throw fromHook;
  };
  const formatted: [string, () => unknown][] = [
    ["two Errors", () => assert.deepStrictEqual(new Error("actual"), new Error("expected"))],
    ["an Error and null", () => assert.strictEqual(new Error("actual"), null)],
    ["two Errors and a message", () => assert.strictEqual(new Error("actual"), new Error("expected"), "message")],
    ["a Proxy of an Error", () => assert.strictEqual(new Proxy(new Error("actual"), {}), new Error("expected"))],
  ];

  for (const [name, fail] of formatted) {
    test(`Error.prepareStackTrace throws for ${name}`, () => {
      const { thrown, limit } = run(() => {
        Error.prepareStackTrace = throwFromHook;
        fail();
      });
      assert.strictEqual(thrown, fromHook);
      assert.strictEqual(limit, limitOfTest);
    });
  }

  // util.inspect of node ignores a `stack` that throws, so node throws what the hook throws for the AssertionError.
  // util.inspect of Bun throws an error of its own until #45254.
  test("Error.prepareStackTrace throws for an Error inside an object", () => {
    const { thrown, limit } = run(() => {
      Error.prepareStackTrace = throwFromHook;
      assert.deepStrictEqual({ error: new Error("actual") }, { error: null });
    });
    if (isNode) {
      assert.strictEqual(thrown, fromHook);
    } else {
      assert.strictEqual(`${thrown}`, "AssertionError: handleMaxCallStackSize assertion failed: Error: from the hook");
    }
    assert.strictEqual(limit, limitOfTest);
  });

  // node restores the limit with no `finally`: each of these leaves 0 there, and every later Error has no frames.
  const fromOperand = new Error("from the operand");
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  const throwing: [string, () => unknown, (thrown: unknown) => boolean][] = [
    [
      "the message getter of an Error operand",
      () => {
        const actual = Object.defineProperty(new Error("actual"), "message", {
          get() {
            throw fromOperand;
          },
        });
        assert.strictEqual(actual, new Error("expected"));
      },
      thrown => thrown === fromOperand,
    ],
    [
      "an enumerable getter of an Error operand",
      () => {
        const actual = Object.defineProperty(new Error("actual"), "getter", {
          enumerable: true,
          get() {
            throw fromOperand;
          },
        });
        assert.strictEqual(actual, new Error("expected"));
      },
      thrown => thrown === fromOperand,
    ],
    [
      "the cause getter of an Error operand",
      () => {
        const actual = Object.defineProperty(new Error("actual"), "cause", {
          get() {
            throw fromOperand;
          },
        });
        assert.strictEqual(actual, new Error("expected"));
      },
      thrown => thrown === fromOperand,
    ],
    [
      "toString() of the message",
      () =>
        new AssertionError({
          message: {
            toString() {
              throw fromOperand;
            },
          } as unknown as string,
        }),
      thrown => thrown === fromOperand,
    ],
    ["a revoked Proxy operand", () => assert.strictEqual(revocable.proxy, {}), thrown => thrown instanceof TypeError],
    [
      "an Error operand that is its own cause",
      () => {
        const actual = new Error("actual");
        actual.cause = actual;
        assert.strictEqual(actual, new Error("expected"));
      },
      thrown => thrown instanceof RangeError,
    ],
  ];

  for (const [name, fail, isExpected] of throwing) {
    test(`${name} throws`, { skip: isNode && "node leaves Error.stackTraceLimit at 0" }, () => {
      const { thrown, limit } = run(fail);
      assert.ok(isExpected(thrown), `threw ${thrown}`);
      assert.strictEqual(limit, limitOfTest);
    });
  }

  // node throws the AssertionError. util.inspect of Bun throws a TypeError for the copy of the reason until #45254.
  test("an operand is the reason of an aborted AbortSignal", () => {
    const { thrown, limit } = run(() => assert.deepStrictEqual(AbortSignal.abort().reason, new Error("expected")));
    assert.ok(thrown instanceof (isNode ? AssertionError : TypeError), `threw ${thrown}`);
    assert.strictEqual(limit, limitOfTest);
  });
});

describe("a failed assertion throws an AssertionError when Error.stackTraceLimit is read-only", () => {
  const readOnly: [string, PropertyDescriptor][] = [
    ["not writable", { writable: false }],
    ["an accessor that has no setter", { get: () => 10 }],
  ];

  for (const [name, readOnlyDescriptor] of readOnly) {
    test(name, () => {
      const descriptor = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit")!;
      let thrown: unknown;
      try {
        Object.defineProperty(Error, "stackTraceLimit", readOnlyDescriptor);
        try {
          assert.strictEqual(1, 2);
        } catch (error) {
          thrown = error;
        }
      } finally {
        Object.defineProperty(Error, "stackTraceLimit", descriptor);
      }
      assert.ok(thrown instanceof AssertionError);
      assert.strictEqual(thrown.code, "ERR_ASSERTION");
    });
  }

  // Nothing can undo Object.freeze(Error), so this one is a program of its own.
  test("Object.freeze(Error)", async () => {
    const program = `
      const assert = require("node:assert");
      Object.freeze(Error);
      const hasFrames = error => error.stack.includes("\\n    at ");
      let thrown;
      try {
        assert.deepStrictEqual(new Error("actual"), new Error("expected"));
      } catch (error) {
        thrown = error;
      }
      console.log(JSON.stringify({ name: thrown.name, code: thrown.code, hasFrames: hasFrames(thrown), later: hasFrames(new Error()) }));
    `;
    // It rejects, with what the program wrote, if the program fails.
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", program], {
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    });
    assert.deepStrictEqual(JSON.parse(stdout), {
      name: "AssertionError",
      code: "ERR_ASSERTION",
      hasFrames: true,
      later: true,
    });
  });
});
