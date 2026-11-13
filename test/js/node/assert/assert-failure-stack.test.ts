/**
 * What a failed assertion does with stacks: with Error.stackTraceLimit, with Error.prepareStackTrace, with the stacks
 * of its operands and with its own.
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

type CallSites = { getFunctionName(): string | null }[];
type Failed = AssertionError & { actual: any; expected: any };

/**
 * What `fn` threw, and the Error.stackTraceLimit that it left. Error.prepareStackTrace and Error.stackTraceLimit are
 * put back: they belong to the process, so every later test would see them.
 */
function run(fn: () => void): { thrown: unknown; limit: unknown } {
  const { prepareStackTrace, stackTraceLimit } = Error;
  let thrown: unknown;
  let limit: unknown;
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

function failed(fn: () => void): Failed {
  const { thrown } = run(fn);
  assert.ok(thrown instanceof AssertionError);
  return thrown as Failed;
}

const frames = (error: Error) => error.stack!.split("\n").filter(line => line.startsWith("    at "));

describe("a failed assertion does not format the stacks of two Error operands", () => {
  const comparisons: [string, (actual: Error, expected: Error) => void][] = [
    ["deepStrictEqual", (actual, expected) => assert.deepStrictEqual(actual, expected)],
    ["strictEqual", (actual, expected) => assert.strictEqual(actual, expected)],
    ["deepEqual", (actual, expected) => assert.deepEqual(actual, expected)],
    ["equal", (actual, expected) => assert.equal(actual, expected)],
    ["partialDeepStrictEqual", (actual, expected) => assert.partialDeepStrictEqual(actual, expected)],
    ["notStrictEqual", actual => assert.notStrictEqual(actual, actual)],
    ["notDeepStrictEqual", actual => assert.notDeepStrictEqual(actual, actual)],
    ["notDeepEqual", actual => assert.notDeepEqual(actual, actual)],
    ["notEqual", actual => assert.notEqual(actual, actual)],
    [
      "new AssertionError()",
      (actual, expected) => {
        throw new AssertionError({ actual, expected, operator: "deepStrictEqual" });
      },
    ],
  ];

  for (const [name, compare] of comparisons) {
    test(name, () => {
      const formatted: string[] = [];
      const actual = new Error("actual", { cause: new Error("cause of actual") });
      const expected = new Error("expected", { cause: new Error("cause of expected") });
      let stackOfActual: unknown;
      const { thrown } = run(() => {
        Error.prepareStackTrace = error => {
          formatted.push(error instanceof AssertionError ? "AssertionError" : error.message);
          return `formatted ${error.message}`;
        };
        try {
          compare(actual, expected);
        } finally {
          stackOfActual = actual.stack;
        }
      });
      assert.ok(thrown instanceof AssertionError);
      // The stack of an operand is formatted when the program reads it, and not before.
      assert.deepStrictEqual(formatted, ["AssertionError", "actual"]);
      assert.strictEqual(stackOfActual, "formatted actual");
    });
  }
});

describe("a failed assertion formats its own stack one time, from the frames below the assert method", () => {
  const results: [string, (error: Error, sites: CallSites) => unknown][] = [
    ["a string that has no frame lines", () => "no frame lines"],
    ["undefined", () => undefined],
    ["the call sites", (_, sites) => sites],
    ["a string that has frame lines", (error, sites) => `${error}\n    at ${sites.join("\n    at ")}`],
  ];

  for (const [name, result] of results) {
    test(`Error.prepareStackTrace returns ${name}`, () => {
      const topFrames: (string | null | undefined)[] = [];
      function failing() {
        assert.strictEqual(1, 2);
      }
      failed(() => {
        Error.prepareStackTrace = (error, sites: CallSites) => {
          topFrames.push(sites[0]?.getFunctionName());
          return result(error, sites);
        };
        failing();
      });
      assert.deepStrictEqual(topFrames, ["failing"]);
    });
  }

  // Each calls its method in a statement of its own: a call that is the whole result of a function leaves no frame in
  // JavaScriptCore.
  const callers: [string, () => void][] = [
    [
      "ok",
      function caller() {
        assert.ok(false);
      },
    ],
    [
      "strictEqual",
      function caller() {
        assert.strictEqual(1, 2);
      },
    ],
    [
      "deepEqual",
      function caller() {
        assert.deepEqual([1], [2]);
      },
    ],
    [
      "fail",
      function caller() {
        assert.fail("message");
      },
    ],
    [
      "throws",
      function caller() {
        assert.throws(() => {});
      },
    ],
    [
      "doesNotThrow",
      function caller() {
        assert.doesNotThrow(() => {
          throw new Error("thrown");
        });
      },
    ],
    [
      "match",
      function caller() {
        assert.match("text", /no match/);
      },
    ],
    [
      "doesNotMatch",
      function caller() {
        assert.doesNotMatch("text", /text/);
      },
    ],
    [
      "ifError",
      function caller() {
        assert.ifError("not an error");
      },
    ],
  ];

  for (const [name, caller] of callers) {
    test(`the stack of assert.${name}() starts at its caller`, () => {
      assert.match(frames(failed(caller))[0], /^    at caller \(/);
    });
  }

  for (const name of ["rejects", "doesNotReject"] as const) {
    test(`the stack of assert.${name}() has the functions that await it, and nothing of node:assert`, async () => {
      async function awaiting() {
        await (name === "rejects" ? assert.rejects(Promise.resolve()) : assert.doesNotReject(Promise.reject(1)));
      }
      let thrown: unknown;
      try {
        await awaiting();
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof AssertionError);
      assert.strictEqual(thrown.operator, name);
      // node has a frame of its own task queue first.
      const frameOfFile = frames(thrown).find(frame => !frame.includes("node:"));
      assert.match(frameOfFile!, /^    at async awaiting \(/);
      assert.deepStrictEqual(
        frames(thrown).filter(frame => frame.includes("node:assert")),
        [],
      );
    });
  }

  test("a stackStartFn that is not on the stack leaves no frames", () => {
    const error = new AssertionError({ message: "message", stackStartFn: function notOnTheStack() {} });
    assert.strictEqual(error.stack, "AssertionError [ERR_ASSERTION]: message");
  });
});

describe("a failed assertion leaves Error.stackTraceLimit as it was", () => {
  const before = Error.stackTraceLimit;

  test("when Error.prepareStackTrace throws", () => {
    const fromHook = new Error("from the hook");
    const { thrown, limit } = run(() => {
      Error.prepareStackTrace = () => {
        throw fromHook;
      };
      assert.deepStrictEqual(new Error("actual"), new Error("expected"));
    });
    // The stack of the AssertionError is the one that the hook formats, and fails to.
    assert.strictEqual(thrown, fromHook);
    assert.strictEqual(limit, before);
  });

  test("when Error.prepareStackTrace throws for an operand, which nothing formats", () => {
    const { thrown, limit } = run(() => {
      Error.prepareStackTrace = error => {
        if (!(error instanceof AssertionError)) throw new Error("from the hook");
        return "formatted";
      };
      assert.deepStrictEqual(new Error("actual"), new Error("expected"));
    });
    assert.ok(thrown instanceof AssertionError);
    assert.strictEqual(limit, before);
  });

  // node restores the limit with no `finally`: each of these leaves 0 there, and every later Error has no frames.
  const fromOperand = new Error("from the operand");
  const throwing: [string, () => unknown][] = [
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
    ],
  ];

  for (const [name, fail] of throwing) {
    test(`when ${name} throws`, { skip: isNode && "node leaves Error.stackTraceLimit at 0" }, () => {
      const { thrown, limit } = run(fail);
      assert.strictEqual(thrown, fromOperand);
      assert.strictEqual(limit, before);
    });
  }

  test("and writes 0 to it, then the old value", () => {
    const written: unknown[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit")!;
    let thrown: unknown;
    try {
      Object.defineProperty(Error, "stackTraceLimit", { get: () => before, set: value => void written.push(value) });
      try {
        assert.strictEqual(1, 2);
      } catch (error) {
        thrown = error;
      }
    } finally {
      Object.defineProperty(Error, "stackTraceLimit", descriptor);
    }
    assert.ok(thrown instanceof AssertionError);
    assert.deepStrictEqual(written, [0, before]);
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

describe("a failed assertion copies two Error operands", () => {
  test("with the properties that Object.assign() copies", () => {
    const symbol = Symbol("symbol");
    const actual: any = new Error("actual", { cause: new Error("cause") });
    Object.assign(actual, { 1: "index", code: "E_CODE", [symbol]: "symbol" });
    let getterCalls = 0;
    Object.defineProperty(actual, "getter", {
      enumerable: true,
      get() {
        getterCalls++;
        delete actual.removedByGetter;
        return "from the getter";
      },
    });
    actual.removedByGetter = true;
    Object.defineProperty(actual, "notEnumerable", { value: true });

    const copy = failed(() => assert.strictEqual(actual, new Error("expected"))).actual;
    assert.notStrictEqual(copy, actual);
    assert.strictEqual(Object.getPrototypeOf(copy), Error.prototype);
    assert.deepStrictEqual(Reflect.ownKeys(copy), ["1", "code", "getter", "message", "cause", symbol]);
    assert.deepStrictEqual(
      { 1: copy[1], code: copy.code, getter: copy.getter, message: copy.message, symbol: copy[symbol] },
      { 1: "index", code: "E_CODE", getter: "from the getter", message: "actual", symbol: "symbol" },
    );
    assert.strictEqual(getterCalls, 1);
    assert.notStrictEqual(copy.cause, actual.cause);
    assert.deepStrictEqual(Reflect.ownKeys(copy.cause), ["message"]);
    assert.strictEqual(copy.cause.message, "cause");
  });

  test("also when they were made with no frames", () => {
    const limit = Error.stackTraceLimit;
    let actual: Error;
    try {
      Error.stackTraceLimit = 0;
      actual = new Error("actual");
    } finally {
      Error.stackTraceLimit = limit;
    }
    const expected = new Error("expected");
    const error = failed(() => assert.strictEqual(actual, expected));
    assert.notStrictEqual(error.actual, actual);
    assert.notStrictEqual(error.expected, expected);
    assert.deepStrictEqual(Reflect.ownKeys(error.expected), ["message"]);
  });

  test("but not when one has no stack property", () => {
    const withoutStack = new Error("actual");
    // Reading the stack formats it: then the property is there to delete in every engine.
    assert.strictEqual(typeof withoutStack.stack, "string");
    delete withoutStack.stack;
    const notAnError = Object.create(Error.prototype, { message: { value: "actual" } });
    for (const actual of [withoutStack, notAnError]) {
      const expected = new Error("expected");
      const error = failed(() => assert.strictEqual(actual, expected));
      assert.strictEqual(error.actual, actual);
      assert.strictEqual(error.expected, expected);
    }
  });

  test("and asks an operand that inherits from an Error nothing that formats a stack", () => {
    const events: string[] = [];
    const inheriting = Object.create(new Error("inherited"));
    const proxy = new Proxy(Object.create(Error.prototype), {
      has(_, key) {
        events.push(`has ${String(key)}`);
        return true;
      },
    });
    failed(() => {
      Error.prepareStackTrace = error => {
        events.push(error instanceof AssertionError ? "format AssertionError" : `format ${error.message}`);
        return "formatted";
      };
      assert.strictEqual(inheriting, proxy);
    });
    // The copy of `inheriting` inherits the stack too, and the message shows it.
    assert.deepStrictEqual(events, ["has stack", "format inherited", "format AssertionError"]);
  });

  test("and asks a Proxy operand what Object.assign() asks", () => {
    const traps: string[] = [];
    const target = Object.assign(Object.create(Error.prototype), { 1: "index", code: "E_CODE", [Symbol.for("s")]: 1 });
    Object.defineProperty(target, "stack", { value: "a stack" });
    Object.defineProperty(target, "message", { value: "message" });
    const handler: Record<string, Function> = {};
    for (const trap of Object.getOwnPropertyNames(Reflect) as (keyof typeof Reflect)[]) {
      handler[trap] = (...operands: unknown[]) => {
        const key = operands[1];
        traps.push(typeof key === "string" || typeof key === "symbol" ? `${trap} ${String(key)}` : trap);
        return (Reflect[trap] as Function)(...operands);
      };
    }
    failed(() => assert.strictEqual(new Proxy(target, handler), new Error("expected")));
    assert.deepStrictEqual(traps, [
      "has stack",
      "getPrototypeOf",
      "getPrototypeOf",
      "ownKeys",
      "getOwnPropertyDescriptor 1",
      "get 1",
      "getOwnPropertyDescriptor code",
      "get code",
      "getOwnPropertyDescriptor stack",
      "getOwnPropertyDescriptor message",
      "getOwnPropertyDescriptor Symbol(s)",
      "get Symbol(s)",
      "get message",
      "getOwnPropertyDescriptor cause",
    ]);
  });
});
