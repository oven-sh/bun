import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { join } from "path";

test.concurrent("shell should stay alive while a builtin command is in progress", async () => {
  expect(await bunRun(join(import.meta.dir, "shell-keepalive-fixture-1.js"))).toSpawn();
});

test.concurrent("shell should stay alive while a non-builtin command is in progress", async () => {
  expect(await bunRun(join(import.meta.dir, "shell-keepalive-fixture-2.js"))).toSpawn();
});
