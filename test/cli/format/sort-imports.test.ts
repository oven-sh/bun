// Tests for `sortImports` in bunfig.toml's `[fmt]` and for `--sort-imports`. On top of oxfmt's `sortImports`, they sort the
// names inside braces and merge imports from the same module. Neither has an option.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function run(cwd: string, args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "fmt", "--log-level=warn", ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Formats `files` twice. `--debug-check` comes first, which fails if sorting changes what a file imports. */
async function format(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-format-sort-imports", files);
  const checked = await run(String(dir), [...args, "--debug-check", "."]);
  const written = await run(String(dir), [...args, "."]);
  const first = checked.exitCode === 0 ? written : checked;
  const read = () =>
    Object.fromEntries(Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]));
  const after = read();
  const second = await run(String(dir), [...args, "."]);
  return { ...first, files: after, second: { ...second, files: read() } };
}

const bunfig = { "bunfig.toml": "[fmt]\nsortImports = true\n" };

const cases: [name: string, input: string, output: string][] = [
  [
    "sorts names case-insensitively, with numbers in natural order, ignoring inline `type`",
    `import { b, a, C, a10, a2, type T, type d, _e, $f } from "x";
`,
    `import { $f, _e, a, a2, a10, b, C, type d, type T } from "x";
`,
  ],
  [
    "sorts `a as z` by the imported name",
    `import { z as a, b as y, a as z, default as d, c } from "x";
`,
    `import { a as z, b as y, c, default as d, z as a } from "x";
`,
  ],
  [
    "sorts string names by their contents",
    `import { "b-c" as c, "a-b" as b, a } from "x";
`,
    `import { a, "a-b" as b, "b-c" as c } from "x";
`,
  ],
  [
    "sorts names in `import type`",
    `import type { B, a } from "x";
`,
    `import type { a, B } from "x";
`,
  ],
  [
    "merges two imports from the same module",
    `import { b } from "x";
import { a } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "merges three imports with another module between them",
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
    "treats 'x' and \"x\" as the same module",
    `import { b } from 'x';
import { a } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "merges a default import with named imports",
    `import x from "x";
import { a } from "x";
`,
    `import x, { a } from "x";
`,
  ],
  [
    "merges named imports with a later default import",
    `import { a } from "x";
import x from "x";
`,
    `import x, { a } from "x";
`,
  ],
  [
    "merges names into an import that has a default and names",
    `import x, { b } from "x";
import { a } from "x";
`,
    `import x, { a, b } from "x";
`,
  ],
  [
    "keeps two different default imports separate",
    `import x from "x";
import y from "x";
import { a } from "x";
`,
    `import x, { a } from "x";
import y from "x";
`,
  ],
  [
    "doesn't merge a default import with a namespace import",
    `import x from "x";
import * as y from "x";
`,
    `import x from "x";
import * as y from "x";
`,
  ],
  [
    "doesn't merge a namespace import with named imports",
    `import * as y from "x";
import { b, a } from "x";
import { c } from "x";
`,
    `import * as y from "x";
import { a, b, c } from "x";
`,
  ],
  [
    "doesn't merge names into `import x, * as y`",
    `import x, * as y from "x";
import { a } from "x";
`,
    `import x, * as y from "x";
import { a } from "x";
`,
  ],
  [
    "keeps `import type` separate from value imports",
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
    "merges `{ type B }` with value imports",
    `import { type B } from "x";
import { a } from "x";
`,
    `import { a, type B } from "x";
`,
  ],
  [
    "doesn't merge `import type X` with `import type { A }`",
    `import type X from "x";
import type { A } from "x";
`,
    `import type X from "x";
import type { A } from "x";
`,
  ],
  [
    "drops duplicate names",
    `import { a, b, a } from "x";
import { b } from "x";
`,
    `import { a, b } from "x";
`,
  ],
  [
    "keeps the same name under different aliases",
    `import { a as c } from "x";
import { a as b, a } from "x";
`,
    `import { a, a as b, a as c } from "x";
`,
  ],
  [
    "merges imports with equal import attributes",
    `import { b } from "x" with { type: "json" };
import { a } from "x" with { "type": 'json' };
`,
    `import { a, b } from "x" with { type: "json" };
`,
  ],
  [
    "doesn't merge imports with different import attributes",
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
    "never moves or merges anything across a side-effect import",
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
    "never merges side-effect imports",
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
    "merges other imports into the one that has a comment above it",
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
    "doesn't merge two imports that both have a comment above them",
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
    "merges other imports into the one that has a trailing comment",
    `import { b } from "x"; // about b
import { a } from "x";
`,
    `import { a, b } from "x"; // about b
`,
  ],
  [
    "ignores a comment separated from the import by a blank line",
    `import { b } from "x";

// about nothing

import { a } from "x";
`,
    `import { a, b } from "x";

// about nothing
`,
  ],
  [
    "moves comments inside the braces with their names",
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
    "moves comments inside the braces with their names across a merge",
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
    "keeps a line comment after the last name from swallowing the brace",
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
    "keeps a comment before the closing brace at the end after a merge",
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
    "moves comments right outside the braces with the first and last name",
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
    "wraps a merged import that no longer fits on one line",
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
    "leaves `export .. from` alone",
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
    "leaves a prettier-ignore'd import alone and doesn't merge across it",
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
    "doesn't merge across other statements",
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
    "leaves `import {}` alone and treats `import x, {}` as `import x`",
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
    "merges imports that share a line",
    `import { b } from "x"; import { a } from "x"; import y from "y";
`,
    `import { a, b } from "x";
import y from "y";
`,
  ],
  [
    "works after a directive and a top-of-file comment",
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
    "handles CRLF line endings",
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
    "groups, sorts names and merges in one pass",
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
    "moves comments right outside the braces across a merge",
    `import { c } from "x";
import /* first */ { b, a } /* last */ from "x";
`,
    `import { a /* last */, /* first */ b, c } from "x";
`,
  ],
  [
    "merges two imports that both have a comment before the brace",
    `import /* one */ { d, c } from "x";
import /* two */ { b, a } from "x";
`,
    `import { a, /* two */ b, c, /* one */ d } from "x";
`,
  ],
  [
    "keeps a comment next to a default import in place",
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
    "keeps a comment next to the module specifier in place",
    `import { b } from /* why */ "x";
import { a } from "x";
`,
    `import { a, b } from /* why */ "x";
`,
  ],
  [
    "moves a line comment before the brace with the first name",
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
  [
    "keeps a comment before the closing brace",
    `import {
  b,
  a,
  // keep
} from "x";
`,
    `import {
  a,
  b,
  // keep
} from "x";
`,
  ],
  [
    "moves a trailing line comment with its name",
    `import {
  b, // about b
  a,
} from "x";
`,
    `import {
  a,
  b, // about b
} from "x";
`,
  ],
  [
    "moves a block comment after a name with that name",
    `import { c /* about c */, b, a } from "x";
`,
    `import { a, b, c /* about c */ } from "x";
`,
  ],
  [
    "moves a comment on its own line with the name below it",
    `import {
  c,
  // about b
  b,
  a,
} from "x";
`,
    `import {
  a,
  // about b
  b,
  c,
} from "x";
`,
  ],
  [
    "moves a comment before the first name with that name",
    `import {
  // about b
  b,
  a,
} from "x";
`,
    `import {
  a,
  // about b
  b,
} from "x";
`,
  ],
  [
    "keeps a comment before the closing brace when another import merges in",
    `import {
  b,
  a,
  // keep
} from "x";
import { c } from "x";
`,
    `import {
  a,
  b,
  c,
  // keep
} from "x";
`,
  ],
  [
    "keeps a comment before the closing brace of an import that gets merged away",
    `import { c } from "x";
import {
  b,
  a,
  // keep
} from "x";
`,
    `import {
  a,
  b,
  c,
  // keep
} from "x";
`,
  ],
  [
    "moves a trailing line comment with its name across a merge",
    `import { c } from "x";
import {
  b, // about b
  a,
} from "x";
`,
    `import {
  a,
  b, // about b
  c,
} from "x";
`,
  ],
  [
    "moves a block comment after a name with that name across a merge",
    `import { d } from "x";
import { c /* about c */, b, a } from "x";
`,
    `import { a, b, c /* about c */, d } from "x";
`,
  ],
  [
    "moves a comment on its own line with the name below it across a merge",
    `import { d } from "x";
import {
  c,
  // about b
  b,
  a,
} from "x";
`,
    `import {
  a,
  // about b
  b,
  c,
  d,
} from "x";
`,
  ],
  [
    "moves a comment before the first name with that name across a merge",
    `import { c } from "x";
import {
  // about b
  b,
  a,
} from "x";
`,
    `import {
  a,
  // about b
  b,
  c,
} from "x";
`,
  ],
  [
    "keeps comments from both imports when they merge",
    `import {
  // about d
  d,
  c, // about c
} from "x";
import {
  b /* about b */,
  // about a
  a,
} from "x";
`,
    `import {
  // about a
  a,
  b /* about b */,
  c, // about c
  // about d
  d,
} from "x";
`,
  ],
];

describe("sortImports", () => {
  // All cases share one run.
  const name = (index: number) => `${index}.ts`;
  const done = format({ ...bunfig, ...Object.fromEntries(cases.map((it, index) => [name(index), it[1]])) });

  test("formats every case without errors", async () => {
    const { stderr, exitCode, second } = await done;
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(second.stderr).toBe("");
    expect(second.exitCode).toBe(0);
  });

  test.each(cases.map((it, index) => [it[0], index] as const))("%s", async (_, index) => {
    const { files, second } = await done;
    expect(files[name(index)]).toBe(cases[index][2]);
    // No comment gets lost or duplicated.
    const comments = (code: string) => (code.match(/\/\/.*|\/\*.*?\*\//g) ?? []).sort();
    expect(comments(files[name(index)])).toEqual(comments(cases[index][1]));
    // A second run changes nothing.
    expect(second.files[name(index)]).toBe(cases[index][2]);
  });
});

describe.concurrent("sortImports sources", () => {
  const input = `import { c } from "x";\nimport "./setup";\nimport { b, a } from "x";\nimport { d } from "a";\n`;
  const tidy = `import { c } from "x";\nimport "./setup";\nimport { d } from "a";\nimport { a, b } from "x";\n`;
  // oxfmt doesn't sort names or merge, and it keeps a side-effect import at its index while others move around it.
  const asOxfmt = `import { d } from "a";\n\nimport "./setup";\nimport { c } from "x";\nimport { b, a } from "x";\n`;

  test("the key, the table and the flag all sort names and merge", async () => {
    const [key, table, flag] = await Promise.all([
      format({ ...bunfig, "a.ts": input }),
      format({ "bunfig.toml": "[fmt.sortImports]\nnewlinesBetween = false\n", "a.ts": input }),
      format({ "a.ts": input }, ["--sort-imports"]),
    ]);
    expect([key.files["a.ts"], table.files["a.ts"], flag.files["a.ts"]]).toEqual([tidy, tidy, tidy]);
  });

  test("sortImports in .oxfmtrc.json keeps oxfmt's behavior unless --sort-imports is passed", async () => {
    const files = { ".oxfmtrc.json": `{ "sortImports": true }`, "a.ts": input };
    const [oxfmt, flag] = await Promise.all([format(files), format(files, ["--sort-imports"])]);
    expect(oxfmt.files["a.ts"]).toBe(asOxfmt);
    expect(flag.files["a.ts"]).toBe(tidy);
  });

  test("sortSideEffects = true lets side-effect imports move", async () => {
    const result = await format({ "bunfig.toml": "[fmt.sortImports]\nsortSideEffects = true\n", "a.ts": input });
    expect(result.files["a.ts"]).toBe(
      `import { d } from "a";\nimport { c } from "x";\nimport { a, b } from "x";\n\nimport "./setup";\n`,
    );
  });

  test("works in JavaScript, JSX and Vue scripts", async () => {
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

  test("skips a file with a syntax error", async () => {
    const code = `import { b, a } from "x";\nimport { from "x";\n`;
    const result = await format({ ...bunfig, "a.ts": code });
    expect(result.files["a.ts"]).toBe(code);
    expect(result.exitCode).toBe(2);
  });
});
