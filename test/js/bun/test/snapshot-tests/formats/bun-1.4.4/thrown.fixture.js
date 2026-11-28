// Bun 1.4.4 wrote the snapshots of this file, here and in __snapshots__/thrown.fixture.js.snap.
// To add a case, run it under that version. Never update them with a later Bun.
import { expect, test } from "bun:test";

const thrower = value => () => {
  throw value;
};
const both = value => {
  expect(thrower(value)).toThrowErrorMatchingSnapshot();
  return expect(thrower(value));
};

test("an Error", () => { both(new Error("not found")).toThrowErrorMatchingInlineSnapshot(`"not found"`); });
test("an instance of a class that extends Error", () => { both(new (class HttpError extends Error {})("not found")).toThrowErrorMatchingInlineSnapshot(`"not found"`); });
test("an Error with a cause", () => { both(new Error("outer", { cause: new Error("inner") })).toThrowErrorMatchingInlineSnapshot(`"outer"`); });
test("an Error with an empty message", () => { both(new Error("")).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an Error whose message has a getter", () => { both(Object.assign(new Error("x"), { message: { get total() { return 1; } } })).toThrowErrorMatchingInlineSnapshot(`
  {
    "total": [native code],
  }
`); });
test("a plain object", () => { both({ message: "not found", code: 4 }).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an instance of a class", () => { both(new (class Failure { constructor(m) { this.message = m; } })("not found")).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object with a null prototype", () => { both(Object.assign(Object.create(null), { message: "not found" })).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("a DOMException", () => { both(new DOMException("not found", "NotFoundError")).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object that inherits Error.prototype", () => { both(Object.assign(Object.create(Error.prototype), { message: "not found" })).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object with a name", () => { both({ name: "HttpError", message: "not found" }).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("a rejected promise", async () => { await expect(Promise.reject({ message: "not found" })).rejects.toThrowErrorMatchingSnapshot(); await expect(Promise.reject({ message: "not found" })).rejects.toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object with the message 0", () => { both({ message: 0 }).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object with an empty message", () => { both({ message: "" }).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("an object with no message", () => { both({ code: 4 }).toThrowErrorMatchingInlineSnapshot(`undefined`); });
test("a string", () => { both("not found").toThrowErrorMatchingInlineSnapshot(`undefined`); });
