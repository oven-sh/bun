import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/14670
// Shell promise with .rejects.toThrow() should not timeout.
// The bug was that expect().rejects bypassed the JS-level then() override
// on ShellPromise, so the lazy shell interpreter was never started.

test("expect($`bad-command`).rejects.toThrow() does not timeout", async () => {
  expect($`bad-command`.quiet()).rejects.toThrow();
});

test("await expect($`bad-command`).rejects.toThrow()", async () => {
  await expect($`bad-command`.quiet()).rejects.toThrow();
});

test("expect($`bad-command`).rejects.toThrow() without quiet", async () => {
  expect($`bad-command`.quiet()).rejects.toThrow();
});

test("expect($`bad-command`.nothrow()).resolves.toBeDefined()", async () => {
  await expect($`bad-command`.quiet().nothrow()).resolves.toBeDefined();
});
