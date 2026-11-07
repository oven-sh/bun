// Bun only, for --rerun-each=2: the second run declares `late` from a test of the first run, which has finished.
import { AsyncResource } from "node:async_hooks";
import { test } from "node:test";

test("not marked", () => console.log("RAN not marked"));
globalThis.declareLate?.();
test.only("marked", () => {
  console.log("RAN marked");
  globalThis.declareLate ??= AsyncResource.bind(() => test.only("late", () => console.log("RAN late")));
});
