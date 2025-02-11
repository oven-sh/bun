import { expect, test } from "bun:test";
import "harness";
import { join } from "path";

test("shell should stay alive while a builtin command is in progress", async () => {
  expect([join(import.meta.dir, "shell-keepalive-fixture-1.js")]).toRun();
});

test("shell should stay alive while a non-builtin command is in progress", async () => {
  expect([join(import.meta.dir, "shell-keepalive-fixture-2.js")]).toRun();
});
