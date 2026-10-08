// A project for each way in which oxlint's port of a rule differs from the plugin that it is a port of, and some for what is the same.

export interface Project {
  name: string;
  about: string;
  config: object;
  files: Record<string, string>;
}

const rules = (plugins: string[], rules: object) => ({ plugins, categories: { correctness: "off" }, rules });
const hooks = rules(["react"], { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" });
const unused = rules(["typescript"], { "no-unused-vars": "error" });
const noCycle = (...options: object[]) => rules(["import"], { "import/no-cycle": ["warn", ...options] });

/** Two modules that import each other, the first with `first` and the second with `import { a } from "./a"`. */
const pair = (first: string, b = "b.ts", second = `import { a } from "./a";\nexport const b = a;\nexport type B = number;\n`) => ({
  "a.ts": `${first}\nexport const a = 1;\n`,
  [b]: second,
});

export const projects: Project[] = [
  {
    name: "no-cycle/place",
    about: "the specifier is reported, once for each specifier, where it is first",
    config: noCycle(),
    files: pair(`import { b } from "./b";\nimport { b as c } from "./b";\nimport { b as d } from "./b.ts";`),
  },
  {
    name: "no-cycle/every-import",
    about: "each import of a file is searched afresh",
    config: noCycle(),
    files: {
      "a.ts": `import { b } from "./b";\nimport { c } from "./c";\nexport const a = [b, c];\n`,
      "b.ts": `import { c } from "./c";\nexport const b = c;\n`,
      "c.ts": `import { a } from "./a";\nexport const c = a;\n`,
    },
  },
  {
    name: "no-cycle/dynamic-import",
    about: "Flavor::ignores_dynamic_imports",
    config: noCycle(),
    files: pair(`export const load = () => import("./b");`),
  },
  {
    name: "no-cycle/tsx-for-js",
    about: "Flavor::resolves_as_node: ./b.js is not ./b.tsx",
    config: noCycle(),
    files: pair(`import { b } from "./b.js";`, "b.tsx"),
  },
  {
    name: "no-cycle/ts-for-js",
    about: "Flavor::resolves_as_node: ./b.js is ./b.ts",
    config: noCycle(),
    files: pair(`import { b } from "./b.js";`),
  },
  {
    name: "no-cycle/tsx-for-jsx",
    about: "Flavor::resolves_as_node: ./b.jsx is not ./b.tsx",
    config: noCycle(),
    files: pair(`import { b } from "./b.jsx";`, "b.tsx"),
  },
  {
    name: "no-cycle/declaration-file",
    about: "Flavor::resolves_as_node: ./b is not ./b.d.ts",
    config: noCycle(),
    files: pair(`import { b } from "./b";`, "b.d.ts", `import { a } from "./a";\nexport declare const b: typeof a;\n`),
  },
  {
    name: "no-cycle/js-before-ts",
    about: "Flavor::resolves_as_node: ./b is ./b.js where there is a ./b.ts too",
    config: noCycle(),
    files: { ...pair(`import { b } from "./b";`), "b.js": "export const b = 1;\n" },
  },
  {
    name: "no-cycle/index",
    about: "a directory",
    config: noCycle(),
    files: pair(`import { b } from "./dir";`, "dir/index.tsx", `import { a } from "../a";\nexport const b = a;\n`),
  },
  {
    name: "no-cycle/paths",
    about: "paths and baseUrl of a tsconfig.json",
    config: noCycle(),
    files: {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "src/a.ts": `import { b } from "@/b";\nexport const a = b;\n`,
      "src/b.ts": `import { a } from "src/a";\nexport const b = a;\n`,
    },
  },
  {
    name: "no-cycle/export-type-from",
    about: "export type { B } from is an import of types",
    config: noCycle(),
    files: pair(`export type { B } from "./b";`),
  },
  {
    name: "no-cycle/export-inline-type-from",
    about: "export { type B } from is an import of types",
    config: noCycle(),
    files: pair(`export { type B } from "./b";`),
  },
  {
    name: "no-cycle/export-type-star",
    about: "export type * from has no names, so it is followed",
    config: noCycle(),
    files: pair(`export type * from "./b";`),
  },
  {
    name: "no-cycle/export-type-star-as",
    about: "export type * as N from is an import of types",
    config: noCycle(),
    files: pair(`export type * as N from "./b";`),
  },
  {
    name: "no-cycle/side-effect",
    about: "import \"./b\" is followed, in the file that is linted too",
    config: noCycle(),
    files: pair(`import "./b";`, "b.ts", `import "./a";\n`),
  },
  {
    name: "no-cycle/no-names",
    about: "import {} from is followed",
    config: noCycle(),
    files: pair(`import {} from "./b";`),
  },
  {
    name: "no-cycle/types-and-star",
    about: "the statements with the same specifier count together: import type and export * are an import of types",
    config: noCycle(),
    files: pair(`import type { B } from "./b";\nexport * from "./b";\nexport type C = B;`),
  },
  {
    name: "no-cycle/types-and-values",
    about: "import type and import of a value with the same specifier",
    config: noCycle(),
    files: pair(`import type { B } from "./b";\nimport { b } from "./b";\nexport type C = [B, typeof b];`),
  },
  {
    name: "no-cycle/inline-types",
    about: "import { type B } and import { type B, b }",
    config: noCycle(),
    files: {
      ...pair(`import { type B } from "./b";\nimport { type C, c } from "./c";\nexport type D = [B, C, typeof c];`),
      "c.ts": `import { a } from "./a";\nexport const c = a;\nexport type C = number;\n`,
    },
  },
  {
    name: "no-cycle/ignore-types-off",
    about: "ignoreTypes: false",
    config: noCycle({ ignoreTypes: false }),
    files: pair(`import type { B } from "./b";\nexport type C = B;`),
  },
  {
    name: "no-cycle/self",
    about: "Flavor::counts_self_imports, and oxlint_allows_self_reference",
    config: noCycle(),
    files: {
      "a.ts": `import { a as x } from "./a";\nexport const a = x;\n`,
      "b.ts": `export * from "./b";\n`,
      "c.ts": `export * as C from "./c";\nexport const c = 1;\n`,
      "d.ts": `export { d as e } from "./d";\nexport const d = 1;\n`,
      "e.ts": `import { e as f } from "./e";\nexport { f };\nexport const e = 1;\n`,
      "f.ts": `import * as f from "./f";\nexport { f };\n`,
      "g.ts": `import type { G } from "./g";\nexport type G = number;\nexport type H = G;\n`,
      "h.ts": `import "./h";\n`,
    },
  },
  {
    name: "no-cycle/require",
    about: "require and import = require are not imports",
    config: noCycle(),
    files: {
      "a.js": `const b = require("./b");\nmodule.exports = b;\n`,
      "b.js": `const a = require("./a");\nmodule.exports = a;\n`,
      "c.ts": `import d = require("./d");\nexport const c = d;\n`,
      "d.ts": `import { c } from "./c";\nexport const d = c;\n`,
    },
  },
  {
    name: "no-cycle/syntax-error",
    about: "nothing is known of a file that cannot be parsed",
    config: noCycle(),
    files: {
      "a.ts": `import { b } from "./b";\nexport const a = b;\n`,
      "b.ts": `import { c } from "./c";\nexport const b = c;\nconst = ;\n`,
      "c.ts": `import { a } from "./a";\nexport const c = a;\n`,
    },
  },
  {
    name: "no-cycle/import-type-in-a-type",
    about: "import(\"./b\").B in a type is not an import",
    config: noCycle(),
    files: pair(`export type T = import("./b").B;`),
  },
  ...[1, 2, 3].map(maxDepth => ({
    name: `no-cycle/max-depth-${maxDepth}`,
    about: "oxlint_finds_within: depth first by the specifiers, and the search ends where it is too deep for the first time",
    config: noCycle({ maxDepth }),
    files: {
      "a.ts": `import { b } from "./b";\nimport { e } from "./e";\nexport const a = [b, e];\n`,
      "b.ts": `import { c } from "./c";\nimport { z } from "./z";\nexport const b = [c, z];\n`,
      "c.ts": `import { d } from "./d";\nexport const c = d;\n`,
      "d.ts": `import { a } from "./a";\nexport const d = a;\n`,
      "e.ts": `import { a } from "./a";\nexport const e = a;\n`,
      "z.ts": `import { a } from "./a";\nexport const z = a;\n`,
    },
  })),
  {
    name: "no-cycle/comments",
    about: "comments that disable the rule",
    config: noCycle(),
    files: pair(`// oxlint-disable-next-line import/no-cycle\nimport { b } from "./b";\n// eslint-disable-next-line import/no-cycle\nimport { b as c } from "./b.ts";`),
  },
  {
    name: "no-cycle/many-files",
    about: "far more files than threads, each directory with a tsconfig.json that includes files: nothing waits for a thread that waits",
    config: noCycle(),
    files: Object.fromEntries(
      Array.from({ length: 40 }, (_, directory) => [
        [`d${directory}/tsconfig.json`, JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } }, include: ["**/*"] })],
        ...Array.from({ length: 10 }, (_, file) => [
          `d${directory}/f${file}.ts`,
          `import { x as next } from "${file < 9 ? `~/f${file + 1}` : `../d${(directory + 1) % 40}/f0`}";\nexport const x = next;\n`,
        ]),
      ]).flat(),
    ),
  },
  {
    name: "rules-of-hooks/loop-in-callback",
    about: "no loops and conditions are looked for in a function that is passed to a call outside a component",
    config: hooks,
    files: {
      "a.ts": `items.forEach(item => {\n  for (const part of item) {\n    useThing(part);\n  }\n  if (item) useOther();\n});\n`,
      "b.ts": `function Component() {\n  items.forEach(item => {\n    for (const part of item) useThing(part);\n  });\n}\n`,
    },
  },
  {
    name: "rules-of-hooks/try",
    about: "a hook in a try statement is called conditionally",
    config: hooks,
    files: {
      "a.ts": `function Component() {\n  try {\n    useThing();\n  } catch {\n    useOther();\n  } finally {\n    useLast();\n  }\n  while (a) {\n    try {\n      useLoop();\n    } catch {}\n  }\n}\n`,
    },
  },
  {
    name: "rules-of-hooks/anonymous",
    about: "a function without any name counts as a component; the default of what is assigned to has no name",
    config: hooks,
    files: {
      "a.ts": `export default () => {\n  if (a) useThing();\n};\n`,
      "b.ts": `export default function () {\n  if (a) useThing();\n}\n`,
      "c.ts": `({ k = () => { useThing(); } } = {});\nconst { j = () => { useThing(); } } = {};\nconst c = () => { useThing(); };\n`,
    },
  },
  {
    name: "rules-of-hooks/one-report",
    about: "a call is reported once",
    config: hooks,
    files: {
      "a.ts": `function notComponent() {\n  while (a) useThing();\n}\nclass A {\n  m() {\n    if (a) useThing();\n  }\n  p = () => useThing();\n}\nasync function Component() {\n  if (a) useThing();\n}\nuseThing();\n`,
    },
  },
  {
    name: "exhaustive-deps/places",
    about: "a missing dependency is printed where it is used; what changes every render in the array; `ref.current` as a whole",
    config: hooks,
    files: {
      "a.tsx": `function Component({ a }) {\n  const ref = useRef();\n  const made = {};\n  const call = () => a;\n  useEffect(() => {\n    console.log(a);\n    return () => {\n      ref.current.stop();\n    };\n  }, []);\n  useCallback(() => [made, call], [made, call]);\n}\n`,
    },
  },
  {
    name: "exhaustive-deps/each-by-itself",
    about: "each dependency that is not needed, is there twice or is no dependency is a report of its own",
    config: hooks,
    files: {
      "a.tsx": `const outer = 1;\nfunction Component({ a, b }) {\n  useMemo(() => a, [a, a, b, b.c, outer, 1, a + b, ...b]);\n  useMemo(() => a);\n  useEffect(async () => {}, a);\n  useEffect(b, []);\n  useEffect();\n}\n`,
    },
  },
  {
    name: "exhaustive-deps/callee",
    about: "is_callee_of_call: what a method is called on is the dependency",
    config: hooks,
    files: {
      "a.tsx": `function Component({ a, b, c, d, e }) {\n  useEffect(() => {\n    a.b.c();\n  }, []);\n  useEffect(() => {\n    b.c[d]();\n  }, [d]);\n  useEffect(() => {\n    c[d.e]();\n  }, [c]);\n  useEffect(() => {\n    e.f.g;\n  }, []);\n}\n`,
    },
  },
  {
    name: "exhaustive-deps/order",
    about: "Found::order_of_oxlint: of several that are missing, the first in oxlint's hash table is where the report is printed",
    config: hooks,
    files: {
      "a.tsx": [
        `import React, { useEffect as effect, type FC } from "react";`,
        `import * as all from "./all";`,
        `type Alias<T> = T extends infer U ? { [K in keyof U]: (value: U[K]) => void } : never;`,
        `interface Props { a: number; call(this: Props, x: number): void }`,
        `interface Props { b: number }`,
        `enum Kind { One, Two = "two" }`,
        `namespace Space { export const inner = 1; }`,
        `declare function overloaded(a: string): void;`,
        `declare function overloaded(a: number): void;`,
        `@decorate(x => x) class Thing<T> { constructor(private field: T) {} method(p: T) { try {} catch (error) {} } }`,
        `const Expr = class Named {};`,
        `const named = function self(self) { var hoisted; { var hoisted; } };`,
        `const { first = (inner: number) => inner, second } = all;`,
        `export function Component({ a, b, c }: Props & { c: number }, ...rest: number[]) {`,
        `  const [state, setState] = useState(0);`,
        `  const local = a + b;`,
        `  const other = [c];`,
        `  function helper() { return local; }`,
        `  useEffect(() => {`,
        `    console.log(other, state, helper(), rest, a.x.y, b, c, local, first, second, Kind.One, Space.inner);`,
        `    setState(1);`,
        `  }, []);`,
        `  useCallback(() => [rest, c, b, a], []);`,
        `  useMemo(() => <Thing a={a} b={local}>{other}{state}</Thing>, []);`,
        `}`,
        ``,
      ].join("\n"),
    },
  },
  {
    name: "exhaustive-deps/comments",
    about: "comments go by the array, which is the primary label",
    config: hooks,
    files: {
      "a.tsx": `function Component({ a }) {\n  useEffect(() => {\n    console.log(a);\n    // oxlint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n  useEffect(() => {\n    // oxlint-disable-next-line react-hooks/exhaustive-deps\n    console.log(a);\n  }, []);\n}\n`,
    },
  },
  {
    name: "no-unused-vars/type-query",
    about: "oxlint_counts_type_query_as_use: typeof a in a type is a use, outside of what declares a",
    config: unused,
    files: {
      "a.ts": `const list = ["a", "b"] as const;\nexport type Item = (typeof list)[number];\nexport function f() {\n  const value = g();\n  check<typeof value>();\n}\nconst self: typeof self = 1;\nexport function h(a: number, b: typeof a) {\n  return b;\n}\nconst never = 1;\n`,
    },
  },
  {
    name: "no-unused-vars/loop",
    about: "oxlint_is_in_loop_body: a statement that updates a variable in the body of a loop is a use",
    config: unused,
    files: {
      "a.ts": `export function f(xs: number[]) {\n  let a = 0;\n  for (const x of xs) {\n    if (x) {\n      a++;\n    }\n  }\n  let b = 0;\n  while (xs.pop()) b += 1;\n  let c = 0;\n  do {\n    c = c + 1;\n  } while (xs.pop());\n  let d = 0;\n  for (let i = 0; i < 1; i++) d--;\n  let e = 0;\n  for (const k in xs) e += 1;\n  let g = 0;\n  for (const x of xs) {\n    xs.forEach(() => {\n      g++;\n    });\n  }\n  let h = 0;\n  for (const x of xs) h = 1;\n  let i = 0;\n  if (xs) {\n    i++;\n  }\n}\n`,
    },
  },
  {
    name: "no-unused-vars/returned-function",
    about: "oxlint_is_in_return_statement: the same at the top of a function that is part of what is returned",
    config: unused,
    files: {
      "a.ts": `export function f(xs: number[]) {\n  let a = 0;\n  let b = 0;\n  let c = 0;\n  let d = 0;\n  let e = 0;\n  xs.forEach(() => {\n    b++;\n  });\n  const later = () => {\n    c++;\n  };\n  later();\n  return {\n    bump: async () => {\n      a++;\n    },\n    nested() {\n      if (xs) {\n        d++;\n      }\n    },\n    add: function () {\n      e += 1;\n    },\n  };\n}\nexport const g = () => {\n  let n = 0;\n  return () => n++;\n};\nlet m = 0;\nexport const h = () => ({\n  bump() {\n    m++;\n  },\n});\n`,
    },
  },
  {
    name: "no-unused-vars/place",
    about: "oxlint_reports_the_declaration",
    config: unused,
    files: { "a.ts": `export function f() {\n  let n = 0;\n  n++;\n  let m;\n  m = 1;\n  m = 2;\n}\n` },
  },
  {
    name: "consistent-type-imports/react",
    about: "oxlint_takes_for_jsx_factory",
    config: rules(["typescript"], { "typescript/consistent-type-imports": "error" }),
    files: {
      "a.ts": `import * as React from "react";\nexport function C(x: unknown) {\n  return x as React.ReactNode;\n}\n`,
      "b.ts": `import React from "react";\nexport type N = React.ReactNode;\n`,
      "c.ts": `import * as Other from "other";\nexport type N = Other.Node;\n`,
      "d.ts": `import React, { FC } from "react";\nexport type N = [React.ReactNode, FC];\n`,
      "e.ts": `import { React } from "react";\nexport type N = React.ReactNode;\n`,
    },
  },
  {
    name: "no-accumulating-spread/places",
    about: "in a loop the accumulator is printed, and comments go by the loop",
    config: rules(["oxc"], { "oxc/no-accumulating-spread": "warn" }),
    files: {
      "a.ts": `let all = [];\nfor (const it of items) {\n  all = [...all, it];\n}\nlet more = [];\n// oxlint-disable-next-line oxc/no-accumulating-spread\nfor (const it of items) {\n  more = [...more, it];\n}\n// oxlint-disable-next-line oxc/no-accumulating-spread\nlet rest = [];\nfor (const it of items) {\n  rest = [...rest, it];\n}\nitems.reduce((acc, it) => [...acc, it], []);\n`,
    },
  },
];
