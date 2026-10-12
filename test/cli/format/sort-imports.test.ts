// `sortImports` of `[format]` in bunfig.toml and `--sort-imports`: besides what `sortImports` of oxfmt does, the names in braces
// are sorted and the imports of one module become one. There are no options for that.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function run(cwd: string, args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "format", "--log-level=warn", ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Formats `files`, and once more. What is checked before a file is written is checked: that it still imports the same. */
async function format(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-format-sort-imports", files);
  const first = await run(String(dir), [...args, "."]);
  const read = () =>
    Object.fromEntries(Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]));
  const after = read();
  const second = await run(String(dir), [...args, "."]);
  return { ...first, files: after, second: { ...second, files: read() } };
}

const bunfig = { "bunfig.toml": "[format]\nsortImports = true\n" };

const cases: [name: string, input: string, output: string][] = [
  [
    "names: without regard to case, numbers by their value, an inline type does not count",
    `import { b, a, C, a10, a2, type T, type d, _e, $f } from "x";
`,
    `import { $f, _e, a, a2, a10, b, C, type d, type T } from "x";
`,
  ],
  [
    "an alias is sorted by the name in the other module",
    `import { z as a, b as y, a as z, default as d, c } from "x";
`,
    `import { a as z, b as y, c, default as d, z as a } from "x";
`,
  ],
  [
    "names that are strings",
    `import { "b-c" as c, "a-b" as b, a } from "x";
`,
    `import { a, "a-b" as b, "b-c" as c } from "x";
`,
  ],
  [
    "names of import type",
    `import type { B, a } from "x";
`,
    `import type { a, B } from "x";
`,
  ],
  [
    "two imports of a module",
    `import { b } from "x";
import { a } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "three, with others between",
    `import { c } from "x";
import { y } from "y";
import { a } from "x";
import { b } from "x";
`,
    `import { a, b, c } from "x";
import { y } from "y";
`,
  ],
  [
    "quotes do not count",
    `import { b } from 'x';
import { a } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "a default and names",
    `import x from "x";
import { a } from "x";
`,
    `import x, { a } from "x";
`,
  ],
  [
    "names and a default",
    `import { a } from "x";
import x from "x";
`,
    `import x, { a } from "x";
`,
  ],
  [
    "a default with names, and names",
    `import x, { b } from "x";
import { a } from "x";
`,
    `import x, { a, b } from "x";
`,
  ],
  [
    "two defaults stay two",
    `import x from "x";
import y from "x";
import { a } from "x";
`,
    `import x, { a } from "x";
import y from "x";
`,
  ],
  [
    "a default and a namespace stay two",
    `import x from "x";
import * as y from "x";
`,
    `import x from "x";
import * as y from "x";
`,
  ],
  [
    "a namespace and names stay two",
    `import * as y from "x";
import { b, a } from "x";
import { c } from "x";
`,
    `import * as y from "x";
import { a, b, c } from "x";
`,
  ],
  [
    "a default with a namespace takes nothing in",
    `import x, * as y from "x";
import { a } from "x";
`,
    `import x, * as y from "x";
import { a } from "x";
`,
  ],
  [
    "import type stays apart from values",
    `import type { B } from "x";
import { a } from "x";
import type { A } from "x";
import { b } from "x";
`,
    `import type { A, B } from "x";
import { a, b } from "x";
`,
  ],
  [
    "an inline type goes with values",
    `import { type B } from "x";
import { a } from "x";
`,
    `import { a, type B } from "x";
`,
  ],
  [
    "import type with a default takes no names",
    `import type X from "x";
import type { A } from "x";
`,
    `import type X from "x";
import type { A } from "x";
`,
  ],
  [
    "a name that is there twice",
    `import { a, b, a } from "x";
import { b } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "one name under two aliases",
    `import { a as c } from "x";
import { a as b, a } from "x";
`,
    `import { a, a as b, a as c } from "x";
`,
  ],
  [
    "the same attributes",
    `import { b } from "x" with { type: "json" };
import { a } from "x" with { "type": 'json' };
`,
    `import { a, b } from "x" with { type: "json" };
`,
  ],
  [
    "other attributes",
    `import b from "x" with { type: "json" };
import { a } from "x";
import { c } from "x" with { type: "css" };
`,
    `import b from "x" with { type: "json" };
import { a } from "x";
import { c } from "x" with { type: "css" };
`,
  ],
  [
    "nothing moves or merges across an import for its side effects",
    `import { z } from "z";
import { b } from "x";
import "./setup";
import { a } from "x";
import { c } from "a";
import "./more";
import "./again";
import { d } from "a";
`,
    `import { b } from "x";
import { z } from "z";
import "./setup";
import { c } from "a";
import { a } from "x";
import "./more";
import "./again";
import { d } from "a";
`,
  ],
  [
    "two imports for the side effects of one module stay two",
    `import "x";
import "x";
import { a } from "x";
`,
    `import "x";
import "x";
import { a } from "x";
`,
  ],
  [
    "a comment before an import keeps it, and it takes in the others",
    `import { c } from "x";
// about b
import { b } from "x";
import { a } from "x";
`,
    `// about b
import { a, b, c } from "x";
`,
  ],
  [
    "two with comments stay two",
    `// about b
import { b } from "x";
// about a
import { a } from "x";
`,
    `// about b
import { b } from "x";
// about a
import { a } from "x";
`,
  ],
  [
    "a comment behind an import keeps it",
    `import { b } from "x"; // about b
import { a } from "x";
`,
    `import { a, b } from "x"; // about b
`,
  ],
  [
    "a comment that an empty line separates from the import is nobody's",
    `import { b } from "x";

// about nothing

import { a } from "x";
`,
    `import { a, b } from "x";

// about nothing
`,
  ],
  [
    "comments in the braces go with their names",
    `import {
  // before c
  c,
  b, // behind b
  /* before a */ a,
} from "x";
`,
    `import {
  /* before a */ a,
  b, // behind b
  // before c
  c,
} from "x";
`,
  ],
  [
    "comments in the braces of what is merged",
    `import { d, c /* behind c */ } from "x";
import {
  b, // behind b
  // before a
  a,
} from "x";
`,
    `import {
  // before a
  a,
  b, // behind b
  c /* behind c */,
  d,
} from "x";
`,
  ],
  [
    "a line comment behind the last name",
    `import { b, // behind b
  a // behind a
} from "x";
`,
    `import {
  a, // behind a
  b, // behind b
} from "x";
`,
  ],
  [
    "a comment before the closing brace stays there",
    `import {
  b,
  a,
  // the end
} from "x";
import { c } from "x";
`,
    `import {
  a,
  b,
  c,
  // the end
} from "x";
`,
  ],
  [
    "comments next to the braces go with the first and the last name, as the formatter has it",
    `import /* why */ { b, a } from "x";
import { c } from "x";
import { e, d } /* why */ from "y";
import { f } from "y";
`,
    `import { a, /* why */ b, c } from "x";
import { d /* why */, e, f } from "y";
`,
  ],
  [
    "a merge that makes the line too long",
    `import { someRatherLongName, anotherRatherLongName } from "some-module";
import { yetAnotherRatherLongName, theLastName } from "some-module";
`,
    `import {
  anotherRatherLongName,
  someRatherLongName,
  theLastName,
  yetAnotherRatherLongName,
} from "some-module";
`,
  ],
  [
    "export from is left alone",
    `export { b, a } from "x";
export { c } from "x";
import { e, d } from "x";
`,
    `export { b, a } from "x";
export { c } from "x";
import { d, e } from "x";
`,
  ],
  [
    "prettier-ignore",
    `import { b } from "x";
// prettier-ignore
import { d,   c } from "x";
import { a } from "x";
`,
    `import { b } from "x";
// prettier-ignore
import { d,   c } from "x";
import { a } from "x";
`,
  ],
  [
    "not across other statements",
    `import { b } from "x";
f();
import { a } from "x";
`,
    `import { b } from "x";
f();
import { a } from "x";
`,
  ],
  [
    "empty braces alone are left alone, beside a default they are nothing",
    `import {} from "x";
import { a } from "x";
import x, {} from "y";
import { b } from "y";
`,
    `import {} from "x";
import { a } from "x";
import x, { b } from "y";
`,
  ],
  [
    "on one line",
    `import { b } from "x"; import { a } from "x"; import y from "y";
`,
    `import { a, b } from "x";
import y from "y";
`,
  ],
  [
    "after a directive and a comment at the top",
    `// @ts-check
"use client";
import { b } from "x";
import { a } from "x";
`,
    `// @ts-check
"use client";
import { a, b } from "x";
`,
  ],
  [
    "\\r\\n",
    `import { b } from "x";\r
import {\r
  d, // d\r
  a,\r
} from "x";\r
`,
    `import {
  a,
  b,
  d, // d
} from "x";
`,
  ],
  [
    "groups, names and merges together",
    `import { z } from "./z";
import fs, { readFileSync } from "node:fs";
import { b } from "pkg";
import { existsSync } from "node:fs";
import type { T } from "pkg";
import { a } from "pkg";
import { y } from "./z";
`,
    `import fs, { existsSync, readFileSync } from "node:fs";

import { a, b } from "pkg";
import type { T } from "pkg";

import { y, z } from "./z";
`,
  ],
  [
    "comments next to the braces of what is merged go with the first and the last name",
    `import { c } from "x";
import /* first */ { b, a } /* last */ from "x";
`,
    `import { a /* last */, /* first */ b, c } from "x";
`,
  ],
  [
    "two with comments next to their braces",
    `import /* one */ { d, c } from "x";
import /* two */ { b, a } from "x";
`,
    `import { a, /* two */ b, c, /* one */ d } from "x";
`,
  ],
  [
    "a comment at the default",
    `import x /* why */ from "x";
import { a } from "x";
import /* why */ y from "y";
import { b } from "y";
`,
    `import x /* why */, { a } from "x";
import /* why */ y, { b } from "y";
`,
  ],
  [
    "a comment at the module",
    `import { b } from /* why */ "x";
import { a } from "x";
`,
    `import { a, b } from /* why */ "x";
`,
  ],
  [
    "a line comment next to the braces",
    `import // why
{ b, a } from "x";
import { c } from "x";
`,
    `import {
  a,
  // why
  b,
  c,
} from "x";
`,
  ],
];

describe("sortImports = true", () => {
  // One run for all of them.
  const name = (index: number) => `${index}.ts`;
  const done = format({ ...bunfig, ...Object.fromEntries(cases.map((it, index) => [name(index), it[1]])) });

  test("nothing is refused", async () => {
    const { stderr, exitCode, second } = await done;
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(second.stderr).toBe("");
    expect(second.exitCode).toBe(0);
  });

  test.each(cases.map((it, index) => [it[0], index] as const))("%s", async (_, index) => {
    const { files, second } = await done;
    expect(files[name(index)]).toBe(cases[index][2]);
    // Formatted twice is formatted once.
    expect(second.files[name(index)]).toBe(cases[index][2]);
  });
});

describe.concurrent("who sorts names and merges", () => {
  const input = `import { c } from "x";\nimport "./setup";\nimport { b, a } from "x";\nimport { d } from "a";\n`;
  const tidy = `import { c } from "x";\nimport "./setup";\nimport { d } from "a";\nimport { a, b } from "x";\n`;
  // oxfmt leaves names and duplicates as they are, and an import for its side effects in its place, counted from the top.
  const asOxfmt = `import { d } from "a";\n\nimport "./setup";\nimport { c } from "x";\nimport { b, a } from "x";\n`;

  test("the key, a table and the flag", async () => {
    const [key, table, flag] = await Promise.all([
      format({ ...bunfig, "a.ts": input }),
      format({ "bunfig.toml": "[format.sortImports]\nnewlinesBetween = false\n", "a.ts": input }),
      format({ "a.ts": input }, ["--sort-imports"]),
    ]);
    expect([key.files["a.ts"], table.files["a.ts"], flag.files["a.ts"]]).toEqual([tidy, tidy, tidy]);
  });

  test("not sortImports of an .oxfmtrc.json, unless the flag is there too", async () => {
    const files = { ".oxfmtrc.json": `{ "sortImports": true }`, "a.ts": input };
    const [oxfmt, flag] = await Promise.all([format(files), format(files, ["--sort-imports"])]);
    expect(oxfmt.files["a.ts"]).toBe(asOxfmt);
    expect(flag.files["a.ts"]).toBe(tidy);
  });

  test("sortSideEffects = true is the way out for who wants them sorted", async () => {
    const result = await format({ "bunfig.toml": "[format.sortImports]\nsortSideEffects = true\n", "a.ts": input });
    expect(result.files["a.ts"]).toBe(
      `import { d } from "a";\nimport { c } from "x";\nimport { a, b } from "x";\n\nimport "./setup";\n`,
    );
  });

  test("in JavaScript, JSX and the scripts of Vue", async () => {
    const code = `import { b } from "x";\nimport { a } from "x";\n`;
    const merged = `import { a, b } from "x";\n`;
    const result = await format({
      ...bunfig,
      "a.js": code,
      "a.mjs": code,
      "a.jsx": code,
      "a.vue": `<script setup>\n${code}</script>\n`,
      "b.vue": `<script lang="ts">\n${code}</script>\n`,
    });
    expect(result.stderr).toBe("");
    expect(result.files).toMatchObject({
      "a.js": merged,
      "a.mjs": merged,
      "a.jsx": merged,
      "a.vue": `<script setup>\n${merged}</script>\n`,
      "b.vue": `<script lang="ts">\n${merged}</script>\n`,
    });
    expect(result.second.files).toEqual(result.files);
  });

  test("a file with a syntax error is left as it is", async () => {
    const code = `import { b, a } from "x";\nimport { from "x";\n`;
    const result = await format({ ...bunfig, "a.ts": code });
    expect(result.files["a.ts"]).toBe(code);
    expect(result.exitCode).toBe(2);
  });
});
