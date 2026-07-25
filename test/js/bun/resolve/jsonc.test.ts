import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";
test("empty jsonc - package.json", async () => {
  const dir = tempDirWithFiles("jsonc", {
    "package.json": ``,
    "index.ts": `
    import pkg from './package.json';
    if (JSON.stringify(pkg) !== '{}') throw new Error('package.json should be empty');
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});

test("empty jsonc - tsconfig.json", async () => {
  const dir = tempDirWithFiles("jsonc", {
    "tsconfig.json": ``,
    "index.ts": `
    import tsconfig from './tsconfig.json';
    if (JSON.stringify(tsconfig) !== '{}') throw new Error('tsconfig.json should be empty');
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});

test("import anything.jsonc as json", async () => {
  const jsoncFile = `{
    // comment
    "trailingComma": 0,
  }`;
  const dir = tempDirWithFiles("jsonc", {
    "anything.jsonc": jsoncFile,
    "index.ts": `
    import file from './anything.jsonc';
    const _file = ${jsoncFile}
    if (!Bun.deepEquals(file, _file)) throw new Error('anything.jsonc wasnt imported as jsonc');
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});

test("imported JSON strings match JSON.parse exactly (escapes, lone surrogates, non-ASCII)", async () => {
  const json = `{"lone":"\\ud800","pair":"\\ud83d\\ude00","mix":"a\\udfffz","e":"caf\\u00e9\\ud800x","lit":"é🚀","esc\\nkey":"a\\n\\"b\\""}`;
  const dir = tempDirWithFiles("jsonc", {
    "weird.json": json,
    "weird.jsonc": json,
    "index.ts": `
    import w from "./weird.json";
    import c from "./weird.jsonc";
    const file = await Bun.file(import.meta.dir + "/weird.json").text();
    const expected = JSON.parse(file);
    const units = (o: any) => JSON.stringify(Object.entries(o).map(([k, v]) => [...(k + v as string)].map(s => s.codePointAt(0))));
    if (units(w) !== units(expected)) throw new Error("json import != JSON.parse: " + units(w) + " vs " + units(expected));
    if (units(c) !== units(expected)) throw new Error("jsonc import != JSON.parse");
    if (units(Bun.JSONC.parse(file)) !== units(expected)) throw new Error("Bun.JSONC.parse != JSON.parse");
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});
