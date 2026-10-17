// How node:test checks the options of a declaration, as Node v26.3.0 does it
// (lib/internal/test_runner/test.js). This whole file passes under
// `node --test` on the node v26.3.0 binary.
//
// - The Test constructor checks tags, concurrency, timeout, signal and
//   expectFailure, in that order. A suite, a hook and run() share it. A hook
//   gives it only timeout and signal, run() only concurrency, timeout and signal.
// - `plan` is not one of those checks. A plan that is not truthy is never
//   looked at, and a suite never looks at its plan.
import assert from "node:assert";
import { after, afterEach, before, beforeEach, describe, it, run, suite, test } from "node:test";

const noop = () => {};

// Each value is invalid. The entries are in the order node checks the options.
const invalid = [
  ["tags", 5, "ERR_INVALID_ARG_TYPE"],
  ["concurrency", "x", "ERR_INVALID_ARG_TYPE"],
  ["timeout", -1, "ERR_OUT_OF_RANGE"],
  ["signal", 1, "ERR_INVALID_ARG_TYPE"],
  ["expectFailure", {}, "ERR_INVALID_ARG_VALUE"],
];
const nodeOrder = invalid.map(([name, , code]) => `${name}: ${code}`);

// Returns the option that `declare` rejects, taken from the error message.
function rejected(declare, options) {
  try {
    declare(options);
  } catch (err) {
    return `${/options\.([a-zA-Z]+)/.exec(err.message)?.[1]}: ${err.code}`;
  }
  return "no error";
}

// Declares with every option of `entries` invalid, then without the first one,
// and so on. The result is the order in which the options are checked.
function checkOrder(declare, entries = invalid) {
  return entries.map((_, i) => rejected(declare, Object.fromEntries(entries.slice(i))));
}

// The tags warning is emitted once per process, by the first tags array that
// has an element. An empty array does not warn. The second array below is the
// first one with an element. The element is invalid, and node warns before it
// checks the elements.
const tagWarnings = [];
const { emitWarning } = process;
process.emitWarning = function (warning, type) {
  tagWarnings.push(`${type}: ${warning}`);
  return emitWarning.apply(this, arguments);
};
const emptyTagsArray = rejected(options => test("a test with an empty tags array", options, noop), { tags: [] });
const warningsAfterEmptyArray = tagWarnings.length;
const firstTagsArray = rejected(options => test("never declared", options, noop), { tags: [5] });
process.emitWarning = emitWarning;

test("a tags array with an element warns before its elements are checked", () => {
  assert.strictEqual(emptyTagsArray, "no error");
  assert.strictEqual(warningsAfterEmptyArray, 0);
  assert.strictEqual(firstTagsArray, "tags: ERR_INVALID_ARG_TYPE");
  assert.deepStrictEqual(tagWarnings, [
    "ExperimentalWarning: Test tags is an experimental feature and might change at any time",
  ]);
});

test("an empty tag is rejected with the message of a tag filter", () => {
  assert.throws(() => test("never declared", { tags: ["db", ""] }, noop), {
    code: "ERR_INVALID_ARG_VALUE",
    message: "The property 'options.tags[1]' must not be empty. Received ''",
  });
});

// --- The order of the checks -------------------------------------------------

const atModuleLevel = {
  test: checkOrder(options => test("never declared", options, noop)),
  it: checkOrder(options => it("never declared", options, noop)),
  describe: checkOrder(options => describe("never declared", options, noop)),
  suite: checkOrder(options => suite("never declared", options, noop)),
};

test("a declaration at module level checks tags, concurrency, timeout, signal, expectFailure", () => {
  assert.deepStrictEqual(atModuleLevel, { test: nodeOrder, it: nodeOrder, describe: nodeOrder, suite: nodeOrder });
});

describe("a declaration inside a suite", () => {
  const inSuite = {
    it: checkOrder(options => it("never declared", options, noop)),
    describe: checkOrder(options => describe("never declared", options, noop)),
  };

  it("checks the options in the same order", () => {
    assert.deepStrictEqual(inSuite, { it: nodeOrder, describe: nodeOrder });
  });
});

test("a declaration inside a test checks the options in the same order", t => {
  assert.deepStrictEqual(
    {
      test: checkOrder(options => test("never declared", options, noop)),
      describe: checkOrder(options => describe("never declared", options, noop)),
      "t.test": checkOrder(options => t.test("never declared", options, noop)),
    },
    { test: nodeOrder, describe: nodeOrder, "t.test": nodeOrder },
  );
});

let finished;
let lateSuite;
test("a test that finishes", t => {
  finished = t;
  // This callback runs after the test finished, and the test is still its parent.
  lateSuite = new Promise(resolve => {
    setImmediate(() => resolve(checkOrder(options => describe("never declared", options, noop))));
  });
});

test("a subtest or a suite declared after its parent finished gets every check", async () => {
  assert.deepStrictEqual(
    checkOrder(options => finished.test("never declared", options, noop)),
    nodeOrder,
  );
  assert.deepStrictEqual(await lateSuite, nodeOrder);
});

test("the order does not depend on the order of the keys", () => {
  const reversed = Object.fromEntries(invalid.toReversed());
  assert.deepStrictEqual(Object.keys(reversed), ["expectFailure", "signal", "timeout", "concurrency", "tags"]);
  assert.strictEqual(
    rejected(options => test("never declared", options, noop), reversed),
    "tags: ERR_INVALID_ARG_TYPE",
  );
});

test("a hook checks timeout, then signal, and no other option", t => {
  const hooks = {
    before: options => before(noop, options),
    after: options => after(noop, options),
    beforeEach: options => beforeEach(noop, options),
    afterEach: options => afterEach(noop, options),
    "t.before": options => t.before(noop, options),
    "t.after": options => t.after(noop, options),
    "t.beforeEach": options => t.beforeEach(noop, options),
    "t.afterEach": options => t.afterEach(noop, options),
  };
  // tags and concurrency are not checked, so timeout is reported three times.
  // With only an invalid expectFailure left, the hook is accepted.
  const hookOrder = [
    "timeout: ERR_OUT_OF_RANGE",
    "timeout: ERR_OUT_OF_RANGE",
    "timeout: ERR_OUT_OF_RANGE",
    "signal: ERR_INVALID_ARG_TYPE",
    "no error",
  ];
  for (const [name, declare] of Object.entries(hooks)) {
    assert.deepStrictEqual(checkOrder(declare), hookOrder, name);
  }
});

test("run() checks concurrency, timeout, signal in that order", () => {
  // run() gives these three options to the Test constructor of its root test.
  const rootOptions = invalid.filter(([name]) => name !== "tags" && name !== "expectFailure");
  assert.deepStrictEqual(
    checkOrder(options => run({ files: [], ...options }), rootOptions),
    ["concurrency: ERR_INVALID_ARG_TYPE", "timeout: ERR_OUT_OF_RANGE", "signal: ERR_INVALID_ARG_TYPE"],
  );
});

// --- The plan option ----------------------------------------------------------

test("an invalid plan is not reported when another option is invalid", () => {
  // The other invalid option is reported, whatever its place in the order.
  for (const [name, value, code] of invalid) {
    assert.strictEqual(
      rejected(options => test("never declared", options, noop), { plan: "x", [name]: value }),
      `${name}: ${code}`,
    );
  }
});

// The same at module level, where the declaration registers the test with the runner.
const nullPlanAtModuleLevel = rejected(options => test("a test with plan: null", options, noop), { plan: null });

test("a plan option that is not truthy is accepted", async t => {
  assert.strictEqual(nullPlanAtModuleLevel, "no error");
  const ran = [];
  for (const plan of [null, undefined, false, 0, "", NaN]) {
    await t.test(`plan: ${String(plan) || '""'}`, { plan }, () => {
      ran.push(plan);
    });
  }
  assert.deepStrictEqual(ran, [null, undefined, false, 0, "", NaN]);
});

test("a suite accepts any plan option and never applies it", async t => {
  const ran = [];
  for (const plan of ["x", -1, 1.5, true, {}, 2 ** 32]) {
    await t.test(`a suite with plan: ${typeof plan === "object" ? "{}" : plan}`, () => {
      describe("suite", { plan }, () => {
        it("runs", () => {
          ran.push(plan);
        });
      });
    });
  }
  assert.deepStrictEqual(ran, ["x", -1, 1.5, true, {}, 2 ** 32]);
});

// --- A hook reads its two options once ----------------------------------------

// Returns an options object that records each read of one of `names`.
function countReads(names, reads) {
  const options = {};
  for (const name of names) {
    Object.defineProperty(options, name, {
      enumerable: true,
      get() {
        reads.push(name);
        return undefined;
      },
    });
  }
  return options;
}

test("a hook reads its two options once", async t => {
  const reads = [];
  t.beforeEach(noop, countReads(["timeout", "signal"], reads));
  const atDeclaration = reads.toSorted();
  await t.test("runs the hook", noop);
  assert.deepStrictEqual(atDeclaration, ["signal", "timeout"]);
  assert.deepStrictEqual(reads.toSorted(), ["signal", "timeout"]);
});

// --- Each option reaches the test it was declared on -------------------------

// A skipped body or suite callback that runs records itself here.
const skippedBodies = [];

test("a skip option skips a test declared at module level", { skip: true }, () => {
  skippedBodies.push("test");
});

test("a todo option keeps a failure from failing the run", { todo: true }, () => {
  throw new Error("a todo failure");
});

test("tags reach a test declared at module level", { tags: ["A", "a", "B"] }, t => {
  assert.deepStrictEqual(t.tags, ["a", "b"]);
});

test("an expectFailure option reaches a test declared at module level", { expectFailure: /the expected one/ }, () => {
  throw new Error("the expected one");
});

describe("a suite with a skip option", { skip: true }, () => {
  skippedBodies.push("suite");
});

describe("a suite with a todo option", { todo: true }, () => {
  it("fails without failing the run", () => {
    throw new Error("a todo failure");
  });
});

describe("a suite with tags", { tags: ["Suite"] }, () => {
  it("gives them to its tests", { tags: ["own", "SUITE"] }, t => {
    assert.deepStrictEqual(t.tags, ["suite", "own"]);
  });
});

test("the options of a subtest and of a suite inside a test reach them", async t => {
  await t.test("a skipped subtest", { skip: true }, () => {
    skippedBodies.push("subtest");
  });
  await t.test("a subtest with tags", { tags: ["Sub"] }, child => {
    assert.deepStrictEqual(child.tags, ["sub"]);
  });
  await t.test("a subtest with expectFailure", { expectFailure: /the expected one/ }, () => {
    throw new Error("the expected one");
  });
  await describe("a skipped suite", { skip: true }, () => {
    skippedBodies.push("suite inside a test");
  });
  await describe("a suite with tags", { tags: ["Inner"] }, () => {
    it("gives them to its tests", child => {
      assert.deepStrictEqual(child.tags, ["inner"]);
    });
  });
  // The skipped test and suite above were declared before this test.
  assert.deepStrictEqual(skippedBodies, []);
});
