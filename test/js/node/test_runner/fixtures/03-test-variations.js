const test = require("node:test");

test(); // test without name or callback

test("test with name and callback", t => {
  t.assert.ok(true);
});

test("test with name, options, and callback", { timeout: 5000 }, t => {
  t.assert.ok(true);
});

test(t => {
  t.assert.equal(t.name, "<anonymous>");
});

test(function testWithFunctionName(t) {
  t.assert.equal(t.name, "testWithFunctionName");
});

test({ timeout: 5000 }, t => {
  t.assert.equal(t.name, "<anonymous>");
});

test.describe("describe with name and callback", () => {
  test("nested test", t => {
    t.assert.ok(true);
  });
});

test.describe("describe with name, options, and callback", { timeout: 5000 }, () => {
  test("nested test", t => {
    t.assert.ok(true);
  });
});

test.skip("skipped test", t => {
  t.assert.fail("This test should be skipped");
});

test.skip("skipped test with options", { timeout: 5000 }, t => {
  t.assert.fail("This test should be skipped");
});

test.todo("todo test");

test.todo("todo test with options", { timeout: 5000 });

test.describe.skip("skipped describe", () => {
  test("nested test", t => {
    t.assert.fail("This test should be skipped");
  });
});

test.describe.todo("todo describe");
