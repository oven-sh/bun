import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";

test("bun build --target bun should support non-ascii source", async () => {
  const files = {
    "index.js": `
    console.log(JSON.stringify({\u{6211}: "a"}));

    const \u{6211} = "b";
    console.log(JSON.stringify({\u{6211}}));
  `,
  };
  await using source = tempDir("source", files);

  $.throws(true);
  await $`${bunExe()} build --target bun ${join(String(source), "index.js")} --outfile ${join(String(source), "bundle.js")}`;
  const result = await $`${bunExe()} ${join(String(source), "bundle.js")}`.text();

  expect(result).toBe(`{"\u{6211}":"a"}\n{"\u{6211}":"b"}\n`);
});
