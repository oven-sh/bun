// Runs vendored WPT streams .any.js tests against Bun's TransformStream.
// The .any.js files are byte-identical to upstream; this driver supplies the
// testharness globals they need.
//
// Vendored from web-platform-tests/wpt @ e4a4672e9e607fc2b28e7173b83ce4e38ef53071
//   streams/transform-streams/cancel.any.js

import { describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wptTest } from "../wpt-h2/testharness-shim";

const g = globalThis as any;
g.self = globalThis;

g.step_timeout = (fn: () => void, ms: number) => setTimeout(fn, ms);
g.delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
g.flushAsyncEvents = () =>
  g
    .delay(0)
    .then(() => g.delay(0))
    .then(() => g.delay(0))
    .then(() => g.delay(0));

const wptTestObject = {
  unreached_func(msg: string) {
    return () => {
      throw new Error(`unreached_func: ${msg}`);
    };
  },
};

g.promise_test = (fn: (t: unknown) => Promise<unknown>, name: string) => {
  wptTest(() => fn(wptTestObject), name);
};

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load each vendored file
// as text and run it inside a Function whose `test` parameter is the shim.
for (const file of ["cancel.any.js"]) {
  const src = readFileSync(join(import.meta.dir, file), "utf8");
  describe(file, () => {
    new Function("test", src)(wptTest);
  });
}
