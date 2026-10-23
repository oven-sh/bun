import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun run --aot` runs the text that plain Bun runs and notes beside it which expressions are held to a type. An expression that is held to a type
// keeps the parentheses that the expression around it needs: `a ?? (b && c)`, `(-a) ** 2`, `(await a) ** 2`.
const mayBeNullish = [
  "g.a",
  "await g.a",
  "g.n ?? g.b",
  "g.o || g.b",
  "g.a && g.b",
  "g.a, g.b",
  "g.o ? g.b : g.c",
  "x = g.a",
  "g?.a",
  "g.f()",
  "g.f?.()",
  "new g.C().p",
  "g.a!",
];
const arithmetic = [
  "-g.a",
  "+g.a",
  "~g.a",
  "g.a + g.b",
  "g.a - g.b",
  "g.a * g.b",
  "g.a ** g.b",
  "g.a % g.b",
  "x += g.a",
  "g.a | g.b",
  "g.a & g.b",
  "g.a << g.b",
  "x++",
  "--x",
];
const yieldsNumber = [
  "g.n ?? H",
  "H || g.b",
  "g.o || H",
  "H && g.b",
  "g.a && H",
  "H ** 2",
  "2 ** H",
  "-H",
  "+H",
  "~H",
  "await H",
  "H + 1",
  "1 + H",
  "10 - H",
  "H - 1",
  "H * 2",
  "2 * H",
  "60 / H",
  "H / 2",
  "H % 2",
  "7 % H",
  "H | 8",
  "H & 6",
  "H ^ 1",
  "H << 1",
  "1 << H",
  "(g.o, H)",
  "H ? 1 : 2",
  "g.a ? H : 2",
  "g.o ? 1 : H",
  "[H][0]",
  "[1, H][1]",
  "({ a: H }).a",
  "x = H",
  "x += H",
  "takes(H)",
  "takes(...[H])",
  "await (async () => H)()",
];
const yieldsAnother = [
  "(H, g.a)",
  "!H",
  "typeof H",
  "void H",
  "H < 3",
  "3 < H",
  "H == 2",
  "`${H}`",
  "String(H)",
  "g.id(H)",
  "H.toFixed(1)",
  'H["toFixed"](1)',
  "new g.C(H).p",
  "[...[H]]",
];
const takesUndefined = ["H?.toFixed(1)", "H || g.b", "H && g.b", "H ? 1 : 2", "!H", "typeof H", "String(H)"];

function program() {
  const lines = [
    `declare const console: { log(...values: unknown[]): void };`,
    `const g: any = { a: 2, b: 3, c: 5, n: null, o: 0, f: () => 4, C: class { p = 6 }, id: (v: unknown) => v }; let x: any = 7;`,
    `function takes(n: number): number { return n; }`,
    `const all: (() => Promise<unknown>)[] = [];`,
  ];
  const add = (body: string) => lines.push(`all.push(async () => { x = 7; ${body} });`);
  for (const e of [...mayBeNullish, ...arithmetic]) {
    for (const o of [...yieldsNumber, ...yieldsAnother]) {
      add(`return ${o.replaceAll("H", `((${e}) as number)`)};`);
      add(`return ${o.replaceAll("H", `((${e}) as any as number)`)};`);
    }
    for (const o of yieldsNumber) {
      add(`const r: number = ${o.replaceAll("H", `(${e})`)}; return r;`);
      add(`return takes(${o.replaceAll("H", `(${e})`)});`);
    }
    for (const o of takesUndefined) add(`return ${o.replaceAll("H", `((${e}) as any as number | undefined)`)};`);
  }
  for (const e of mayBeNullish) {
    add(`return ((${e}) as any as number | undefined) ?? g.b;`);
    add(`const r: number = (${e}) ?? g.b; return r;`);
  }
  lines.push(
    `const seen: string[] = []; for (const one of all) seen.push(String(await one())); console.log(seen.join(" "));`,
  );
  return lines.join("\n");
}

test("an expression that is held to a type keeps the parentheses it needs", async () => {
  using dir = tempDir("run-aot-keeps-parentheses", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true } }`,
    "main.ts": program(),
  });
  async function ran(...flags: string[]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "run", ...flags, "main.ts"], String(dir));
    return {
      stdout,
      stderr: stderr
        .split("\n")
        .filter(line => /error/i.test(line))
        .slice(0, 5),
      exitCode,
    };
  }
  expect(await ran("--aot")).toEqual(await ran());
  expect(await ran("--debug-aot")).toEqual(await ran());
}, 120_000);
