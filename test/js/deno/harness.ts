export * from "./harness/test.js";
export * from "./harness/util.js";
export * from "./harness/assert.js";
export * from "./harness/fixture.js";

import { readTextFile } from "./harness/fixture.js";
import { test } from "./harness/test.js";

export const Deno = {
  test,
  readTextFile,
  internal: "[internal]",
  ["[internal]"]: {},
};

// @ts-expect-error
globalThis["Deno"] = Deno;

export const window = {
  crypto: crypto,
};

// @ts-expect-error
globalThis["window"] = window;
