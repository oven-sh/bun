import { test, describe, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import "harness";

describe("Worker", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch", "fetch+blob"];
  test.each(method)("closes cleanly when %s is used while the Worker terminates", method => {
    expect([join(import.meta.dir, "worker_thread_check.ts"), method]).toRun();
  });
});
