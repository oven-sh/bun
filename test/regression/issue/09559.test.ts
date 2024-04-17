import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { readdirSync } from "node:fs";
import { join } from "path";

test("bun build --target bun should support non-ascii source", async () => {
  const files = {
    "index.js": `
    console.log(JSON.stringify({\u{6211}: "a"}));

    const \u{6211} = "b";
    console.log(JSON.stringify({\u{6211}}));
  `,
  };
  const filenames = Object.keys(files);
  const source = tempDirWithFiles("source", files);

  $.throws(true);
  await $`${bunExe()} build --target bun ${join(source, "index.js")} --outfile ${join(source, "bundle.js")}`;
  const result = await $`${bunExe()} ${join(source, "bundle.js")}`.text();

  expect(result).toBe(`{"\u{6211}":"a"}\n{"\u{6211}":"b"}\n`);
});
