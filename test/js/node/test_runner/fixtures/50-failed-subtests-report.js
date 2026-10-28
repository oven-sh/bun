// Every failed subtest must be reported under its name path with its own
// error. node-test.test.ts asserts the exact report. Each message is built by
// concatenation, so an echoed source line cannot satisfy an assertion.
// The file also runs under `node --test`. A comment marks each place where
// Node v26 reports something else.
const { test, describe, it, before, after } = require("node:test");
const assert = require("node:assert");

test("table", async t => {
  for (let i = 1; i <= 3; i++) {
    await t.test("row-" + i, () => {
      assert.notStrictEqual(i, 2);
    });
  }
});

test("two", async t => {
  await t.test("first", () => {
    throw new Error("first" + " error");
  });
  await t.test("second", () => {
    throw new Error("second" + " error");
  });
});

test("own", async t => {
  await t.test("kid", () => {
    throw new Error("kid" + " error");
  });
  throw new Error("parent" + " error");
});

describe("group", () => {
  test("deep", async t => {
    await t.test("outer", async t => {
      await t.test("leaf-1", () => {
        throw new Error("leaf-1" + " error");
      });
      await t.test("passes", () => {});
      await t.test("leaf-2", () => {
        throw new Error("leaf-2" + " error");
      });
    });
  });
});

test("globals", async () => {
  await test("inner", () => {
    throw new Error("inner" + " error");
  });
  // Node also lists "suite" itself, as cancelled: its tests do not wait for a suite.
  describe("suite", () => {
    it("kid-one", () => {
      throw new Error("kid-one" + " error");
    });
    it("kid-two", () => {
      throw new Error("kid-two" + " error");
    });
  });
});

test("suite-own", async () => {
  describe("after-suite", () => {
    after(() => {
      throw new Error("after" + " boom");
    });
    it("kid", () => {
      throw new Error("after-kid" + " error");
    });
  });
  describe("throwing-suite", () => {
    throw new Error("callback" + " boom");
  });
  describe("rejecting-suite", async () => {
    await null;
    throw new Error("async callback" + " boom");
  });
  describe("before-suite", () => {
    before(() => {
      throw new Error("before" + " boom");
    });
    // Node lists "gated" as cancelled. Bun fails it with the hook's error.
    it("gated", () => {});
  });
});

test("before-hook", async t => {
  t.before(() => {
    throw new Error("hook" + " boom");
  });
  await t.test("gated-1", () => {});
  await t.test("gated-2", () => {});
});

test("odd-values", async t => {
  await t.test("zero", () => {
    throw 0;
  });
  await t.test("frozen", () => {
    throw Object.freeze(new Error("frozen" + " error"));
  });
  await t.test("getter", () => {
    const error = new Error("getter" + " error");
    Object.defineProperty(error, "failureType", {
      get() {
        throw new Error("getter" + " trap");
      },
    });
    throw error;
  });
  await t.test("looks-synthetic", () => {
    throw Object.assign(new Error("user" + " error"), { failureType: "subtestsFailed" });
  });
  const shared = new Error("shared" + " error");
  await t.test("shared-1", () => {
    throw shared;
  });
  await t.test("shared-2", () => {
    throw shared;
  });
});

// A failure that lands after its parent's verdict is not part of that verdict:
// "slow" fails only after "mid" has failed for its own reason. Node lists
// "slow" as cancelled.
test("late", async t => {
  const gate = Promise.withResolvers();
  const slowEnded = Promise.withResolvers();
  await t.test("mid", async t => {
    await t.test("early", () => {
      throw new Error("early" + " error");
    });
    t.test("slow", async () => {
      await gate.promise;
      throw new Error("slow" + " error");
    }).then(slowEnded.resolve);
    throw new Error("mid" + " error");
  });
  gate.resolve();
  await slowEnded.promise;
});

// The failures that the runner makes are listed like the thrown ones.
test("runner-made", async t => {
  await t.test("plan", t => {
    t.plan(1);
  });
  await t.test("timeout", { timeout: 1 }, () => new Promise(() => {}));
});

test("todo-kid", async t => {
  await t.test("pending", { todo: true }, () => {
    throw new Error("todo" + " error");
  });
});

// The hook's failure is the expected failure. The failed subtest must not turn the pass into a failure.
test("expected-failure", { expectFailure: true }, async t => {
  t.before(() => {
    throw new Error("expected" + " boom");
  });
  await t.test("gated", () => {});
});

// What a hook of the parent sees must not change with the report. Node runs
// the hook before it counts the subtests, and prints [true,null,null,false].
test("hook-state", async t => {
  const first = new Error("first" + " kid");
  t.after(t => {
    const { error } = t;
    console.log("HOOK " + JSON.stringify([t.passed, error?.message, error?.failureType, error?.cause === first]));
  });
  await t.test("kid-1", () => {
    throw first;
  });
  await t.test("kid-2", () => {
    throw new Error("second" + " kid");
  });
});

test("hook-state-suite-first", async t => {
  const first = new Error("suite" + " kid");
  t.after(t => {
    const { error } = t;
    console.log("HOOK " + JSON.stringify([t.passed, error?.message, error?.failureType, error?.cause === first]));
  });
  describe("suite", () => {
    it("kid", () => {
      throw first;
    });
  });
  await t.test("kid-2", () => {
    throw new Error("later" + " kid");
  });
});

test("hook-state-one", async t => {
  const only = new Error("only" + " kid");
  t.after(t => {
    const { error } = t;
    console.log("HOOK " + JSON.stringify([t.passed, error?.message, error?.failureType, error?.cause === only]));
  });
  await t.test("kid", () => {
    throw only;
  });
});

test("hook-state-nested", async t => {
  const leaf = new Error("nested" + " leaf");
  t.after(t => {
    const { error } = t;
    console.log("HOOK " + JSON.stringify([error?.message, error?.cause?.message, error?.cause?.cause === leaf]));
  });
  await t.test("mid", async t => {
    await t.test("leaf", () => {
      throw leaf;
    });
  });
});
