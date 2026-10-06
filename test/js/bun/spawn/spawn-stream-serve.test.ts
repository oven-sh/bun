import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { fileURLToPath } from "url";

test.concurrent("Subprocess stdout can be used in Bun.serve()", async () => {
  expect(await bunRun(fileURLToPath(import.meta.resolve("./spawn-stream-http-fixture.js")))).toSpawn("hello world");
});
