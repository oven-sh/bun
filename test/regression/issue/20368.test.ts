import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/20368
// The `exit` builtin in Bun's shell should halt script execution.

test("exit stops execution of subsequent commands", async () => {
  const result = await $`echo "before"; exit; echo "after"`.nothrow().text();
  expect(result).toBe("before\n");
});

test("exit 0 stops execution of subsequent commands", async () => {
  const result = await $`echo "before"; exit 0; echo "after"`.nothrow().text();
  expect(result).toBe("before\n");
});

test("exit 1 stops execution and sets exit code", async () => {
  const result = await $`echo "before"; exit 1; echo "after"`.nothrow().quiet();
  expect(await result.text()).toBe("before\n");
  expect(result.exitCode).toBe(1);
});

test("exit stops execution across newline-separated statements", async () => {
  const result = await $`
    echo "Good Bun!"
    exit
    echo "Bad Bun!"
  `
    .nothrow()
    .text();
  expect(result).toBe("Good Bun!\n");
});

test("exit with code propagates the exit code", async () => {
  const result = await $`exit 42; echo "unreachable"`.nothrow().quiet();
  expect(await result.text()).toBe("");
  expect(result.exitCode).toBe(42);
});
