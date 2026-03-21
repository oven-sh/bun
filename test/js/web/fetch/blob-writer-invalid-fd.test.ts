import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { devNull } from "os";

test.skipIf(isWindows)("Bun.file().writer() with invalid fd option throws instead of crashing", () => {
  const blob = Bun.file(devNull);
  expect(() => blob.writer({ fd: "invalid" })).toThrow(/EBADF/);
});

test.skipIf(isWindows)("Bun.file().writer() with invalid path option throws instead of crashing", () => {
  const blob = Bun.file(devNull);
  expect(() => blob.writer({ path: 123 })).toThrow(/EINVAL/);
});
