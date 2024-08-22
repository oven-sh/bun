import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import path from "path";
import { bunExe } from "harness";

test.each(["only-fixture-1.ts", "only-fixture-2.ts", "only-fixture-3.ts"])(
  `test.only shouldn't need --only for %s`,
  async (file: string) => {
    const result = await $`${bunExe()} test ${path.join(import.meta.dir, file)}`;

    expect(result.stderr.toString()).toContain(" 1 pass\n");
    expect(result.stderr.toString()).toContain(" 0 fail\n");
    expect(result.stderr.toString()).toContain("Ran 1 tests across 1 files");
  },
);

test("only resets per test", async () => {
  const files = ["only-fixture-1.ts", "only-fixture-2.ts", "only-fixture-3.ts", "only-fixture-4.ts"];
  const result = await $`${bunExe()} test ${{ raw: files.map(file => path.join(import.meta.dir, file)).join(" ") }}`;

  expect(result.stderr.toString()).toContain(" 6 pass\n");
  expect(result.stderr.toString()).toContain(" 0 fail\n");
  expect(result.stderr.toString()).toContain("Ran 6 tests across 4 files");
});
