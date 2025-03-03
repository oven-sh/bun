import { mile𐃘add1 } from "./import_target";
import { mile𐃘add1 as m } from "./import_target";
import * as i from "./import_target";
import { test, expect } from "bun:test";
import { $ } from "bun";
import { bunExe, tempDirWithFiles } from "harness";

test("unicode imports", () => {
  expect(mile𐃘add1(25)).toBe(26);
  expect(i.mile𐃘add1(25)).toBe(26);
  expect(m(25)).toBe(26);
});

test("more unicode imports", async () => {
  const dir = tempDirWithFiles("more-unicode-imports", {
    "mod_importer.ts": `
      import { nထme as nထme𐃘1 } from "./mod\\u1011.ts";
      import { nထme as nထme𐃘2 } from "./modထ.ts";

      console.log(nထme𐃘1, nထme𐃘2);
    `,
    "modထ.ts": `
      export const nထme = "𐃘1";
    `,
  });
  expect((await $`${bunExe()} run ${dir}/mod_importer.ts`.text()).trim()).toBe("𐃘1 𐃘1");
  console.log(await $`${bunExe()} build --target=bun ${dir}/mod_importer.ts`.text());
  console.log(await $`${bunExe()} build --target=node ${dir}/mod_importer.ts`.text());
});

// prettier-ignore
test("escaped unicode variable name", () => {
  let mile\u{100d8}value = 36;
  expect(mile𐃘value).toBe(36);
  expect(mile\u{100d8}value).toBe(36);
});

test("bun build --target=bun outputs only ascii", async () => {
  const build_result = await Bun.build({
    entrypoints: [import.meta.dirname + "/import_target.ts"],
    target: "bun",
  });
  expect(build_result.success).toBe(true);
  expect(build_result.outputs.length).toBe(1);
  for (const byte of new Uint8Array(await build_result.outputs[0].arrayBuffer())) {
    expect(byte).toBeLessThan(0x80);
  }
});

test("string escapes", () => {
  expect({ ["mile𐃘add1"]: 1 }?.mile𐃘add1).toBe(1);
  expect(`\\ ' " \` $ 𐃘`).toBe([0x5c, 0x27, 0x22, 0x60, 0x24, 0x100d8].map(c => String.fromCodePoint(c)).join(" "));
  expect({ "\\": 1 }[String.fromCodePoint(0x5c)]).toBe(1);
  const tag = (a: TemplateStringsArray) => a.raw;
  expect(tag`$one \$two`).toEqual(["$one \\$two"]);
});

test("constant-folded equals doesn't lie", async () => {
  expect(
    "\n" ===
      `
`,
  ).toBe(true);
  // prettier-ignore
  expect(
    "\a\n" ===
      `a
`,
  ).toBe(true);
  // prettier-ignore
  console.log("\"" === '"');
});

test.skip("template literal raw property with unicode in an ascii-only build", async () => {
  expect(String.raw`你好𐃘\\`).toBe("你好𐃘\\\\");
  expect((await $`echo 你好𐃘`.text()).trim()).toBe("你好𐃘");
});
