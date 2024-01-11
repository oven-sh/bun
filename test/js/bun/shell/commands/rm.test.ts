/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { tempDirWithFiles } from "harness";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";

describe("bunshell rm", () => {
  test("force", async () => {
    const files = {
      "existent.txt": "",
    };
    const tempdir = tempDirWithFiles("rmforce", files);

    expect(await $`rm -f ${tempdir}/non_existent.txt`.then(o => o.exitCode)).toBe(0);

    {
      const { stderr, exitCode } = await $`rm ${tempdir}/non_existent.txt`;
      expect(stderr.toString()).toEqual(`rm: ${tempdir}/non_existent.txt: No such file or directory\n`);
      expect(exitCode).toBe(1);
    }

    {
      expect(await $`ls ${tempdir}/existent.txt`.then(o => o.stdout.toString())).toEqual(`${tempdir}/existent.txt\n`);
      const { stdout, exitCode } = await $`rm -v ${tempdir}/existent.txt`;
      expect(stdout.toString()).toEqual(`${tempdir}/existent.txt\n`);
      expect(exitCode).toBe(0);
      expect(await $`ls ${tempdir}/existent.txt`.then(o => o.stderr.toString())).toEqual(
        `ls: ${tempdir}/existent.txt: No such file or directory\n`,
      );
    }
  });
});
