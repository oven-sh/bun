import { expect, test } from "bun:test";

test("it will work with an existing snapshot file made with bun", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

// The entries for this test in the .snap file are what jest's serializer
// (pretty-format) writes: a hole is a line holding only the comma, and only an
// element that is actually present prints as `undefined`. Do not regenerate them with -u.
test("array holes match the snapshot entries jest writes", () => {
  expect([1, , 3]).toMatchSnapshot();
  expect([, "b"]).toMatchSnapshot();
  expect([1, 2, ,]).toMatchSnapshot();
  expect(new Array(2)).toMatchSnapshot();
  expect([,]).toMatchSnapshot();
  expect({ a: [, 1] }).toMatchSnapshot();
  expect([[, 1], , [2]]).toMatchSnapshot();
  expect([1, undefined, 3]).toMatchSnapshot();
});
