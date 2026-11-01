// Makes test cases for prettier-plugin-organize-imports: one import, and one way to use, or not to use, its name.
//
//   node organize-uses.mjs --modules=<dir> --out=cases.json
import fs from "node:fs";
import { flags, load } from "./oracle.mjs";

const { named } = flags(process.argv.slice(2));
const { expected } = await load(named.modules);
const IMPORTS = [`import A from "m";`, `import { A } from "m";`, `import * as A from "m";`, `import type { A } from "m";`, `import { type A } from "m";`, `import { x as A } from "m";`, `import { A, B } from "m";\nB;`];
const USES = [
  `A;`, `A();`, `new A();`, `A.b;`, `x.A;`, `x?.A;`, `const o = { A };`, `const o = { A: 1 };`, `const o = { [A]: 1 };`, `const o = { a: A };`,
  `let v: A;`, `let v: A.B;`, `let v: typeof A;`, `let v: x.A;`, `let v: Array<A>;`, `type T = { A: 1 };`, `type T = { [k in A]: 1 };`, `type T = keyof A;`,
  `function f(A) { return A; }`, `function f() { let A = 1; return A; }`, `function f(a = A) {}`, `function f<A>(a: A) {}`, `function f(a: A) {}`,
  `class C extends A {}`, `class C implements A {}`, `interface I extends A {}`, `class C { A = 1; }`, `class C { @A m() {} }`, `@A class C {}`, `class C { m(@A p) {} }`,
  `export { A };`, `export { A as b };`, `export { b as A };`, `export default A;`, `export = A;`, `export type { A };`, `export { A } from "n";`, `export * as A from "n";`,
  "`${A}`;", "A`x`;", `A: for (;;) break A;`, `const { A: b } = x;`, `const { b = A } = x;`, `const { b: A2 = A } = x;`, `x = A;`, `A = 1;`, `A++;`, `delete A.b;`, `typeof A;`, `void A;`,
  `/** {@link A} */\nfoo();`, `/** {@link A.b} */\nfoo();`, `/** @see A */\nfoo();`, `/** @see {@link A} */\nfoo();`, `/** @param {A} a */\nfunction f(a) {}`, `/** @type {A} */\nlet v;`, `/** A */\nfoo();`, `// {@link A}\nfoo();`, `/* {@link A} */\nfoo();`,
  `/** @returns {Promise<A>} */\nfunction f() {}`, `/** @throws {A} */\nfunction f() {}`, `/** @template {A} T */\nfunction f() {}`, `/** @typedef {A} T */`, `/** @link A */\nfoo();`, `/** [[A]] */\nfoo();`, `/** {@linkcode A} */\nfoo();`, `/** {@linkplain A} */\nfoo();`, `/** {@link x.A} */\nfoo();`, `/** {@link A#b} */\nfoo();`, `/** {@link A | text} */\nfoo();`, `/** {@inheritDoc A} */\nfoo();`, `/**\n * text {@link A}\n */\nfoo();`, `function f() {\n  /** {@link A} */\n  foo();\n}`, `foo(); /** {@link A} */`, `/** {@link A} */`,
  `declare module "m" { interface X {} }`, `declare module "n" { let v: A; }`, `declare global { let v: A; }`, `namespace N { export const v = A; }`, `namespace A {}`, `enum E { A }`, `enum E { b = A }`, `import b = A.c;`, `import b = require("A");`,
  `let v = <A>x;`, `let v = x as A;`, `let v = x satisfies A;`, `let v = x!.A;`, `function f(this: A) {}`, `let v: A[];`, `let v: [A];`, `let v: () => A;`, `let v: new () => A;`, `function f(x): x is A {}`, `function f(x): asserts x is A {}`, `let v: import("A");`, `let v: A extends 1 ? 2 : 3;`, `let v: 1 extends infer A ? A : 3;`,
];
const JSX = [`<A />;`, `<A></A>;`, `<A.b />;`, `<a.A />;`, `<a A="1" />;`, `<a b={A} />;`, `<a {...A} />;`, `<a>{A}</a>;`, `<a>A</a>;`, `<A:b />;`, `<a:A />;`, `<></>;`, `<div />;`];
const cases = [];
async function add(name, filename, input, options = {}) {
  cases.push({ plugin: "organize", name, filename, options, input, ...(await expected("organize", input, { ...options }, "/" + filename)) });
}
for (const [i, imported] of IMPORTS.entries()) {
  for (const [u, use] of USES.entries()) await add(`uses/${i}/${u}`, "a.ts", `${imported}\n${use}\n`);
  for (const [u, use] of USES.entries()) if (!/[:<]|implements|interface|type |enum|namespace|declare|import b|satisfies| as |!/.test(use.replace(/\/\*[\s\S]*?\*\//g, ""))) await add(`uses-js/${i}/${u}`, "a.js", `${imported.replace(/type /g, "")}\n${use}\n`);
  for (const [u, use] of JSX.entries()) await add(`jsx/${i}/${u}`, "a.tsx", `${imported}\n${use}\n`);
}
for (const name of ["React", "h", "Fragment"]) for (const [u, use] of JSX.entries()) await add(`react/${name}/${u}`, "a.tsx", `import ${name} from "m";\n${use}\n`);
for (const [u, use] of JSX.entries()) await add(`pragma/${u}`, "a.tsx", `/** @jsx h */\n/** @jsxFrag Fragment */\nimport { h, Fragment } from "m";\n${use}\n`);
fs.writeFileSync(named.out, JSON.stringify(cases));
console.log(`${cases.length} cases, of which ${cases.filter(it => it.error).length} are errors`);
