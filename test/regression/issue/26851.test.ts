import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("--bail writes JUnit reporter outfile", async () => {
  using dir = tempDir("bail-junit", {
    "fail.test.ts": `
      import { test, expect } from "bun:test";
      test("failing test", () => { expect(1).toBe(2); });
    `,
  });

  const outfile = join(String(dir), "results.xml");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--bail", "--reporter=junit", `--reporter-outfile=${outfile}`, "fail.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  // The test should fail and bail
  expect(exitCode).not.toBe(0);

  // The JUnit report file should still be written despite bail
  const file = Bun.file(outfile);
  expect(await file.exists()).toBe(true);

  const xml = await file.text();
  expect(xml).toContain("<?xml");
  expect(xml).toContain("<testsuites");
  expect(xml).toContain("</testsuites>");
  expect(xml).toContain("failing test");
});

test("--bail writes JUnit reporter outfile with multiple files", async () => {
  using dir = tempDir("bail-junit-multi", {
    "a_pass.test.ts": `
      import { test, expect } from "bun:test";
      test("passing test", () => { expect(1).toBe(1); });
    `,
    "b_fail.test.ts": `
      import { test, expect } from "bun:test";
      test("another failing test", () => { expect(1).toBe(2); });
    `,
  });

  const outfile = join(String(dir), "results.xml");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--bail", "--reporter=junit", `--reporter-outfile=${outfile}`],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  // The test should fail and bail
  expect(exitCode).not.toBe(0);

  // The JUnit report file should still be written despite bail
  const file = Bun.file(outfile);
  expect(await file.exists()).toBe(true);

  const xml = await file.text();
  expect(xml).toContain("<?xml");
  expect(xml).toContain("<testsuites");
  expect(xml).toContain("</testsuites>");
  // Both the passing and failing tests should be recorded
  expect(xml).toContain("passing test");
  expect(xml).toContain("another failing test");
});
