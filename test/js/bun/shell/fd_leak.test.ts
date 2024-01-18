/**
 * Portions of these tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile } from "fs/promises";
import { join, relative } from "path";
import { TestBuilder, redirect } from "./util";
import { tmpdir } from "os";
import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import {
  randomInvalidSurrogatePair,
  randomLoneSurrogate,
  runWithError,
  runWithErrorPromise,
  tempDirWithFiles,
} from "harness";
import { openSync, closeSync } from "node:fs";

describe('fd leak', () => {
    function leakTest(name: string, builder: () => TestBuilder, runs: number = 500) {
        test(name, async () => {
            const baseline = openSync("/dev/null", 'r');
            closeSync(baseline)
            for (let i = 0; i < runs; i++) {
                await builder().run()
            }
            const fd = openSync("/dev/null", "r")
            closeSync(fd)
            expect(fd).toBe(baseline)
        })
    }

    leakTest('redirect_file', () => TestBuilder.command`echo hello > ${join(tmpdir(), 'test.txt')}`)
    leakTest('change_cwd', () => TestBuilder.command`cd ${tmpdir()} && cd -`)
    leakTest('pipeline', () => TestBuilder.command`echo hi | cat`.stdout('hi\n'))
    leakTest('pipeline2', () => TestBuilder.command`echo hi | echo lol | cat`.stdout('lol\n'))
    leakTest("ls", () =>
    TestBuilder.command`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; ls -R foo/`
      .ensureTempDir()
      .stdout((stdout) =>
        expect(
          stdout
            .split("\n")
            .filter((s) => s.length > 0)
            .sort(),
        ).toEqual(["lmao", "lol", "nice", "foo/bar:", "bar", "great", "wow"].sort()),
      ),
      100
  );
})
