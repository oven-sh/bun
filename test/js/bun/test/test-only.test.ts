import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

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

// Regression test for #20092
test("20092", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/20092.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/js/bun/test/20092.fixture.ts:
    (pass) foo > works
    (pass) bar > works

     2 pass
     0 fail
     2 expect() calls
    Ran 2 tests across 1 file."
  `);
});

// Regression test for #5961
test("5961", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/5961.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    hi!"
  `);
  expect(exitCode).toBe(0);
});
