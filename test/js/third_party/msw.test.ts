import "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  expect([path.join(import.meta.dirname, "_fixtures", "msw.ts")]).toRun("2\n");
});
