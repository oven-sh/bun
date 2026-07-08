const { describe, test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const order = [];
const later = fn => setTimeout(fn, 10);

describe("hook (context, done) signature", () => {
  before((t, done) => {
    assert.equal(typeof t, "object");
    assert.equal(typeof t.diagnostic, "function");
    assert.equal(typeof t.signal, "object");
    later(() => {
      order.push("before:done");
      done();
    });
  });

  beforeEach((t, done) => {
    assert.equal(typeof t, "object");
    later(() => {
      order.push("beforeEach:done");
      done();
    });
  });

  afterEach((t, done) => {
    later(() => {
      order.push("afterEach:done");
      done();
    });
  });

  after((t, done) => {
    later(() => {
      order.push("after:done");
      done();
    });
  });

  test("callback-style test waits for done()", (t, done) => {
    order.push("test:start");
    later(() => {
      order.push("test:done");
      done();
    });
  });
});

describe("hook (context) signature", () => {
  before(t => {
    assert.equal(t.name, "hook (context) signature");
    t.diagnostic("context-only before");
    order.push("before:context-only");
  });

  test("sees the setup done by the context-only before", () => {
    assert.ok(order.includes("before:context-only"));
  });
});

after(() => {
  const expected = [
    "before:done",
    "beforeEach:done",
    "test:start",
    "test:done",
    "afterEach:done",
    "after:done",
    "before:context-only",
  ];
  assert.deepStrictEqual(order, expected);
  console.log("ORDER_OK");
});
