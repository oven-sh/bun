export * from "./harness/test.js";
export * from "./harness/util.js";
export * from "./harness/assert.js";
export * from "./harness/fixture.js";

import { readTextFile } from "./harness/fixture.js";
import { callerSourceOrigin } from "bun:jsc";
import { test } from "./harness/test.js";
import { hideFromStackTrace } from "harness";

const internalSymbol = Symbol("Deno[internal]");
class BrokenTest extends Error {
  constructor(message) {
    super(message);
    this.name = "BrokenTest";
  }
}

hideFromStackTrace(BrokenTest.prototype.constructor);

const handler = {
  get(target: any, prop: string) {
    throw new BrokenTest(
      "Deno[Deno.internal]." +
        String(prop) +
        " accessed in " +
        callerSourceOrigin() +
        ".\n\nThis test should not be included in the test harness. Please skip or remove it from the test runner.",
    );
  },
};

hideFromStackTrace(handler.get);

export const Deno = {
  test,
  readTextFile,
  internal: internalSymbol,
  [internalSymbol]: new Proxy({}, handler),
};

// @ts-expect-error
globalThis["Deno"] = Deno;

export const window = {
  crypto: crypto,
};

// @ts-expect-error
globalThis["window"] = window;
