// Values that inherit from Error.prototype and that `Error.isError()` does not accept in Bun.
// Node treats each one as the caller's error: `x instanceof Error` is true.
import util from "node:util";

function Inherits(message) {
  Error.captureStackTrace(this, Inherits);
  this.message = message;
  this.code = "E_OLD";
}
util.inherits(Inherits, Error);
Inherits.prototype.name = "Inherits";

function Created(message) {
  this.message = message;
  this.code = "E_OLD";
}
Created.prototype = Object.create(Error.prototype, { constructor: { value: Created }, name: { value: "Created" } });

function Child(message) {
  Created.call(this, message);
}
Child.prototype = Object.create(Created.prototype, { constructor: { value: Child }, name: { value: "Child" } });

function failedRequire() {
  try {
    require("./a-module-that-does-not-exist");
  } catch (e) {
    return e;
  }
}

export const inheritedErrors: [kind: string, make: () => any][] = [
  ["util.inherits(F, Error)", () => new Inherits("m")],
  ["F.prototype = Object.create(Error.prototype)", () => new Created("m")],
  ["a child of such a class", () => new Child("m")],
  ["a frozen error of such a class", () => Object.freeze(new Inherits("m"))],
  ["new DOMException()", () => new DOMException("m", "AbortError")],
  ["AbortSignal.abort().reason", () => AbortSignal.abort().reason],
  ["a Proxy of an Error", () => new Proxy(new Error("m"), {})],
  ["Object.create(new Error())", () => Object.create(new Error("m"))],
  ["{ __proto__: Error.prototype }", () => ({ __proto__: Error.prototype, message: "m" })],
  ["the error of a failed require()", failedRequire],
];

/** What `fn` throws. */
export function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return "did not throw";
}
