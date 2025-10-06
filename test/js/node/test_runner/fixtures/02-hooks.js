const { describe, test, before, after, beforeEach, afterEach } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const assert = require("node:assert");

const expectedFile = readFileSync(join(__dirname, "02-hooks.json"), "utf-8");
const { node } = JSON.parse(expectedFile);
const order = [];

before(() => {
  order.push("before global");
});

before(async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  order.push("before global async");
});

after(() => {
  order.push("after global");
});

after(async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  order.push("after global async");
});

beforeEach(() => {
  order.push("beforeEach global");
});

beforeEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  order.push("beforeEach global async");
});

afterEach(() => {
  order.push("afterEach global");
});

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  order.push("afterEach global async");
});

describe("execution order", () => {
  before(() => {
    order.push("before");
  });

  before(async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    order.push("before");
  });

  beforeEach(() => {
    order.push("beforeEach");
  });

  beforeEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    order.push("beforeEach");
  });

  afterEach(() => {
    order.push("afterEach");
  });

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    order.push("afterEach");
  });

  after(() => {
    order.push("after");
  });

  after(async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    order.push("after");
  });

  test("test 1", ({ fullName }) => {
    order.push(`test: ${fullName}`);
  });

  describe("describe 1", () => {
    before(() => {
      order.push("before > describe 1");
    });

    beforeEach(() => {
      order.push("beforeEach > describe 1");
    });

    afterEach(() => {
      order.push("afterEach > describe 1");
    });

    after(() => {
      order.push("after > describe 1");
    });

    test("test 2", ({ fullName }) => {
      order.push(`test: ${fullName}`);
    });

    describe("describe 2", () => {
      before(() => {
        order.push("before > describe 2");
      });

      beforeEach(() => {
        order.push("beforeEach > describe 2");
      });

      afterEach(() => {
        order.push("afterEach > describe 2");
      });

      after(() => {
        order.push("after > describe 2");
      });

      test("test 3", ({ fullName }) => {
        order.push(`test: ${fullName}`);
      });
    });
  });
});

after(() => {
  console.log("%AFTER%");
  Bun.jest("/").expect(order).toEqual(node);
  assert.deepEqual(order, node);
});
