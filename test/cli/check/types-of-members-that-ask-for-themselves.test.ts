// An interface whose member asks, by a conditional type, whether the interface is assignable to itself: what is found while its variances are measured is the type that the member's declaration
// keeps, and the first one who asked gets another. TypeScript keeps that one for the member of the instantiation. The check gave the next reader the declaration's. The errors are those of TypeScript 6.0.3 and 7.0.2.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const globals = `interface Array<T> { length: number; [index: number]: T }
interface Boolean {} interface CallableFunction {} interface Function {} interface IArguments {} interface NewableFunction {} interface Number {} interface Object {} interface RegExp {} interface String {}
`;
const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noLib: true,
    types: [],
    module: "preserve",
    moduleResolution: "bundler",
    target: "esnext",
    noEmit: true,
  },
  files: ["globals.d.ts", "main.ts"],
});

const programs: Record<string, [files: Record<string, string>, errors: string[]]> = {
  "a union, the member first": [
    {
      "an.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null | null = null as unknown as Is<Crate<string>>;
`,
      "assigned.ts": `import type { Is, Crate } from "./ring";
export function assigned(wide: Crate<string | number>): Crate<string> { return wide; }
`,
      "ay.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null | null = null as unknown as Is<Crate<string>>;
`,
      "main.ts": `import "./ring";
import "./ay";
import "./an";
import "./my";
import "./mn";
import "./assigned";
`,
      "mn.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "my.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "ring.ts": `import "./my";
export type Is<X> = (X extends Crate<number> ? { yes: 1 } : { no: 2 }) | null;
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>; }
`,
    },
    ["ay.ts(2,14) TS2322", "my.ts(2,14) TS2322"],
  ],
  "an indexed access, the member first": [
    {
      "an.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null = null as unknown as Is<Crate<string>>["w"];
`,
      "assigned.ts": `import type { Is, Crate } from "./ring";
export function assigned(wide: Crate<string | number>): Crate<string> { return wide; }
`,
      "ay.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null = null as unknown as Is<Crate<string>>["w"];
`,
      "main.ts": `import "./ring";
import "./ay";
import "./an";
import "./my";
import "./mn";
import "./assigned";
`,
      "mn.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "my.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "ring.ts": `import "./my";
export type Is<X> = { w: X extends Crate<number> ? { yes: 1 } : { no: 2 } };
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>["w"]; }
`,
    },
    ["ay.ts(2,14) TS2741", "my.ts(2,14) TS2322"],
  ],
  "a union, an assignment first": [
    {
      "an.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null | null = null as unknown as Is<Crate<string>>;
`,
      "assigned.ts": `import type { Is, Crate } from "./ring";
export function assigned(wide: Crate<string | number>): Crate<string> { return wide; }
`,
      "ay.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null | null = null as unknown as Is<Crate<string>>;
`,
      "main.ts": `import "./ring";
import "./ay";
import "./an";
import "./my";
import "./mn";
import "./assigned";
`,
      "mn.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "my.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "ring.ts": `import "./assigned";
export type Is<X> = (X extends Crate<number> ? { yes: 1 } : { no: 2 }) | null;
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>; }
`,
    },
    ["an.ts(2,14) TS2322", "mn.ts(2,14) TS2322"],
  ],
  "an indexed access, an assignment first": [
    {
      "an.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | null = null as unknown as Is<Crate<string>>["w"];
`,
      "assigned.ts": `import type { Is, Crate } from "./ring";
export function assigned(wide: Crate<string | number>): Crate<string> { return wide; }
`,
      "ay.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | null = null as unknown as Is<Crate<string>>["w"];
`,
      "main.ts": `import "./ring";
import "./ay";
import "./an";
import "./my";
import "./mn";
import "./assigned";
`,
      "mn.ts": `import type { Is, Crate } from "./ring";
export const x: { no: 2 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "my.ts": `import type { Is, Crate } from "./ring";
export const x: { yes: 1 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;
`,
      "ring.ts": `import "./assigned";
export type Is<X> = { w: X extends Crate<number> ? { yes: 1 } : { no: 2 } };
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>["w"]; }
`,
    },
    ["an.ts(2,14) TS2741", "mn.ts(2,14) TS2322"],
  ],
  // Both sides of a comparison with a base type ask for one member of one reference to the interface that declares it.
  "heirs in front of their bases": [
    {
      "main.ts": `import "./types";
import "./other";
import { Box, Crate, Is, Pack } from "./types";
export function narrowPack(narrow: Pack<string>): Pack<string | number> { return narrow; }
export const kindOfCrate: never = (null! as Crate<string>).kind;
export function wideBox(wide: Box<string | number>): Box<string> { return wide; }
export const lastOfPack: never = (null! as Pack<string>).last;
export const alsoOfPack: never = (null! as Pack<string>).also;
export const kindOfPack: never = (null! as Pack<string>).kind;
export const kindOfBox: never = (null! as Box<string>).kind;
`,
      "other.ts": `import { Box, Crate, Is, Pack } from "./types";
export function narrowPack(narrow: Pack<string>): Pack<string | number> { return narrow; }
export const kindOfCrate: never = (null! as Crate<string>).kind;
export function wideBox(wide: Box<string | number>): Box<string> { return wide; }
export const lastOfPack: never = (null! as Pack<string>).last;
export const alsoOfPack: never = (null! as Pack<string>).also;
export const kindOfPack: never = (null! as Pack<string>).kind;
export const kindOfBox: never = (null! as Box<string>).kind;
`,
      "types.ts": `export interface Pack<T> extends Box<T[]> { last: Is<Pack<number>>["w"]; }
export interface Box<T> extends Crate<T> { also: Is<Box<string>>["w"]; inner: Crate<T>; }
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>["w"]; }
export type Is<X> = { w: X extends Crate<number> ? { yes: 1 } : { no: 2 } };
`,
    },
    [
      "main.ts(10,14) TS2322",
      "main.ts(4,75) TS2322",
      "main.ts(5,14) TS2322",
      "main.ts(7,14) TS2322",
      "main.ts(8,14) TS2322",
      "main.ts(9,14) TS2322",
      "other.ts(2,75) TS2322",
      "other.ts(3,14) TS2322",
      "other.ts(5,14) TS2322",
      "other.ts(6,14) TS2322",
      "other.ts(7,14) TS2322",
      "other.ts(8,14) TS2322",
    ],
  ],
};

test.concurrent.each(Object.keys(programs))("%s", async name => {
  const [files, errors] = programs[name];
  using dir = tempDir("check-members-that-ask-for-themselves", {
    "globals.d.ts": globals,
    "tsconfig.json": tsconfig,
    ...files,
  });
  for (const threads of [1, 2, 8, 32]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    const told = [...stdout.matchAll(/^(\S+\.ts\(\d+,\d+\)): error (TS\d+)/gm)].map(it => `${it[1]} ${it[2]}`);
    expect(told.sort()).toEqual(errors);
  }
});
