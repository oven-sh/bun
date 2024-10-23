/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeAll, describe, expect, test } from "bun:test";
import "harness";
import path from "path";
import { attrTest, cssTest, indoc, minify_test, minifyTest, prefix_test } from "./util";
import { bunEnv, bunExe, tmpdirSync } from "harness";

describe("doesnt_crash", async () => {
  let files: string[] = [];
  let temp_dir: string = tmpdirSync();
  const files_dir = path.join(import.meta.dir, "files");
  temp_dir = tmpdirSync();
  files = await Bun.$`ls ${files_dir}`.text().then(s =>
    s
      .split("\n")
      .filter(s => s.length > 0)
      .map(s => path.join(files_dir, s)),
  );
  console.log("Tempdir", temp_dir);

  files.map(file => {
    const outfile1 = path.join(temp_dir, file);
    const outfile2 = path.join(temp_dir, "lmao1-" + file);
    const outfile3 = path.join(temp_dir, "lmao2-" + file);
    const outfile4 = path.join(temp_dir, "lmao3-" + file);
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
