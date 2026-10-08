// Makes test cases for prettier-plugin-organize-imports: imports and exports in random order, some of them not used.
//
//   node organize.mjs --modules=<dir> --out=cases.json [--count=1000] [--seed=1] [--inner] [--between=0.05]
import fs from "node:fs";
import { flags, load } from "./oracle.mjs";

const { named } = flags(process.argv.slice(2));
const { expected } = await load(named.modules);
let state = Number(named.seed ?? 1) >>> 0;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = list => list[Math.floor(random() * list.length)];

// What is written, and the names that it declares.
const IMPORTS = [
  [`import z from "z";`, ["z"]],
  [`import { b, a, type C } from "./x";`, ["b", "a", "C"]],
  [`import { B2, a2, A3, b3 } from "./case";`, ["B2", "a2", "A3", "b3"]],
  [`import * as ns from "ns";`, ["ns"]],
  [`import "side";`, []],
  [`import "./style.css";`, []],
  [`import type { T } from "t";`, ["T"]],
  [`import type D from "./x";`, ["D"]],
  [`import d, { e as f } from "@core/d";`, ["d", "f"]],
  [`import { g } from "./x";`, ["g"]],
  [`import h from "./x";`, ["h"]],
  [`import * as x2 from "./x";`, ["x2"]],
  [`import fs from "node:fs";`, ["fs"]],
  [`import path from "path";`, ["path"]],
  [`import json from "./a.json" with { type: "json" };`, ["json"]],
  [`import { type U, v } from "@ui/u";`, ["U", "v"]],
  [`import type { W } from "@ui/u";`, ["W"]],
  [`import React, { useState } from "react";`, ["React", "useState"]],
  [`import {\n  long2,\n  long1,\n} from "@server/long";`, ["long2", "long1"]],
  [`import {} from "empty";`, []],
  [`import A10 from "a10";`, ["A10"]],
  [`import A2 from "a2";`, ["A2"]],
  [`import Bb from "B";`, ["Bb"]],
  [`import { x as x } from "../up";`, ["x"]],
  [`import { default as dd } from "../up";`, ["dd"]],
  [`import k1 from "k";`, ["k1"]],
  [`import k2 from "k";`, ["k2"]],
  ...(named.inner
    ? [
        [`import {
  // lead
  m3,
  m2, // trail
  m1 /* in */,
} from "./inner";`, ["m3", "m2", "m1"]],
        [`import {
  n2,
  // eslint-disable-next-line x
  n1,
} from "./inner2";`, ["n2", "n1"]],
        [`import { p2, /* mid */ p1 } from "./inner3";`, ["p2", "p1"]],
        [`import { r2 /* a */, r1 /* b */ } from "./inner3";`, ["r2", "r1"]],
        [`import {
  s2,
  s1,
  // last
} from "./inner4";`, ["s2", "s1"]],
        [`import /* a */ o1 /* b */ from /* c */ "./o";`, ["o1"]],
      ]
    : []),
];
const EXPORTS = [`export { q2, q1 } from "q";`, `export * from "star";`, `export * as nn from "nn";`, `export type { Y } from "./y";`, `export { r } from "./y";`, `export { s } from "q";`, `export * from "./aa";`];
const SETS = [{}, {}, { organizeImportsSkipDestructiveCodeActions: true }, { organizeImportsTypeOrder: "first" }, { organizeImportsTypeOrder: "inline" }, { organizeImportsTypeOrder: "last" }];
const before = ["", "", "", "", "", "\n", "// c\n", "\n// c\n", "/* c */ ", "/**\n * doc\n */\n"];
const after = ["", "", "", "", "", " // t", " /* t */", " /* t\n  u */"];
const tops = ["", "", "", "// top\n", "// top\n\n", "/**\n * @license\n */\n\n", "#!/usr/bin/env node\n", `"use strict";\n`];

const cases = [];
for (let index = 0; index < Number(named.count ?? 1000); index++) {
  let text = pick(tops);
  const names = [];
  const chosen = new Set();
  for (let line = 1 + Math.floor(random() * 7); line > 0; line--) {
    const at = Math.floor(random() * IMPORTS.length);
    if (chosen.has(at)) continue;
    chosen.add(at);
    text += pick(before) + IMPORTS[at][0] + pick(after) + "\n";
    names.push(...IMPORTS[at][1]);
    if (random() < 0.05) text += pick(["foo();\n", "export const c1 = 1;\n"]);
  }
  text += pick(["", "\n"]);
  for (let line = Math.floor(random() * 4); line > 0; line--) text += pick(["", "", "\n"]) + pick(EXPORTS) + pick(after) + "\n";
  const used = names.filter(() => random() < 0.75);
  const isType = name => /^[A-Z]$/.test(name);
  text += `\nuse(${used.filter(name => !isType(name)).join(", ")});\n`;
  if (used.some(isType)) text += `type All = [${used.filter(isType).join(", ")}];\n`;
  const options = { ...SETS[index % SETS.length], parser: "typescript" };
  cases.push({ plugin: "organize", name: `fuzz/${index}`, filename: "fuzz.ts", options, input: text, ...(await expected("organize", text, options, "/fuzz.ts")) });
}
fs.writeFileSync(named.out, JSON.stringify(cases));
console.log(`${cases.length} cases, of which ${cases.filter(it => it.error).length} are errors`);
