// Jest 30.5.2 wrote the first line of __snapshots__/print-throws-jest-file.fixture.js.snap and its first two entries.
// Then Bun 1.4.4 appended the others, so the keys of the file are not in Jest's order.
// It called no getter at a key and no `toJSON` to print a value, and it read no `cause`. Jest's format does, and
// throws what they throw.
// To add a case, run it under that version. Never update them with a later Bun.
const bad = () => ({
  ok: 1,
  get bad() {
    throw new Error("not ready");
  },
});
const thrower = error => () => {
  throw error;
};

test("what Jest wrote", () => {
  expect({ a: 1 }).toMatchSnapshot();
  expect(thrower(new Error("message"))).toThrowErrorMatchingSnapshot();
});
test("an own getter", () => {
  expect(bad()).toMatchSnapshot();
});
test("a getter in a nested object", () => {
  expect({ nested: [bad()] }).toMatchSnapshot();
});
test("with property matchers", () => {
  expect(bad()).toMatchSnapshot({ ok: expect.any(Number) });
});
test("with a hint", () => {
  expect(bad()).toMatchSnapshot("the hint");
});
describe("in a describe", () => {
  test("an own getter", () => {
    expect(bad()).toMatchSnapshot();
  });
});
test("two calls and one that prints", () => {
  expect(bad()).toMatchSnapshot();
  expect(bad()).toMatchSnapshot();
  expect("the third of the test").toMatchSnapshot();
});
test("a toJSON that throws", () => {
  expect({
    a: 1,
    toJSON() {
      throw new Error("not ready");
    },
  }).toMatchSnapshot();
});
test("a boxed symbol", () => {
  expect({ boxed: Object(Symbol("s")) }).toMatchSnapshot();
});
test("a thrown error whose cause getter throws", () => {
  const error = Object.defineProperty(new Error("outer"), "cause", {
    get() {
      throw new Error("not ready");
    },
  });
  expect(thrower(error)).toThrowErrorMatchingSnapshot();
});
test("a thrown error whose cause has a message getter that throws", () => {
  const cause = Object.defineProperty(new Error("inner"), "message", {
    get() {
      throw new Error("not ready");
    },
  });
  expect(thrower(new Error("outer", { cause }))).toThrowErrorMatchingSnapshot();
});
test("a promise", async () => {
  await expect(Promise.resolve(bad())).resolves.toMatchSnapshot();
  await expect(Promise.reject(bad())).rejects.toMatchSnapshot();
});
