/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import "harness";
import { tmpdirSync } from "harness";
import path from "path";
describe("doesnt_crash", async () => {
  let files: string[] = [];
  let temp_dir: string = tmpdirSync();
  const files_dir = path.join(import.meta.dir, "files");
  temp_dir = tmpdirSync();
  files = readdirSync(files_dir).map(file => path.join(files_dir, file));
  console.log("Tempdir", temp_dir);

  files.forEach(absolute => {
    absolute = absolute.replaceAll("\\", "/");
    const file = path.basename(absolute);

    const configs: { target: string; minify: boolean }[] = [
      { target: "bun", minify: false },
      { target: "bun", minify: true },
      { target: "browser", minify: false },
      { target: "browser", minify: true },
    ];

    for (const { target, minify } of configs) {
      test(`${file} - ${minify ? "minify" : "not minify"}`, async () => {
        const timeLog = `Transpiled ${file} - ${minify ? "minify" : "not minify"}`;
        console.time(timeLog);
        const { logs, outputs } = await Bun.build({
          entrypoints: [absolute],
          minify: minify,
          target,
        });
        console.timeEnd(timeLog);

        if (logs?.length) {
          throw new Error(logs.join("\n"));
        }

        expect(outputs.length).toBe(1);
        const outfile1 = path.join(temp_dir, "file-1" + file).replaceAll("\\", "/");

        await Bun.write(outfile1, outputs[0]);

        {
          const timeLog = `Re-transpiled ${file} - ${minify ? "minify" : "not minify"}`;
          console.time(timeLog);
          console.log("  Transpiled file path:", outfile1);
          const { logs, outputs } = await Bun.build({
            entrypoints: [outfile1],
            target,
            minify: minify,
          });

          if (logs?.length) {
            throw new Error(logs.join("\n"));
          }

          expect(outputs.length).toBe(1);
          expect(await outputs[0].text()).not.toBeEmpty();
          console.timeEnd(timeLog);
        }
      });
    }
  });
});
