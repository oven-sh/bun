// @known-failing-on-windows: panic "invalid enum value"
/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { tempDirWithFiles } from "harness";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { $ } from "bun";
import path from "path";
import { mkdirSync, writeFileSync } from "node:fs";
import { ShellOutput } from "bun";
import { TestBuilder, sortedShellOutput } from "../util";

const fileExists = async (path: string): Promise<boolean> =>
  $`ls -d ${path}`.then(o => o.stdout.toString() == `${path}\n`);

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
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeTrue();
      const { stdout, exitCode } = await $`rm -v ${tempdir}/existent.txt`;
      expect(stdout.toString()).toEqual(`${tempdir}/existent.txt\n`);
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }
  });

  test("recursive", async () => {
    const files = {
      "existent.txt": "",
    };

    const tempdir = tempDirWithFiles("rmrecursive", files);

    // test on a file
    {
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeTrue();
      const { stdout, stderr, exitCode } = await $`rm -rv ${tempdir}/existent.txt`;
      expect(stderr.length).toBe(0);
      expect(stdout.toString()).toEqual(`${tempdir}/existent.txt\n`);
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }

    // test on a directory
    {
      let subDir = path.join(tempdir, "folder", "sub");
      mkdirSync(subDir, { recursive: true });
      let subFile = path.join(subDir, "file.txt");
      writeFileSync(subFile, "test");
      const { stdout, exitCode } = await $`rm -rv ${path.join(tempdir, "folder")}`;
      expect(sortedShellOutput(stdout.toString())).toEqual(
        sortedShellOutput(`${subFile}\n${subDir}\n${path.join(tempdir, "folder")}\n`),
      );
      expect(exitCode).toBe(0);

      expect(await fileExists(subDir)).toBeFalse();
      expect(await fileExists(subFile)).toBeFalse();
      {
        const { stdout, stderr, exitCode } = await $`ls ${tempdir}`;
        console.log("NICE", stdout.toString(), exitCode);
        console.log("NICE", stderr.toString());
      }
      expect(await fileExists(tempdir)).toBeTrue();
    }

    // test with cwd
    {
      const tmpdir = TestBuilder.tmpdir();
      const { stdout, stderr } =
        await $`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; rm -rfv foo/`.cwd(
          tmpdir,
        );
      expect(sortedShellOutput(stdout.toString())).toEqual(
        sortedShellOutput(
          `foo/lol
foo/nice
foo/lmao
foo/bar
foo/bar/great
foo/bar/wow
foo/
`,
        ),
      );
    }
  });

  test("dir", async () => {
    const files = {
      "existent.txt": "",
      "sub_dir": {},
      "sub_dir_files/file.txt": "",
    };

    const tempdir = tempDirWithFiles("rmdir", files);

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/existent.txt`;
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/sub_dir`;
      console.log(stderr.toString());
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/sub_dir`)).toBeFalse();
    }

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/sub_dir_files`;
      console.log(exitCode, "STDOUT", stdout.toString());
      expect(stderr.toString()).toEqual(`rm: ${tempdir}/sub_dir_files: Directory not empty\n`);
      expect(exitCode).toBe(1);
      expect(await fileExists(`${tempdir}/sub_dir_files`)).toBeTrue();
    }
  });
});
