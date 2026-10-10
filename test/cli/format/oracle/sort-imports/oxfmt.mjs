// Makes test cases for `sortImports` of oxfmt. What is expected is what the real oxfmt prints.
//
//   node oxfmt.mjs --modules=<dir with node_modules/oxfmt> --out=cases.json --mode=tests --oxc=<checkout of oxc>
//   node oxfmt.mjs --modules=<dir> --out=cases.json --mode=tokens|lines [--count=500] [--seed=1]
//
// - `tests`: every `assert_format(input, config, expected)` of crates/oxc_formatter/tests/ir_transform/sort_imports/*.rs.
// - `tokens`, `lines`: as in fuzz.mjs.
// A case also has `plain`: what oxfmt prints without `sortImports`. Where bun format and oxfmt differ on that, the
// difference is not about imports.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { flags } from "./oracle.mjs";

const { named } = flags(process.argv.slice(2));
const require = createRequire(path.resolve(named.modules, "index.js"));
const { format } = await import(pathToFileURL(require.resolve("oxfmt")).href);

export const SETS = [
  true,
  { order: "desc", ignoreCase: false },
  { partitionByNewline: true, newlinesBetween: false },
  { partitionByComment: true },
  { sortSideEffects: true, newlinesBetween: false },
  { groups: ["type", ["builtin", "external"], { newlinesBetween: false }, "internal", ["parent", "sibling", "index"], "side_effect", "style", "unknown"] },
  { groups: ["side_effect_style", "side_effect", "value-builtin", "type-import", "default-external", "wildcard-import", "named-import", "unknown"], internalPattern: ["@core/", "@ui/"] },
  {
    customGroups: [
      { groupName: "react", elementNamePattern: ["react", "react-*"] },
      { groupName: "scoped-types", elementNamePattern: ["@*/**"], modifiers: ["type"] },
      { groupName: "css", selector: "style" },
    ],
    groups: ["react", "scoped-types", "external", "unknown", "css"],
  },
  { groups: ["unknown", "external"], newlinesBetween: true, sortSideEffects: true, order: "desc" },
  { partitionByComment: true, partitionByNewline: true, newlinesBetween: false, ignoreCase: false },
];

let state = Number(named.seed ?? 1) >>> 0;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = list => list[Math.floor(random() * list.length)];

const cases = [];
async function add(name, filename, input, options, claimed) {
  const { sortImports, ...others } = options;
  const [sorted, plain] = [await format(filename, input, options), await format(filename, input, others)];
  const error = sorted.errors.length ? { error: sorted.errors[0].message } : {};
  cases.push({ plugin: "oxfmt", name, filename, options: { printWidth: 100, flavor: "oxfmt", ...options }, input, output: sorted.code, plain: plain.code, ...error });
  if (claimed !== undefined && claimed !== sorted.code) console.log(`${name}: oxfmt does not print what the test expects`);
}

if (named.mode === "tests") {
  const directory = path.join(named.oxc, "crates/oxc_formatter/tests/ir_transform/sort_imports");
  // A Rust string literal, or the name of a variable, at `at`: its value and where it ends.
  const argument = (text, at, variables) => {
    at += /^\s*/.exec(text.slice(at))[0].length;
    const raw = /^r(#*)"/.exec(text.slice(at, at + 12));
    if (raw) {
      const end = text.indexOf('"' + raw[1], at + raw[0].length);
      return [text.slice(at + raw[0].length, end), end + 1 + raw[1].length];
    }
    const plain = /^"((?:[^"\\]|\\.)*)"/.exec(text.slice(at));
    if (plain) return [JSON.parse(plain[0]), at + plain[0].length];
    const name = /^\w+/.exec(text.slice(at))[0];
    return [variables.get(name), at + name.length];
  };
  for (const file of fs.readdirSync(directory).sort()) {
    const text = fs.readFileSync(path.join(directory, file), "utf8");
    const variables = new Map();
    let index = 0;
    for (const match of text.matchAll(/let (\w+) = |assert_format\(/g)) {
      let at = match.index + match[0].length;
      if (match[1]) {
        variables.set(match[1], argument(text, at, variables)[0]);
        continue;
      }
      if (file === "mod.rs") continue;
      const values = [];
      for (let count = 0; count < 3; count++) {
        const [value, end] = argument(text, at, variables);
        values.push(value);
        at = text.indexOf(",", end) + 1;
      }
      await add(`${path.basename(file, ".rs")}/${++index}`, "a.ts", values[0].replace(/^\n/, ""), { printWidth: 80, ...JSON.parse(values[1]) }, values[2].replace(/^\n/, ""));
    }
  }
} else {
  const IMPORTS = [
    `import z from "z";`, `import { b, a, type C } from "./x";`, `import * as ns from "ns";`, `import "side";`, `import "./style.css";`,
    `import type { T } from "t";`, `import type D from "./x";`, `import d, { e as f } from "@core/d";`, `import { g } from "../x";`,
    `import fs from "node:fs";`, `import path from "path";`, `import json from "./a.json" with { type: "json" };`, `import { type U, v } from "@ui/u";`,
    `import React, { useState } from "react";`, `import {\n  long1,\n  long2,\n} from "~/long";`, `import {} from "empty";`, `import A10 from "a10";`,
    `import A2 from "a2";`, `import B from "B";`, `import i from "./index";`, `import s from "#sub";`, `import css from "./a.module.scss";`, `import q from "./q?raw";`,
    `import bun from "bun:test";`, `import dom from "react-dom";`, `import type * as TS from "@ui/types";`,
  ];
  const inputs = [];
  if (named.mode === "tokens") {
    const seeds = [
      `import z from "z";\nimport { b, a as c, type C } from "./x";\nimport * as ns from "ns";\n\nfoo();\n`,
      `import d, { e } from "d";\nimport "side";\nimport type { T, S } from "t";\nimport json from "./a.json" with { type: "json" };\nfoo();\n`,
      `#!/usr/bin/env node\n"use strict";\nimport b from "b";\nimport a from "a";\n`,
      `import { a } from "x";\nimport fs from "fs";\nexport const y = 1;\nimport w from "w";\nimport c from "./c";\n`,
    ];
    const comments = ["/* c */", "// c\n", "\n// c\n", "\n/* c */\n", "\n\n// c\n\n", "/*\n   * c\n   */", "\n/**\n * c\n */\n", "/* c */ /* d */", "// c\n// d\n"];
    for (const seed of seeds) {
      const boundaries = new Set([0, seed.length]);
      for (const match of seed.matchAll(/#!.*|"[^"]*"|[\w$]+|[^\s\w]/g)) boundaries.add(match.index).add(match.index + match[0].length);
      for (const at of [...boundaries].sort((a, b) => a - b))
        for (const comment of comments) if (!(seed.startsWith("#!") && at === 0)) inputs.push(seed.slice(0, at) + comment + seed.slice(at));
    }
  } else {
    const before = ["", "", "", "", "\n", "// c\n", "// c\n\n", "\n// c\n", "/* c */\n", "/* c */ ", "/**\n * doc\n */\n", "// c\n// d\n", "// prettier-ignore\n", "// oxfmt-ignore\n", "\n\n", "/* a\n   b */\n"];
    const after = ["", "", "", "", "", " // t", " /* t */", " /* t\n  u */", " // prettier-ignore"];
    const tops = ["", "", "", "// top\n", "// top\n\n", "/**\n * @license\n */\n\n", "#!/usr/bin/env node\n", `"use strict";\n`, `"use strict";\n\n// after\n`, "// top\n\n// second\n"];
    const bottoms = ["", "\n", "\nfoo();\n", "foo();\n", "// end\n", "\n// end\nfoo();\n", "\n\n\nexport default 1;\n", "const a = 1; // x\n"];
    for (let index = 0; index < Number(named.count ?? 500); index++) {
      let text = pick(tops);
      const count = 1 + Math.floor(random() * 7);
      for (let line = 0; line < count; line++) {
        text += pick(before) + pick(IMPORTS) + pick(after) + "\n";
        if (random() < 0.04) text += pick(["foo();\n", ";\n", "export { q } from 'q';\n", "declare module 'm' {\n  import b from 'b';\n  import a from 'a';\n}\n"]);
      }
      inputs.push(text + pick(bottoms));
    }
  }
  for (const [index, input] of inputs.entries())
    for (const set of named.mode === "lines" ? [index % SETS.length] : SETS.keys()) await add(`fuzz/${index}/${set}`, "fuzz.ts", input, { sortImports: SETS[set] });
}
fs.writeFileSync(named.out, JSON.stringify(cases));
console.log(`${cases.length} cases, of which ${cases.filter(it => it.error).length} are errors`);
process.exit(0);
