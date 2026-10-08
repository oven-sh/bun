// Makes test cases: imports with comments and empty lines in all sorts of places.
//
//   node fuzz.mjs --modules=<dir> --out=cases.json [--mode=tokens|lines] [--count=500] [--seed=1] [--plugin=trivago|ianvs]
//
// - `tokens`: one comment at every boundary between two tokens of a few imports.
// - `lines`: random comments and empty lines before, after and at the end of the lines of a few imports.
import fs from "node:fs";
import { SETS, flags, load } from "./oracle.mjs";

const { named } = flags(process.argv.slice(2));
const { expected } = await load(named.modules);
let state = Number(named.seed ?? 1) >>> 0;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = list => list[Math.floor(random() * list.length)];

const IMPORTS = [
  `import z from "z";`,
  `import { b, a, type C } from "./x";`,
  `import * as ns from "ns";`,
  `import "side";`,
  `import "./style.css";`,
  `import type { T } from "t";`,
  `import type D from "./x";`,
  `import d, { e as f } from "@core/d";`,
  `import { g } from "./x";`,
  `import fs from "node:fs";`,
  `import path from "path";`,
  `import json from "./a.json" with { type: "json" };`,
  `import { type U, v } from "@ui/u";`,
  `import React, { useState } from "react";`,
  `import {\n  long1,\n  long2,\n} from "@server/long";`,
  `import {} from "empty";`,
  `import A10 from "a10";`,
  `import A2 from "a2";`,
  `import B from "B";`,
  `import { x as x } from "../up";`,
];

const inputs = [];
if ((named.mode ?? "tokens") === "tokens") {
  const seeds = [
    `import z from "z";\nimport { b, a as c, type C } from "./x";\nimport * as ns from "ns";\n\nfoo();\n`,
    `import d, { e } from "d";\nimport "side";\nimport type { T, S } from "t";\nimport json from "./a.json" with { type: "json" };\nfoo();\n`,
    `#!/usr/bin/env node\n"use strict";\nimport b from "b";\nimport a from "a";\n`,
    `import { a } from "x";\nimport type { b } from "x";\nimport { c } from "x";\nexport const y = 1;\nimport w from "w";\n`,
  ];
  const comments = ["/* c */", "// c\n", "\n// c\n", "\n/* c */\n", "\n\n// c\n\n", "/*\n   * c\n   */", "\n/**\n * c\n */\n", "/* c */ /* d */", "// c\n// d\n"];
  for (const seed of seeds) {
    const boundaries = new Set([0, seed.length]);
    for (const match of seed.matchAll(/#!.*|"[^"]*"|[\w$]+|[^\s\w]/g)) {
      boundaries.add(match.index);
      boundaries.add(match.index + match[0].length);
    }
    for (const at of [...boundaries].sort((a, b) => a - b))
      for (const comment of comments) {
        if (seed.startsWith("#!") && at === 0) continue;
        inputs.push(seed.slice(0, at) + comment + seed.slice(at));
      }
  }
} else {
  const before = ["", "", "", "", "\n", "// c\n", "// c\n\n", "\n// c\n", "/* c */\n", "/* c */ ", "/**\n * doc\n */\n", "// c\n// d\n", "// prettier-ignore\n", "\n\n", "/* a\n   b */\n"];
  const after = ["", "", "", "", "", " // t", " /* t */", " /* t\n  u */", " // prettier-ignore"];
  const tops = ["", "", "", "// top\n", "// top\n\n", "/**\n * @license\n */\n\n", "#!/usr/bin/env node\n", `"use strict";\n`, `"use strict";\n\n// after\n`, "/* eslint-disable */\n", "// top\n\n// second\n"];
  const bottoms = ["", "\n", "\nfoo();\n", "foo();\n", "// end\n", "\n// end\nfoo();\n", "\n\n\nexport default 1;\n", "const a = 1; // x\n"];
  for (let index = 0; index < Number(named.count ?? 500); index++) {
    let text = pick(tops);
    const count = 1 + Math.floor(random() * 6);
    for (let line = 0; line < count; line++) {
      text += pick(before) + pick(IMPORTS) + pick(after) + "\n";
      if (random() < 0.04) text += pick(["foo();\n", ";\n", "export { q } from 'q';\n", "declare module 'm' {\n  import b from 'b';\n  import a from 'a';\n}\n"]);
    }
    inputs.push(text + pick(bottoms));
  }
}

const cases = [];
for (const plugin of named.plugin ? [named.plugin] : ["trivago", "ianvs"])
  for (const [index, input] of inputs.entries()) {
    const sets = SETS[plugin];
    const chosen = named.mode === "lines" ? [index % sets.length] : sets.keys();
    for (const set of chosen) {
      const options = { ...sets[set], parser: "typescript" };
      cases.push({ plugin, name: `fuzz/${index}/${set}`, filename: "fuzz.ts", options, input, ...(await expected(plugin, input, options, "/fuzz.ts")) });
    }
  }
fs.writeFileSync(named.out, JSON.stringify(cases));
console.log(`${cases.length} cases, of which ${cases.filter(it => it.error).length} are errors`);
