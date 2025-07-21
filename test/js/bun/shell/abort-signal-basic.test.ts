import { test, expect } from "bun:test";
import { $ } from "bun";

test("AbortSignal basic integration", async () => {
  // Test that the .signal() method exists and can be called
  const controller = new AbortController();
  
  // Should not throw when setting signal
  const cmd = $`echo "AbortSignal test"`.signal(controller.signal);
  expect(cmd).toBeDefined();
  
  // Command should complete normally when not aborted
  const result = await cmd;
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("AbortSignal test");
});

test("AbortSignal method chaining", () => {
  const controller = new AbortController();
  
  // Should be able to chain signal() with other methods
  const cmd1 = $`echo test`.signal(controller.signal).nothrow();
  const cmd2 = $`echo test`.nothrow().signal(controller.signal);
  
  expect(cmd1).toBeDefined();
  expect(cmd2).toBeDefined();
});

test("AbortSignal with null/undefined", async () => {
  // Should handle null and undefined gracefully
  const result1 = await $`echo "null test"`.signal(null);
  const result2 = await $`echo "undefined test"`.signal(undefined);
  
  expect(result1.exitCode).toBe(0);
  expect(result2.exitCode).toBe(0);
  
  expect(result1.stdout.toString().trim()).toBe("null test");
  expect(result2.stdout.toString().trim()).toBe("undefined test");
});