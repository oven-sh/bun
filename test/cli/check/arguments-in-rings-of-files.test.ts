// The names of files that import one another are made from calls that such a name is handed to. What a call reports about its argument stays, and no name in the
// ring takes the type of its declaration for final before the ring is closed: a loop's back edge is the only place where TypeScript assigns a type in between.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const callbacks = (assigned: string) => ({
  "b.ts": `import { f } from "./a";
export function g(a: ReturnType<typeof g>) { return f([]); }
`,
  "c.ts": `import { h } from "./a";
export function spread() { let l = []; for (const x of [1]) { ${assigned}l.concat(h()); } return { ...h() }; }
`,
  "a.ts": `import { g } from "./b";
import { spread } from "./c";
export function h() { return (() => g(1))(); }
export function f(a: unknown) { return o; }
const o = { m() {}, l: [spread()].filter(x => ({ q: 1 })) };
`,
});

// The first file is checked first. The errors are those of TypeScript 7.0.2.
const programs: [name: string, files: Record<string, string>, errors: string[]][] = [
  [
    "a list of the call's own results",
    {
      "a.ts": `import { list } from "./b";
declare const c: boolean;
export function f() { return { q: [c ? 1 : 2].map(list)[0] }; }
export const all = [f()];
`,
      "b.ts": `import { all } from "./a";
export const list = [1].map(all);
`,
    },
    ["a.ts(3,17) TS7023", "a.ts(4,14) TS7022", "b.ts(2,14) TS7022", "b.ts(2,29) TS2345"],
  ],
  [
    "a text of an object",
    {
      "a.ts": `import { f } from "./b";
export const o = { m() {}, p: [[1].map(f)] };
`,
      "b.ts": `import { o } from "./a";
const l = [1].map(o);
export const f = \`\${o}\`;
`,
    },
    ["a.ts(2,14) TS7022", "b.ts(2,19) TS2345", "b.ts(3,14) TS7022"],
  ],
  [
    "a callback behind a loop",
    callbacks(""),
    [
      "a.ts(3,17) TS7023",
      "a.ts(3,31) TS7024",
      "a.ts(4,17) TS7023",
      "a.ts(5,7) TS7022",
      "b.ts(2,17) TS7023",
      "b.ts(2,19) TS2502",
      "c.ts(2,17) TS7023",
      "c.ts(2,32) TS7034",
      "c.ts(2,63) TS7005",
    ],
  ],
  [
    "a callback behind a loop that assigns",
    callbacks("l = "),
    [
      "a.ts(3,17) TS7023",
      "a.ts(3,31) TS7024",
      "a.ts(4,17) TS7023",
      "a.ts(5,7) TS7022",
      "b.ts(2,17) TS7023",
      "b.ts(2,19) TS2502",
      "c.ts(2,17) TS7023",
      "c.ts(2,32) TS7034",
      "c.ts(2,67) TS7005",
    ],
  ],
  [
    "a parameter that is made from its own function, in a loop",
    {
      "c.ts": `import type { T } from "./b";
export function f(a: T<ReturnType<typeof f>> | null) { return [].length; }
`,
      "a.ts": `import { f } from "./c";
{ let l = []; for (const x of [1]) { l = l.concat(f(1)); } }
`,
      "b.ts": `import {} from "./a";
export type T<X> = 11;
`,
    },
    ["a.ts(2,42) TS7005", "a.ts(2,7) TS7034", "c.ts(2,19) TS2502"],
  ],
];

test.concurrent.each(programs)("%s", async (_, files, errors) => {
  const tsconfig = JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      lib: ["esnext"],
      types: [],
    },
    files: Object.keys(files),
  });
  using dir = tempDir("check-arguments-in-rings", { ...files, "tsconfig.json": tsconfig });
  const { stdout, stderr } = await run(
    [bunExe(), "check", "--no-pretty", "--all", "--threads=1", "-p", "."],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const told = (stdout + stderr).matchAll(/^(\w+\.ts\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`).sort()).toEqual(errors);
});
