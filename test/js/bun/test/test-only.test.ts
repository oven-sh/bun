import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.each(["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts"])(
  `test.only shouldn't need --only for %s`,
  async (file: string) => {
    const result = await $.cwd(import.meta.dir)`${bunExe()} test ${file}`.env({ ...bunEnv, CI: "false" });

    expect(result.stderr.toString()).toContain(" 1 pass\n");
    expect(result.stderr.toString()).toContain(" 0 fail\n");
    expect(result.stderr.toString()).toContain("Ran 1 test across 1 file");
  },
);

test("only resets per test", async () => {
  const files = ["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts", "./only-fixture-4.ts"];
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ${{ raw: files.join(" ") }}`.env({
    ...bunEnv,
    CI: "false",
  });

  expect(result.stderr.toString()).toContain(" 6 pass\n");
  expect(result.stderr.toString()).toContain(" 0 fail\n");
  expect(result.stderr.toString()).toContain("Ran 6 tests across 4 files");
});
