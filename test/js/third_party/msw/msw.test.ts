import { expect, it } from "bun:test";
import { bunRun } from "harness";
import * as path from "node:path";

it.concurrent("works", async () => {
  expect(await bunRun(path.join(import.meta.dirname, "msw.fixture.ts"))).toSpawn("2");
});
