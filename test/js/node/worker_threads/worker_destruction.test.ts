import { test, describe, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import "harness";

describe("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen"];
  test.each(method)("bun closes cleanly when %s is used in a Worker that is terminating", method => {
    expect([join(import.meta.dir, "worker_thread_check.ts"), method]).toRun();
  });
});
