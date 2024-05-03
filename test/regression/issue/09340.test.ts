import { expect, test } from "bun:test";
import { $ } from "bun";
import { readdirSync } from "node:fs";
import { tempDirWithFiles } from "harness";

test("bun shell should move multiple files", async () => {
  const files = { file1: "", file2: "", file3: "" };
  const filenames = Object.keys(files);
  const source = tempDirWithFiles("source", files);
  const target = tempDirWithFiles("target", {});

  await $`mv ${filenames} ${target}`.cwd(source);

  expect(readdirSync(source)).toBeEmpty();
  expect(readdirSync(target).sort()).toEqual(filenames);
});
