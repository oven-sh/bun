import { it } from "bun:test";

it("reportError", () => {
  console.log("---BEGIN REPORT ERROR TEST--");
  // make sure we don't crash when given non-sensical types
  reportError(new Error("reportError Test!"));
  reportError(true);
  reportError(false);
  reportError(null);
  reportError(123);
  reportError(Infinity);
  reportError(NaN);
  reportError(-NaN);
  reportError("");
  reportError(new Uint8Array(1));
  reportError(new Uint8Array(0));
  reportError(new ArrayBuffer(0));
  reportError(new ArrayBuffer(1));
  reportError("string");
  reportError([]);
  reportError([123, null]);
  reportError({});
  reportError([{}]);
  console.log("---END REPORT ERROR TEST--");
});
