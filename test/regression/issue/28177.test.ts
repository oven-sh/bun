import { $ } from "bun";
import { expect, test } from "bun:test";
import { tempDir } from "harness";

$.nothrow();

test("rm error path does not corrupt memory when removing non-existent files", async () => {
  // Exercise the errorWithPath code path by trying to rm files that don't exist.
  // This triggers Error allocation and deallocation which had a dupeZ/dupe mismatch.
  using dir = tempDir("rm-error-path", {});

  const { stderr, exitCode } = await $`rm ${dir}/nonexistent1 ${dir}/nonexistent2 ${dir}/nonexistent3`;
  expect(exitCode).not.toBe(0);
  expect(stderr.toString()).toContain("No such file or directory");
});

test("rm -d on non-empty directory triggers correct error handling", async () => {
  // Exercise the EISDIR / not-empty error path in removeEntryDir
  using dir = tempDir("rm-notempty", {
    "subdir/file.txt": "content",
  });

  const { stderr, exitCode } = await $`rm -d ${dir}/subdir`;
  expect(exitCode).not.toBe(0);
  expect(stderr.toString()).toContain("Directory not empty");
});

test("rm on directory without -r flag triggers EISDIR error path", async () => {
  // Exercise the EISDIR error path where dupe (not dupeZ) is now used
  using dir = tempDir("rm-isdir", {
    "mydir/a.txt": "a",
  });

  const { stderr, exitCode } = await $`rm ${dir}/mydir`;
  expect(exitCode).not.toBe(0);
  expect(stderr.toString()).toContain("Is a directory");
});

test("concurrent rm errors do not cause use-after-free", async () => {
  // Exercise handleErr and deleteAfterWaitingForChildren error paths
  // with multiple concurrent tasks that all fail
  using dir = tempDir("rm-concurrent-err", {});

  const { exitCode } = await $`rm -rf ${dir}/a ${dir}/b ${dir}/c ${dir}/d ${dir}/e ${dir}/f ${dir}/g ${dir}/h`;
  // -rf with nonexistent paths should succeed (force flag)
  expect(exitCode).toBe(0);

  // Without force flag, should fail with proper error handling
  const { stderr, exitCode: exitCode2 } = await $`rm ${dir}/x ${dir}/y ${dir}/z`;
  expect(exitCode2).not.toBe(0);
  expect(stderr.toString()).toContain("No such file or directory");
});
