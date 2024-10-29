/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import "harness";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import path from "path";
describe("doesnt_crash", async () => {
  let files: string[] = [];
  let temp_dir: string = tmpdirSync();
  const files_dir = path.join(import.meta.dir, "files");
  temp_dir = tmpdirSync();
  files = readdirSync(files_dir).map(file => path.join(files_dir, file));
  console.log("Tempdir", temp_dir);

  files.map(file => {
    const outfile1 = path.join(temp_dir, "file-1" + path.basename(file)).replaceAll("\\", "/");
    const outfile2 = path.join(temp_dir, "file-2" + path.basename(file)).replaceAll("\\", "/");
    const outfile3 = path.join(temp_dir, "file-3" + path.basename(file)).replaceAll("\\", "/");
    const outfile4 = path.join(temp_dir, "file-4" + path.basename(file)).replaceAll("\\", "/");

    test(file, async () => {
      {
        const { stdout, stderr, exitCode } =
          await Bun.$`${bunExe()} build --experimental-css ${file} --outfile=${outfile1}`.quiet().env(bunEnv);
        expect(exitCode).toBe(0);
        expect(stdout.toString()).not.toContain("error");
        expect(stderr.toString()).toBeEmpty();
      }

      const { stdout, stderr, exitCode } =
        await Bun.$`${bunExe()} build --experimental-css ${outfile1} --outfile=${outfile2}`.quiet().env(bunEnv);
      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toContain("error");
      expect(stderr.toString()).toBeEmpty();
    });

    test(`(minify) ${file}`, async () => {
      {
        const { stdout, stderr, exitCode } =
          await Bun.$`${bunExe()} build --experimental-css ${file} --minify --outfile=${outfile3}`.quiet().env(bunEnv);
        expect(exitCode).toBe(0);
        expect(stdout.toString()).not.toContain("error");
        expect(stderr.toString()).toBeEmpty();
      }
      const { stdout, stderr, exitCode } =
        await Bun.$`${bunExe()} build --experimental-css ${outfile3} --minify --outfile=${outfile4}`
          .quiet()
          .env(bunEnv);
      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toContain("error");
      expect(stderr.toString()).toBeEmpty();
    });
  });
});
