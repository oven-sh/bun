// The order in which the runner runs subtests, inline suites and late before
// hooks of one test. Node v26.3.0 passes each test as it is.
const assert = require("node:assert");
const { test, describe, it, before } = require("node:test");

const nextImmediate = () => new Promise(resolve => setImmediate(resolve));
const microtasks = async count => {
  for (let i = 0; i < count; i++) await null;
};

let slowSubtest;
test("a before hook added while a subtest runs", t => {
  slowSubtest = [];
  t.test("slow", async () => {
    slowSubtest.push("start");
    await nextImmediate();
    slowSubtest.push("end");
  });
  t.before(() => {});
});
test("does not let the test end before that subtest", () => {
  assert.deepStrictEqual(slowSubtest, ["start", "end"]);
});

test("a before hook added while a subtest runs keeps the later subtests behind it", async t => {
  const order = [];
  t.test("slow", async () => {
    order.push("slow: start");
    await nextImmediate();
    order.push("slow: end");
  });
  t.before(() => {});
  await t.test("last", () => {
    order.push("last");
  });
  assert.deepStrictEqual(order, ["slow: start", "slow: end", "last"]);
});

test("a before hook that starts 5 microtasks is done with them when the next subtest starts", async t => {
  const order = [];
  t.before(() => {
    microtasks(5).then(() => order.push("hook"));
  });
  await t.test("subtest", () => {
    order.push("subtest");
  });
  assert.deepStrictEqual(order, ["hook", "subtest"]);
});

test("a child of an inline suite that starts 10 microtasks is done with them when the suite is", async () => {
  const order = [];
  let started;
  await describe("suite", () => {
    it("child", () => {
      started = microtasks(10).then(() => order.push("child"));
    });
  });
  order.push("suite");
  await started;
  assert.deepStrictEqual(order, ["child", "suite"]);
});

test("a subtest that a describe() callback adds to the outer test starts before the children of the suite", async t => {
  const order = [];
  await describe("suite", () => {
    it("child", () => {
      order.push("child");
    });
    t.test("subtest of the outer test", async () => {
      await microtasks(1);
      order.push("subtest");
    });
  });
  assert.deepStrictEqual(order, ["subtest", "child"]);
});

test("a child of an inline suite waits for a before hook that the async callback adds late", async () => {
  const order = [];
  await describe("suite", async () => {
    it("child", () => {
      order.push("child");
    });
    await nextImmediate();
    before(() => {
      order.push("before");
    });
  });
  assert.deepStrictEqual(order, ["before", "child"]);
});

test("a subtest of the outer test can await a child of an inline suite with an async callback", async t => {
  const ran = [];
  await describe("suite", async () => {
    const child = it("child", () => {
      ran.push("child");
    });
    t.test("subtest of the outer test", async () => {
      await child;
      ran.push("subtest");
    });
  });
  assert.deepStrictEqual(ran.sort(), ["child", "subtest"]);
});

test("a subtest of the outer test can await a child of an inline suite that returns a thenable", async t => {
  const ran = [];
  await describe("suite", () => {
    const child = it("child", () => {
      ran.push("child");
    });
    t.test("subtest of the outer test", async () => {
      await child;
      ran.push("subtest");
    });
    return {
      then(resolve) {
        resolve();
      },
    };
  });
  assert.deepStrictEqual(ran.sort(), ["child", "subtest"]);
});

test("a thenable from a describe() callback has then() called once", async () => {
  let calls = 0;
  await describe("suite", () => {
    it("child", () => {});
    return {
      then(resolve) {
        calls++;
        resolve();
      },
    };
  });
  assert.strictEqual(calls, 1);
});

// `todo` keeps the failure of each suite below away from its test.
test("an async describe() callback that rejects with a pending promise fails the suite", async () => {
  await describe("suite", { todo: true }, async () => {
    throw new Promise(() => {});
  });
});

test("a thenable from a describe() callback whose then() throws fails the suite", async () => {
  await describe("suite", { todo: true }, () => ({
    then() {
      throw new Error("then() threw");
    },
  }));
});

function frames(stack) {
  return stack.split("\n").filter(line => line.trimStart().startsWith("at ")).length;
}

test("the subtests that wait for a subtest are not in its stack", async t => {
  const stacks = [];
  for (const waiting of [2, 50]) {
    await t.test(`${waiting} subtests wait`, t => {
      t.test("first", async () => {
        await null;
        stacks.push(new Error("stack").stack);
      });
      for (let i = 0; i < waiting; i++) t.test("waits", () => {});
    });
  }
  assert.strictEqual(frames(stacks[1]), frames(stacks[0]));
});

// Node fails this hook when the abort comes in the 6 microtasks after its promise resolves.
test("an abort after a hook ended does not fail the hook", { skip: !process.versions.bun }, async t => {
  const controller = new AbortController();
  let endHook;
  t.beforeEach(() => new Promise(resolve => (endHook = resolve)), { signal: controller.signal });
  setImmediate(() => {
    endHook();
    controller.abort();
  });
  let ran = false;
  await t.test("subtest", () => {
    ran = true;
  });
  assert.ok(ran);
});
