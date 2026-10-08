// The message for a file that cannot be parsed: ESLint with @typescript-eslint/parser against `Linter::lint`, on
// code of the conformance fixtures that is damaged.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node parse-errors.mjs <conformance fixtures>

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const requireTs = createRequire(join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"));
const parser = requireTs("@typescript-eslint/parser");
const fixtures = join(resolve(process.argv[2]), "typescript-eslint");

const rng = random(12);
const codes = [];
for (const file of readdirSync(fixtures)) {
  for (const it of JSON.parse(readFileSync(join(fixtures, file), "utf8")).cases) {
    if (!it.skip && it.filename.endsWith(".ts") && it.code.length < 400 && rng.int(6) === 0) codes.push(it.code);
  }
}
const junk = [..."(){}[]<>;,.:=+*/'\"`@#!?&|", " class ", " function ", " = ", "=>", " import ", " const ", "...", " as ", "\n"];
const cases = [];
for (const code of codes) {
  const units = [...code];
  const at = rng.int(units.length + 1);
  if (rng.int(2) === 0) units.splice(at, 1 + rng.int(3));
  else units.splice(at, 0, rng.pick(junk));
  cases.push({ code: units.join(""), filename: "file.ts", config: { rules: {}, languageOptions: { parser: "typescript" } }, options: {} });
}
const brief = messages => messages.filter(it => it.fatal).map(({ message, line, column }) => ({ message, line, column }));
const linter = new Linter({ configType: "flat" });
const expected = cases.map(({ code }) => brief(linter.verify(code, { files: ["**"], languageOptions: { parser } }, "file.ts")));
const actual = runBunLint("verify", cases).map(it => brief(it.messages));
const rejected = expected.filter(it => it.length > 0).length;
const sameVerdict = expected.filter((it, i) => (it.length > 0) === (actual[i].length > 0)).length;
console.log(`parse errors: typescript-estree rejects ${rejected} of ${cases.length}; the verdict is the same for ${sameVerdict}`);
report("parse errors", cases.map(it => it.code), expected, actual, Number(process.argv[3] ?? 10));
