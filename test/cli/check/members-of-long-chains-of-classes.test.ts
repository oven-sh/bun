// resolveObjectTypeMembers instantiates the base types of a class one after another. Where the argument of each has one level more than the one before,
// T[][].., nothing instantiates all the levels at once, and TypeScript tells no TS2589 however long the chain is.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const chain = (first: string, next: (i: number) => string, length: number) =>
  [first, ...Array.from({ length }, (_, i) => next(i + 1))].join("\n");

const programs: Record<string, string> = {
  fields: `${chain(
    "class C0<T> { v!: T; }",
    i => `class C${i}<T> extends C${i - 1}<T[]> { w${i}!: T; }`,
    130,
  )}\nexport const z = new C130<number>().v;\nexport const last: string = new C130<number>().w130;\n`,
  methods: `${chain(
    "class C0<T> { give(x: T): T { return x; } get g(): T { throw 1; } set g(x: T) {} }",
    i => `class C${i}<T> extends C${i - 1}<T[]> {}`,
    120,
  )}\nexport const z = new C120<number>().give;\n`,
  interfaces: `${chain(
    "interface C0<T> { v: T }",
    i => `interface C${i}<T> extends C${i - 1}<T[]> { w${i}: T }`,
    120,
  )}\nexport declare const c: C120<number>;\nexport const z = c.v;\nexport const last: string = c.w120;\n`,
  pairs: `${chain(
    "class C0<T, U> { v!: Map<T, U>; }",
    i => `class C${i}<T, U> extends C${i - 1}<Map<T, U>, U[]> {}`,
    110,
  )}\nexport const z = new C110<number, string>();\n`,
};

describe.each(Object.keys(programs))("%s", name => {
  test("are as long as they like", async () => {
    using dir = tempDir("check-members-of-long-chains-of-classes", {
      "tsconfig.json": tsconfig,
      "main.ts": programs[name],
    });
    const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
    const told = (stdout + stderr).matchAll(/^main\.ts\((\d+),\d+\): error (TS\d+)/gm);
    const expected = { fields: ["133 TS2322"], methods: [], interfaces: ["124 TS2322"], pairs: [] };
    expect([...told].map(([, line, code]) => `${line} ${code}`)).toEqual(expected[name as keyof typeof expected]);
  });
});
