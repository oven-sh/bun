// The runner must not call a Promise method that the test file can replace.
// Node v26.3.0 passes each test as it is. The tests only `await` native
// promises, and that calls none of these methods.
const assert = require("node:assert");
const { test, it, describe, suite, before, after, beforeEach, afterEach } = require("node:test");
const timers = require("node:timers/promises");

const methods = [
  [Promise, "resolve"],
  [Promise, "reject"],
  [Promise, "race"],
  [Promise, "all"],
  [Promise, "allSettled"],
  [Promise, "any"],
  [Promise, "withResolvers"],
  [Promise.prototype, "then"],
  [Promise.prototype, "catch"],
  [Promise.prototype, "finally"],
];
const originals = methods.map(([object, name]) => object[name]);

// Records each call to one of the methods. The returned function puts the
// methods back and returns the names of the methods that were called.
function recordPromiseCalls() {
  const calls = [];
  methods.forEach(([object, name], i) => {
    object[name] = function (...args) {
      calls.push(name);
      return Reflect.apply(originals[i], this, args);
    };
  });
  return () => {
    methods.forEach(([object, name], i) => {
      object[name] = originals[i];
    });
    return calls;
  };
}

// Fails `t` when the runner calls one of the methods before `t` ends.
function expectNoPromiseCalls(t) {
  const stop = recordPromiseCalls();
  t.after(() => {
    assert.deepStrictEqual(stop(), []);
  });
}

const nextImmediate = () => new Promise(resolve => setImmediate(resolve));

// The runner finishes the first of these hooks while the methods are recorded.
let stopBeforeHooks;
let beforeHookCalls;
before(() => {
  stopBeforeHooks = recordPromiseCalls();
});
before(() => {
  beforeHookCalls = stopBeforeHooks();
});

test("file-level before hooks", () => {
  assert.deepStrictEqual(beforeHookCalls, []);
});

const stopDeclarations = recordPromiseCalls();
test("test()", () => {});
it("it()", () => {});
test.skip("test.skip()", () => {});
test.todo("test.todo()", () => {});
describe("describe()", () => {
  before(() => {});
  after(() => {});
  beforeEach(() => {});
  afterEach(() => {});
  it("a test in a suite", () => {});
});
suite("suite()", () => {
  it("a test in a suite", () => {});
});
describe.skip("describe.skip()", () => {});
describe.todo("describe.todo()", () => {
  it("a test in a todo suite", () => {});
});
beforeEach(() => {});
afterEach(() => {});
const declarationCalls = stopDeclarations();

test("declarations at the top level of the file", () => {
  assert.deepStrictEqual(declarationCalls, []);
});

// The runner ends the first of the two tests and starts the second while the methods are recorded.
let stopBetweenTests;
test("the end of a test", () => {
  stopBetweenTests = recordPromiseCalls();
});
test("the start of the next test", () => {
  assert.deepStrictEqual(stopBetweenTests(), []);
});

test("subtests", async t => {
  expectNoPromiseCalls(t);
  const order = [];
  t.before(() => {
    order.push("before");
  });
  t.beforeEach(() => {});
  t.afterEach(() => {});
  const sync = t.test("sync", () => {
    order.push("sync");
  });
  const asynchronous = t.test("async", async () => {
    await nextImmediate();
    order.push("async");
  });
  const skipped = t.test("skipped", { skip: true }, () => {
    order.push("skipped");
  });
  const todo = t.test("todo", { todo: true }, () => {
    order.push("todo");
  });
  const callback = t.test("done callback", (t, done) => {
    order.push("done callback");
    setImmediate(done);
  });
  const runtimeSkip = t.test("runtime skip", t => {
    order.push("runtime skip");
    t.skip();
  });
  const nested = t.test("nested", async t => {
    await t.test("inner", () => {
      order.push("inner");
    });
  });
  const fromModule = it("declared with the it() of the module", () => {
    order.push("it");
  });
  for (const subtest of [sync, asynchronous, skipped, todo, callback, runtimeSkip, nested, fromModule]) {
    assert.ok(subtest instanceof Promise);
    assert.strictEqual(await subtest, undefined);
  }
  assert.deepStrictEqual(order, ["before", "sync", "async", "todo", "done callback", "runtime skip", "inner", "it"]);
});

test("a skipped subtest that comes first", async t => {
  expectNoPromiseCalls(t);
  assert.strictEqual(await t.test("skipped", { skip: true }, () => {}), undefined);
});

test("subtests that nothing awaits", t => {
  expectNoPromiseCalls(t);
  t.test("first", () => {});
  t.test("second", async () => {
    await nextImmediate();
  });
});

test("a done callback and a returned promise", async t => {
  expectNoPromiseCalls(t);
  const errors = [];
  t.afterEach(t => {
    errors.push(t.error.message);
  });
  // A test that takes a callback and returns a promise fails. `todo` keeps the failure away from this test.
  await t.test("settled promise", { todo: true }, async (t, done) => {});
  await t.test("pending promise", { todo: true, timeout: 60_000 }, (t, done) => nextImmediate());
  const message = "passed a callback but also returned a Promise";
  assert.deepStrictEqual(errors, [message, message]);
});

test("a subtest that throws a promise", async t => {
  expectNoPromiseCalls(t);
  // The promise is the error of the subtest. `todo` keeps the failure away from this test.
  await t.test("subtest", { todo: true }, () => {
    throw new Promise(() => {});
  });
});

test("a plan that waits", t => {
  expectNoPromiseCalls(t);
  t.plan(1, { wait: true });
  setImmediate(() => t.assert.ok(true));
});

test("a plan that waits, with a timeout", { timeout: 60_000 }, t => {
  expectNoPromiseCalls(t);
  t.plan(1, { wait: 60_000 });
  setImmediate(() => t.assert.ok(true));
});

test("subtests with a timeout", async t => {
  expectNoPromiseCalls(t);
  await t.test("sync", { timeout: 60_000 }, () => {});
  await t.test("async", { timeout: 60_000 }, async () => {
    await nextImmediate();
  });
  await t.test("a plan that waits", { timeout: 60_000 }, t => {
    t.plan(1, { wait: true });
    setImmediate(() => t.assert.ok(true));
  });
  // These two fail in node: the first by its timeout, and node cancels the
  // subtest of the second. `todo` keeps the failure away from this test.
  await t.test("the timeout ends the test", { timeout: 1, todo: true }, () => new Promise(() => {}));
  await t.test("a subtest declared during the plan wait", { timeout: 60_000, todo: true }, t => {
    t.plan(1, { wait: true });
    setImmediate(() => t.test("late", () => {}));
  });
});

test("hooks with a timeout or a signal", async t => {
  expectNoPromiseCalls(t);
  const { signal } = new AbortController();
  const ran = [];
  t.beforeEach(
    () => {
      ran.push("sync");
    },
    { timeout: 60_000 },
  );
  t.beforeEach(
    async () => {
      await nextImmediate();
      ran.push("async");
    },
    { timeout: 60_000, signal },
  );
  t.afterEach(
    () => ({
      then(resolve) {
        ran.push("thenable");
        resolve();
      },
    }),
    { timeout: 60_000 },
  );
  t.afterEach(
    (t, done) => {
      ran.push("done callback");
      done();
    },
    { signal },
  );
  await t.test("subtest", () => {});
  assert.deepStrictEqual(ran, ["sync", "async", "thenable", "done callback"]);
});

test("hooks that a timeout or a signal ends", async t => {
  expectNoPromiseCalls(t);
  const ran = [];
  // Each hook fails, so no subtest body runs. `todo` keeps the failure away from this test.
  await t.test("timeout", { todo: true }, async t => {
    t.beforeEach(() => new Promise(() => {}), { timeout: 1 });
    await t.test("subtest", () => {
      ran.push("timeout");
    });
  });
  await t.test("signal that is already aborted", { todo: true }, async t => {
    t.beforeEach(() => {}, { signal: AbortSignal.abort() });
    await t.test("subtest", () => {
      ran.push("already aborted");
    });
  });
  await t.test("signal that aborts during the hook", { todo: true }, async t => {
    const controller = new AbortController();
    t.beforeEach(
      () => {
        controller.abort();
        return new Promise(() => {});
      },
      { signal: controller.signal },
    );
    await t.test("subtest", () => {
      ran.push("aborts");
    });
  });
  assert.deepStrictEqual(ran, []);
});

test("suites declared in a running test", async t => {
  expectNoPromiseCalls(t);
  const order = [];
  t.test("a subtest before the suites", async () => {
    await nextImmediate();
    order.push("subtest");
  });
  const sync = describe("sync callback", () => {
    before(() => {
      order.push("before");
    });
    after(() => {
      order.push("after");
    });
    it("child", () => {
      order.push("child");
    });
    it.skip("skipped child", () => {
      order.push("skipped child");
    });
    describe("nested", () => {
      it("grandchild", () => {
        order.push("grandchild");
      });
    });
  });
  const asynchronous = describe("async callback", async () => {
    it("early", () => {
      order.push("early");
    });
    await nextImmediate();
    it("late", () => {
      order.push("late");
    });
  });
  const skipped = describe.skip("skipped", () => {
    order.push("skipped suite");
  });
  const todo = describe.todo("todo", () => {
    it("fails", () => {
      order.push("todo child");
      throw new Error("a todo suite keeps this failure");
    });
  });
  for (const inlineSuite of [sync, asynchronous, skipped, todo]) {
    assert.ok(inlineSuite instanceof Promise);
    assert.strictEqual(await inlineSuite, undefined);
  }
  assert.deepStrictEqual(order, ["subtest", "before", "child", "grandchild", "after", "early", "late", "todo child"]);
});

test("an async describe() callback while Promise.prototype.then is not a function", async () => {
  const order = [];
  const { then } = Promise.prototype;
  let inlineSuite;
  Promise.prototype.then = undefined;
  try {
    inlineSuite = describe("suite", async () => {
      await nextImmediate();
      it("declared late", () => {
        order.push("declared late");
      });
    });
  } finally {
    Promise.prototype.then = then;
  }
  await inlineSuite;
  assert.deepStrictEqual(order, ["declared late"]);
});

test("mock timers", async t => {
  expectNoPromiseCalls(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = timers.setTimeout(1000, "value");
  t.mock.timers.tick(1000);
  assert.strictEqual(await pending, "value");
});

// Node reports a declaration after its parent finished as a failed test, and
// it has no t.describe(). So only Bun runs this one.
test("declarations after the parent finished", { skip: !process.versions.bun }, async t => {
  let parent;
  await t.test("parent", t => {
    parent = t;
  });
  expectNoPromiseCalls(t);
  assert.strictEqual(await parent.test("late test", () => {}), undefined);
  assert.strictEqual(await parent.describe("late suite", () => {}), undefined);
});

test("a subtest declared while Promise.resolve throws", async t => {
  const original = Promise.resolve;
  Promise.resolve = () => {
    throw new Error("replaced Promise.resolve");
  };
  let subtest;
  try {
    subtest = t.test("subtest", () => {});
  } finally {
    Promise.resolve = original;
  }
  assert.strictEqual(await subtest, undefined);
});

test("a subtest declared while Promise.prototype.then throws", async t => {
  const original = Promise.prototype.then;
  Promise.prototype.then = () => {
    throw new Error("replaced Promise.prototype.then");
  };
  let subtest;
  try {
    subtest = t.test("subtest", () => {});
  } finally {
    Promise.prototype.then = original;
  }
  assert.strictEqual(await subtest, undefined);
});

test("a mocked Promise.resolve counts no call by the runner", async t => {
  const mocked = t.mock.method(Promise, "resolve");
  await t.test("subtest", () => {});
  await t.test("skipped", { skip: true }, () => {});
  assert.strictEqual(mocked.mock.callCount(), 0);
});

test("a mocked Promise.prototype.then counts no call by the runner", async t => {
  const mocked = t.mock.method(Promise.prototype, "then");
  await t.test("subtest", () => {});
  await t.test("skipped", { skip: true }, () => {});
  assert.strictEqual(mocked.mock.callCount(), 0);
});

// The runner restores the mocks of a test when the test ends. Until then, its
// subtests must run.
const ranUnderMock = [];
const { then } = Promise.prototype;

test("a mocked Promise.prototype.then that throws", t => {
  t.mock.method(Promise.prototype, "then", () => {
    throw new Error("mocked Promise.prototype.then");
  });
  t.test("first", () => {
    ranUnderMock.push("throws: first");
  });
  t.test("second", () => {
    ranUnderMock.push("throws: second");
  });
});

test("a mocked Promise.prototype.then that calls no callback", t => {
  const settled = Promise.resolve();
  t.mock.method(Promise.prototype, "then", () => settled);
  t.test("first", () => {
    ranUnderMock.push("no callback: first");
  });
  t.test("second", () => {
    ranUnderMock.push("no callback: second");
  });
});

test("the subtests ran under both mocks, and the mocks are gone", () => {
  assert.deepStrictEqual(ranUnderMock, [
    "throws: first",
    "throws: second",
    "no callback: first",
    "no callback: second",
  ]);
  assert.strictEqual(Promise.prototype.then, then);
});

// The runner finishes the first of these hooks while the methods are recorded.
let stopAfterHooks;
let afterHookCalls;
after(() => {
  stopAfterHooks = recordPromiseCalls();
});
after(() => {
  afterHookCalls = stopAfterHooks();
});
after(() => {
  assert.deepStrictEqual(afterHookCalls, []);
});

// This is the last declaration: a runner that calls Promise.resolve() throws
// here, and then the file stops.
const { resolve } = Promise;
Promise.resolve = () => {
  throw new Error("replaced Promise.resolve");
};
try {
  test("a test declared while Promise.resolve throws", () => {});
} finally {
  Promise.resolve = resolve;
}
