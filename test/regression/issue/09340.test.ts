import { $ } from "bun";
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync } from "node:fs";

test("bun shell should move multiple files", async () => {
  const files = { file1: "", file2: "", file3: "" };
  const filenames = Object.keys(files);
  await using source = tempDir("source", files);
  await using target = tempDir("target", {});

  await $`mv ${filenames} ${target}`.cwd(source);

  expect(readdirSync(source)).toBeEmpty();
  expect(readdirSync(target).sort()).toEqual(filenames);
});
