import { expect, test } from "bun:test";
import "harness";
import { isArm64, isMusl } from "harness";

// https://github.com/oven-sh/bun/issues/12070
test.skipIf(
  // swc, which bun-repl uses, published a glibc build for arm64 musl
  // and so it crashes on process.exit.
  isMusl && isArm64,
)("bun repl", () => {
  expect(["repl", "-e", "process.exit(0)"]).toRun();
});
