import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// https://github.com/oven-sh/bun/issues/28644
// Async fs errors should have a .stack property matching Node.js format:
// "Error: <message>" (header only, no frames since error is created in threadpool)

test("fs.readFile async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.readFile("/nonexistent-xyz-abc-123-bun-test", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
  expect(err.stack).toContain("ENOENT");
});

test("fs.stat async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.stat("/nonexistent-xyz-abc-123-bun-test", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
});

test("fs.open async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.open("/nonexistent-xyz-abc-123-bun-test", "r", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
});

// Regression guard: the async-error .stack fix must NOT clobber sync errors,
// which are created with JS frames on the stack and should have a full trace.

test("fs.readFileSync error has .stack with frames (not just header)", () => {
  let err: NodeJS.ErrnoException | undefined;
  try {
    fs.readFileSync("/nonexistent-xyz-abc-123-bun-test");
  } catch (e) {
    err = e as NodeJS.ErrnoException;
  }

  expect(err).toBeDefined();
  expect(err!.code).toBe("ENOENT");
  expect(typeof err!.stack).toBe("string");
  expect(err!.stack).toStartWith("Error: ");
  // Sync errors must have frames, not just "Error: <message>"
  expect(err!.stack).toContain("\n    at ");
  expect(err!.stack!.length).toBeGreaterThan(("Error: " + err!.message).length);
});

test("fs.statSync error has .stack with frames (not just header)", () => {
  let err: NodeJS.ErrnoException | undefined;
  try {
    fs.statSync("/nonexistent-xyz-abc-123-bun-test");
  } catch (e) {
    err = e as NodeJS.ErrnoException;
  }

  expect(err).toBeDefined();
  expect(err!.code).toBe("ENOENT");
  expect(typeof err!.stack).toBe("string");
  expect(err!.stack).toStartWith("Error: ");
  expect(err!.stack).toContain("\n    at ");
});

// SystemError__toErrorInstanceWithInfoObject path (ERR_SYSTEM_ERROR):
// os.getPriority/setPriority errors are always synchronous and must have frames.

test("os.getPriority error has .stack with frames (SystemError with info object)", () => {
  let err: any;
  try {
    os.getPriority(0x7fffffff); // invalid PID
  } catch (e) {
    err = e;
  }

  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_SYSTEM_ERROR");
  expect(err.name).toBe("SystemError");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("SystemError");
  // Must have frames, not just the header
  expect(err.stack).toContain("\n    at ");
  expect(err.info).toBeDefined();
  expect(err.info.syscall).toBe("uv_os_getpriority");
});
