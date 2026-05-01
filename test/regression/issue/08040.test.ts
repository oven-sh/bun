import { semver } from "bun";
import { expect, test } from "bun:test";

test("semver with multiple tags work properly", () => {
  expect(semver.satisfies("3.4.5", ">=3.3.0-beta.1 <3.4.0-beta.3")).toBeFalse();
});
