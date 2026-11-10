import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { SourceMapConsumer } from "source-map";

// A debug build of Bun takes seconds for each build and each type check here.
setDefaultTimeout(60_000);

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What `bun check` says of the project in `root`. `errors`: the place and the code of each error, by file. `types`: a
// file under `types/` gives each name to a `never`, so the error says the type of the name. They are listed by file.
async function checkedIn(root: string) {
  const checked = await bun(root, "check");
  const errors: Record<string, string[]> = {};
  const types: Record<string, string[]> = {};
  for (const [, file, at, code, said] of checked.stdout.matchAll(/^(.+?)(\(\d+,\d+\)): error (TS\d+): (.*)$/gm)) {
    const path = file.replaceAll("\\", "/");
    const type = /^Type '(.*)' is not assignable to type 'never'\.$/.exec(said)?.[1];
    if (!path.startsWith("types/")) (errors[path] ??= []).push(`${at}: ${code}`);
    else if (type) (types[path] ??= []).push(type);
  }
  return { errors, types };
}

// A project that checks its `callers` under the options that `bun compile` checks the `.aot.ts` files of a package under.
const compilerOptions = { strict: true, lib: ["es2015"] };
const checked = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      ...compilerOptions,
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: [],
    },
    include: ["callers"],
  }),
  "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", compilerOptions }),
};

// Each shape is a library of its own in `src/<shape>/`, beside a caller and every error that `bun check` has for the
// caller. The caller is judged twice: by the sources, and by the `index.aot.ts` of the shape's build. `root`: files of
// the project that holds the libraries. `bare`: the constants of enum members that get no cast.
type Shape = {
  files: Record<string, string>;
  root?: Record<string, string>;
  caller: string;
  errors: string[];
  bare?: string[];
};
const shapes: Record<string, Shape> = {
  "enum-member-in-an-object": {
    files: {
      "index.ts": `export enum Unit { Px = "px", Em = "em" }
const state = { unit: Unit.Px, n: 1 };
export function set(u: Unit): void { state.unit = u; }
export function get(): Unit { return state.unit; }
`,
    },
    caller: `import { get, set, Unit } from "LIBRARY";
set(Unit.Em);
const unit: Unit = get();
set("em");
`,
    errors: ["(4,5): TS2345"],
  },
  "numeric-enum-member-in-a-list": {
    files: {
      "index.ts": `export enum Unit { Px, Em }
export const list = [Unit.Px];
`,
    },
    caller: `import { list, Unit } from "LIBRARY";
list.push(Unit.Em);
list.push(7);
`,
    errors: ["(3,11): TS2345"],
  },
  "enum-member-that-widens-where-it-is-stored-later": {
    files: {
      "index.ts": `export enum Unit { Px = "px", Em = "em", Rem = "rem" }
declare function box<T>(value: T): T[];
const first = Unit.Px;
export let held = first;
export function pick() { return Unit.Px; }
export const chosen = { unit: Math.random() > 2 ? Unit.Px : Unit.Em };
export const boxed = box(Unit.Px);
export let orNone = Unit.Px as Unit | null;
export const fixed = Unit.Px as const;
`,
    },
    caller: `import { boxed, chosen, fixed, held, orNone, pick, Unit } from "LIBRARY";
const units: Unit[] = [held, pick(), chosen.unit, boxed[0]!];
boxed.push(Unit.Rem);
chosen.unit = Unit.Rem;
const none: Unit | null = orNone;
const px: Unit.Px = fixed;
const wrong: Unit.Px = pick();
const alsoWrong: Unit.Em = fixed;
`,
    errors: ["(7,7): TS2322", "(8,7): TS2322"],
  },
  "enum-member-where-its-own-type-is-asked-for": {
    files: {
      "index.ts": `export enum Kind { A, B }
export interface IsA { kind: Kind.A; a: number }
export interface IsB { kind: Kind.B; b: string }
export function read(x: IsA | IsB): number | string { return x.kind === Kind.A ? x.a : x.b; }
export const first: IsA = { kind: Kind.A, a: 1 };
export const both = [read({ kind: Kind.A, a: 1 }), read({ kind: Kind.B, b: "x" })];
export const pair = [Kind.A, Kind.B] as const;
`,
    },
    caller: `import { Kind, first, pair, read } from "LIBRARY";
read(first);
const a: Kind.A = pair[0];
const b: Kind.A = pair[1];
`,
    errors: ["(4,7): TS2322"],
    bare: ["0 /* A */", "1 /* B */"],
  },
  "numeric-enum-member-that-picks-the-member-of-a-union": {
    files: {
      "kind.ts": `export enum Kind { A, B }\n`,
      "index.ts": `import * as k from "./kind";
export type Handler = { kind: k.Kind.A; run(x: number): string } | { kind: k.Kind.B; run(x: string): string };
export const first: Handler = { kind: k.Kind.A, run: x => x.toFixed() };
export function second(): Handler { return { kind: k.Kind.B, run: x => x.trim() }; }
export const kinds = [first.kind, second().kind];
`,
    },
    caller: `import { first, kinds, second } from "LIBRARY";
kinds.push(first.kind, second().kind);
kinds.push(7);
`,
    errors: ["(3,12): TS2345"],
    bare: ["0 /* A */", "1 /* B */"],
  },
  "enum-member-in-an-expression-that-a-build-can-fold": {
    files: {
      "level.ts": `export enum Level { Low = 1, High = 2 }\n`,
      "index.ts": `import { Level } from "./level";
export enum Own { Zero = 0, One = 1, Two = 2 }
export enum Unit { Px = "px", Em = "em" }
export let product = Level.Low * 1;
export let sum = Own.Two + 0;
export let plus = +Own.One;
export let negative = -Own.One;
export let text = \`\${Level.High}\`;
export let length = Unit.Px.length;
export let kept = Level.High;
export let either = Unit.Px || Unit.Em;
export function can(have: Own, want: Own): boolean { return (have & want) === want; }
export function both(have: Own): boolean { return can(have, Own.One | Own.Two); }
export function isPx(unit: Unit): boolean { return Unit.Px === unit; }
export function isOne(own: Own): boolean { return Own.One === own; }
export { Level };
`,
    },
    caller: `import { both, either, isOne, isPx, kept, length, Level, negative, Own, plus, product, sum, text, Unit } from "LIBRARY";
const numbers: number[] = [product, sum, plus, negative, length];
const texts: string[] = [text];
const a: typeof product = 5;
const b: typeof sum = 5;
const c: typeof plus = 5;
const d: boolean = both(Own.One) || isPx(Unit.Em) || isOne(Own.Two);
const e: Level = kept;
const f: Unit = either;
const wrong: typeof kept = 5;
const alsoWrong: typeof either = "em";
`,
    errors: ["(10,7): TS2322", "(11,7): TS2322"],
  },
  "constant-that-holds-an-enum-member-and-is-used-twice": {
    files: {
      "index.ts": `export enum Kind { A = "a", B = "b" }
const DEFAULT_KIND = Kind.A;
export function pick(kind: Kind = DEFAULT_KIND): Kind { return kind; }
export function other(kind: Kind = DEFAULT_KIND): Kind { return kind; }
export const pair = [DEFAULT_KIND, DEFAULT_KIND];
`,
    },
    caller: `import { Kind, other, pair, pick } from "LIBRARY";
const kinds: Kind[] = [pick(), other(Kind.B), ...pair];
pair.push(Kind.B);
pair.push("b");
`,
    errors: ["(4,11): TS2345"],
  },
  "enum-member-with-no-initializer": {
    files: {
      "index.ts": `export enum Kind { A, B }
export interface IsA { kind: Kind.A; a: number }
export interface IsB { kind: Kind.B; b: string }
export function read(x: IsA | IsB): number | string { return x.kind === Kind.A ? x.a : x.b; }
export enum Color { Red = 1, Green }
`,
    },
    caller: `import { Color, Kind, read } from "LIBRARY";
read({ kind: Kind.A, a: 1 });
read({ kind: Kind.B, b: "x" });
const two: 2 = Color.Green;
read({ kind: 9, a: 1 });
`,
    errors: ["(5,8): TS2322"],
  },
  "enum-initializer-that-is-not-written-as-a-constant": {
    files: {
      "index.ts": `const LIMIT = 5;
export enum A { X = 1 }
export enum B { P = A.X }
export enum C { X = 1, P = X, Q = C.X + 1, Most = LIMIT }
export enum D { Before, Length = "abc".length }
`,
    },
    caller: `import { B, C, D } from "LIBRARY";
const one: 1 = B.P;
const two: 2 = C.Q;
const most: 5 = C.Most;
const length: number = D.Length;
const wrong: 2 = B.P;
`,
    errors: ["(6,7): TS2322"],
  },
  "enum-in-two-blocks": {
    files: {
      "index.ts": `export enum E { A = 0 }
export enum E { B = 1 }
`,
    },
    caller: `import { E } from "LIBRARY";
const a: 0 = E.A;
const b: 1 = E.B;
const wrong: 0 = E.B;
`,
    errors: ["(4,7): TS2322"],
  },
  "enum-declared-inside-a-function": {
    files: {
      "index.ts": `export enum Local { Top = "top" }
export function f(): number {
  enum Local { A, B }
  const x: Local = Local.B;
  return x;
}
export class C {
  m(): string {
    enum Local { A = "a", B = "b" }
    const x: Local = Local.B;
    return x;
  }
}
export function k(): number {
  const enum Local { A, B }
  let x: Local = Local.B;
  x = Local.A;
  return x;
}
`,
    },
    caller: `import { C, f, k, Local } from "LIBRARY";
const n: number = f() + k();
const s: string = new C().m();
const top: Local = Local.Top;
const wrong: string = f();
`,
    errors: ["(5,7): TS2322"],
  },
  "enums-of-one-name-in-two-blocks-of-a-function": {
    files: {
      "index.ts": `export function f(flag: boolean): number {
  if (flag) {
    enum Local { A = 10, B }
    const x: Local = Local.B;
    return x;
  } else {
    enum Local { A = 20, B }
    let y: Local = Local.A;
    y = Local.B;
    return y;
  }
}
export function g(): string {
  enum Local { A = "a" }
  const held = [Local.A];
  const first: Local = held[0]!;
  return first;
}
`,
    },
    caller: `import { f, g } from "LIBRARY";
const n: number = f(true);
const s: string = g();
const wrong: string = f(false);
`,
    errors: ["(4,7): TS2322"],
  },
  "member-of-the-enum-of-another-file": {
    files: {
      "kind.ts": `export enum Kind { A = "a", B = "b" }
export enum Level { Low, High }
`,
      "index.ts": `import { Kind, Level } from "./kind";
export class M {
  kind: Kind = Kind.A;
  level = Level.Low;
  other: Kind = Math.random() > 2 ? Kind.A : Kind.B;
}
export function pick(kind: Kind = Kind.A, { level = Level.High }: { level?: Level } = {}): Kind {
  return level === Level.High ? kind : Kind.B;
}
export function label(kind: Kind): string {
  switch (kind) {
    case Kind.A: return "first";
    case Kind.B: return "second";
  }
}
export function isHigh(level: Level): boolean {
  switch (level) {
    case Level.Low: return false;
    case Level.High: return true;
  }
}
export { Kind, Level };
`,
    },
    caller: `import { isHigh, Kind, Level, M, label, pick } from "LIBRARY";
const m = new M();
m.kind = pick(Kind.B, { level: Level.Low });
m.level = Level.High;
const text: string = isHigh(m.level) ? label(m.other) : "";
m.kind = "b";
m.level = 7;
`,
    errors: ["(6,1): TS2322", "(7,1): TS2322"],
  },
  "enum-through-a-star-import": {
    files: {
      "kind.ts": `export enum Kind { A = "a", B = "b" }\n`,
      "index.ts": `import * as k from "./kind";
export const v: k.Kind = k.Kind.A;
export const u = k.Kind.B;
export function take(kind: k.Kind): k.Kind { return kind; }
export const t = take(k.Kind.B);
export const i = k.Kind["A"];
`,
    },
    caller: `import { i, t, u, v } from "LIBRARY";
const a: "a" = v;
const w: typeof u = "b";
const x: typeof i = "a";
`,
    errors: ["(2,7): TS2322", "(3,7): TS2322", "(4,7): TS2322"],
  },
  "const-enum": {
    files: {
      "flags.ts": `export const enum Flag { None = 0, Bold = 1 << 0, Italic = 1 << 1, Both = Bold | Italic }\n`,
      "index.ts": `import { Flag } from "./flags";
export const enum Own { A = "a", B = "b" }
export class Style {
  flags: Flag = Flag.None;
  own = Own.A;
  set(flag: Flag = Flag.Bold): this { this.flags |= flag; return this; }
}
export const all = [Flag.Both];
const enum Hidden { X = 1, Y = 2 }
export const hidden = [Hidden.X];
export { Flag };
`,
    },
    caller: `import { all, Flag, hidden, Own, Style } from "LIBRARY";
const style = new Style().set(Flag.Italic);
style.own = Own.B;
all.push(Flag.Bold);
style.own = "b";
hidden.push(2);
hidden.push(7);
`,
    errors: ["(5,1): TS2322", "(7,13): TS2345"],
  },
  "declare-enum-beside-an-enum": {
    files: {
      "index.ts": `declare enum Ambient { A = 1, B = 2 }
declare const enum Flags { None = 0, Bold = 1 }
export enum Real { A = 1, B }
export function f(x: Ambient | undefined, flags: Flags = Flags.Bold): Real {
  return flags === Flags.None || x === undefined ? Real.A : Real.B;
}
export const held = [Real.A];
`,
    },
    caller: `import { f, held, Real } from "LIBRARY";
const r: Real = f(undefined);
held.push(f(undefined, 0));
held.push(7);
`,
    errors: ["(4,11): TS2345"],
  },
  "enum-member-with-a-name-that-is-no-identifier": {
    files: {
      "index.ts": `export enum Header { "Content-Type" = "content-type", Accept = "accept" }
export const DEFAULT = Header["Content-Type"] as const;
export const sent = [Header["Content-Type"]];
export function name(header: Header): string {
  switch (header) {
    case Header["Content-Type"]: return "type";
    case Header.Accept: return "accept";
  }
}
`,
    },
    caller: `import { DEFAULT, Header, name, sent } from "LIBRARY";
const type: (typeof Header)["Content-Type"] = DEFAULT;
sent.push(Header.Accept);
const text: string = name(sent[0]!);
sent.push("accept");
let held = DEFAULT;
held = Header.Accept;
`,
    errors: ["(5,11): TS2345", "(7,1): TS2322"],
  },
  "table-with-enum-members-as-keys": {
    files: {
      "kind.ts": `export enum Kind { A = "a", B = "b" }\nexport enum Slot { First = -1, Second = 2 }\n`,
      "index.ts": `import * as k from "./kind";
const table: Partial<Record<k.Kind, string>> = {};
export function put(value: string): void { table[k.Kind.A] = value; }
export function get(): string {
  if (table[k.Kind.A] !== undefined) {
    return table[k.Kind.A];
  }
  return "";
}
export const byKind = { [k.Kind.A]: 1, [k.Kind.B]: 2 };
export class Keyed {
  [k.Slot.First] = "first";
  [k.Kind.B](): number { return 2; }
}
`,
    },
    caller: `import { byKind, get, Keyed, put } from "LIBRARY";
put("x");
const text: string = get() + new Keyed()[-1];
const n: number = byKind.a + byKind.b + new Keyed().b();
byKind.c;
`,
    errors: ["(5,8): TS2339"],
  },
  "enum-member-as-the-default-export": {
    files: {
      "kind.ts": `export enum Kind { A = "a", B = "b" }\n`,
      "fallback.ts": `import { Kind } from "./kind";\nexport default Kind.B;\n`,
      "index.ts": `import fallback from "./fallback";
import { Kind } from "./kind";
export function pick(): Kind.B { return fallback; }
export { Kind };
export default Kind.A;
`,
    },
    caller: `import first, { Kind, pick } from "LIBRARY";
const a: Kind.A = first;
const b: Kind.B = pick();
const wrong: Kind.B = first;
`,
    errors: ["(4,7): TS2322"],
  },
  "enum-member-given-to-a-const-type-parameter": {
    files: {
      "index.ts": `export enum Kind { A = "a", B = "b" }
export function first<const T>(items: T[]): T { return items[0]!; }
export function inside<const T>(box: { v: T }): T { return box.v; }
export function plain<T>(item: T): T[] { return [item]; }
export function lazy<const T>(make: () => T): T { return make(); }
export function store<const N extends string, S>(name: N, state: S): { name: N; state: S } { return { name, state }; }
export class Lazy<const T> { constructor(public value: T) {} }
export const only = first([Kind.A]);
export const inner = inside({ v: Kind.B });
export const list = plain(Kind.A);
export const made = lazy(() => Kind.A);
export const later = lazy(() => { return Kind.B; });
export const kept = store("settings", { kind: Kind.A });
export const held = new Lazy(Kind.B);
`,
    },
    caller: `import { held, inner, kept, Kind, later, list, made, only } from "LIBRARY";
const a: Kind.A = only;
const b: Kind.B = inner;
list.push(Kind.B);
const c: Kind.A = made;
const d: Kind.B = later;
kept.state.kind = Kind.B;
const e: Kind.B = held.value;
const wrong: Kind.B = only;
`,
    errors: ["(9,7): TS2322"],
  },
  "numeric-enum-member-in-a-default-object": {
    files: {
      "index.ts": `export enum Level { Debug, Info, Warn }
export interface Options { level: Level; name?: string }
export function describe(given?: Options): string {
  const used = given ?? { level: Level.Info };
  return (used.name ?? "anonymous") + ":" + used.level;
}
export function withDefaults(given?: Options) { return given || { level: Level.Warn }; }
export function orNull<T>(value: T | null): T { return value!; }
export const kept = orNull({ level: Level.Debug });
`,
    },
    caller: `import { describe, kept, Level, withDefaults } from "LIBRARY";
const text: string = describe({ level: Level.Debug });
const name: string | undefined = withDefaults().name;
kept.level = Level.Warn;
kept.level = 7;
`,
    errors: ["(5,1): TS2322"],
  },
  "enum-of-another-package": {
    files: {
      "index.ts": `import { Unit } from "other-units";
export const units = [Unit.Px];
export let current = Unit.Em;
`,
    },
    root: {
      "node_modules/other-units/package.json": JSON.stringify({
        name: "other-units",
        version: "1.0.0",
        main: "index.ts",
      }),
      "node_modules/other-units/index.ts": `export enum Unit { Px = "px", Em = "em" }\n`,
    },
    caller: `import { current, units } from "LIBRARY";
import { Unit } from "other-units";
units.push(current, Unit.Em);
units.push("rem");
`,
    errors: ["(4,12): TS2345"],
  },
  "template-that-reads-an-enum-member": {
    files: {
      "index.ts": `export enum Unit { Px = "px", Em = "em" }
export const size = \`10\${Unit.Px}\`;
export function width(w: \`\${number}px\`): string { return w; }
export function both(n: number): string { return \`\${n}\${Unit.Px}\`; }
`,
    },
    caller: `import { both, size, width } from "LIBRARY";
const w: string = width(size) + both(1);
const wrong: "10em" = size;
`,
    errors: ["(3,7): TS2322"],
  },
  "enum-member-with-a-name-that-ends-a-comment": {
    files: {
      "index.ts": `export enum Odd { "a*/b" = 1, C = 5 }
export const odd = [Odd["a*/b"]];
export const sum = Odd["a*/b"] + 1;
`,
    },
    caller: `import { Odd, odd, sum } from "LIBRARY";
odd.push(Odd.C);
const n: number = sum;
odd.push(7);
`,
    errors: ["(4,10): TS2345"],
  },
  "enum-member-that-is-a-power": {
    files: {
      "index.ts": `export enum Si { Yocto = 10 ** -24, Kilo = 10 ** 3, One = 1 }
export const tiny: Si = Si.Yocto;
export function scale(by: Si = Si.Yocto): number { return by; }
export const sizes = [Si.Kilo];
`,
    },
    caller: `import { scale, Si, sizes, tiny } from "LIBRARY";
const n: number = scale(tiny) + scale();
sizes.push(Si.One);
const kilo: 1000 = Si.Kilo;
const wrong: 1 = Si.Kilo;
`,
    errors: ["(5,7): TS2322"],
  },
};

// One build has several shapes as its entry points, and one `bun check` judges their callers. With `--splitting` each
// shape has a second entry point that exports what the first one does, so a chunk holds the code of both.
const names = Object.keys(shapes);
const acrossFiles = [
  "member-of-the-enum-of-another-file",
  "enum-through-a-star-import",
  "table-with-enum-members-as-keys",
];
const minified = [
  "enum-member-in-an-expression-that-a-build-can-fold",
  "constant-that-holds-an-enum-member-and-is-used-twice",
  "enum-member-given-to-a-const-type-parameter",
  "numeric-enum-member-in-a-default-object",
  "template-that-reads-an-enum-member",
  ...acrossFiles,
];
const builds = [
  ...Array.from({ length: Math.ceil(names.length / 7) }, (_, at) => ({
    flags: [] as string[],
    built: names.slice(at * 7, at * 7 + 7),
  })),
  { flags: ["--minify-syntax", "--minify-whitespace"], built: minified },
  { flags: ["--splitting"], built: [...acrossFiles, "const-enum"] },
].map(build => ({ ...build, title: [...build.flags, ...build.built].join(" ") }));

describe.concurrent("bun build --dts writes .aot.ts files that judge a caller as the sources do", () => {
  test.each(builds)("$title", async ({ flags, built }) => {
    const isSplit = flags.includes("--splitting");
    const files: Record<string, string> = { ...checked };
    for (const name of built) {
      const shape = shapes[name];
      Object.assign(files, shape.root);
      for (const [path, text] of Object.entries(shape.files)) files[`src/${name}/${path}`] = text;
      if (isSplit) files[`src/${name}/second.ts`] = `export * from "./index";\n`;
      // Beside the caller, a file that gives each name that the caller imports to a `never`.
      const [imports] = shape.caller.split("\n");
      const imported = imports.match(/\w+(?=,| }| from ")/g)!;
      const types = `${imports}\n${imported.map((name, index) => `const type${index}: never = ${name};\n`).join("")}`;
      for (const [judge, library] of [
        ["of-the-sources", `../../src/${name}/index`],
        ["of-the-typed-file", `../../out/${name}/index.aot`],
      ]) {
        files[`callers/${judge}/${name}.ts`] = shape.caller.replace('"LIBRARY"', `"${library}"`);
        files[`types/${judge}/${name}.ts`] = types.replace('"LIBRARY"', `"${library}"`);
      }
    }
    files["tsconfig.json"] = files["tsconfig.json"].replace('["callers"]', '["callers", "types"]');
    using dir = tempDir("build-dts-shapes", files);
    const entries = built.flatMap(name =>
      (isSplit ? ["index", "second"] : ["index"]).map(file => `./src/${name}/${file}.ts`),
    );
    const build = await bun(String(dir), "build", ...entries, "--root", "src", "--outdir", "out", "--dts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const { errors, types } = await checkedIn(String(dir));
    const byShape = <T>(of: (name: string) => T) => Object.fromEntries(built.map(name => [name, of(name)]));
    // A typed file names the type of an enum after its twin, and a chunk can rename what it holds: `Unit2`, `Unit3`.
    const named = (printed: string[] = []) => printed.map(type => type.replace(/\b([A-Za-z_$][\w$]*?)\d+\b/g, "$1"));
    const judged = (judge: string) =>
      byShape(name => ({
        errors: errors[`callers/${judge}/${name}.ts`] ?? [],
        types: named(types[`types/${judge}/${name}.ts`]),
      }));
    expect(byShape(name => errors[`callers/of-the-sources/${name}.ts`] ?? [])).toEqual(
      byShape(name => shapes[name].errors),
    );
    expect(judged("of-the-typed-file")).toEqual(judged("of-the-sources"));
    expect(byShape(name => errors[`out/${name}/index.aot.ts`] ?? [])).toEqual(byShape(() => []));
    // The printer says the member after each constant that it prints for one. A key has no cast, and neither has
    // a number by which TypeScript picks the member of a union: it picks by a literal, and by no cast.
    if (flags.length > 0) return;
    const bare = (name: string) =>
      readFileSync(join(String(dir), "out", name, "index.aot.ts"), "utf8").match(
        /(?:"[^"\n]*"|\b\d[\w.]*) \/\* [\w$-]+ \*\/(?!\])/g,
      ) ?? [];
    expect(byShape(bare)).toEqual(byShape(name => shapes[name].bare ?? []));
  });
});

// Builds of their own: several entry points that share an enum, and two options that move code.
const state = `export enum State { On, Off }
export interface Report { state: State }
export function report(): Report { return { state: State.On }; }
export function label(state: State): string {
  switch (state) {
    case State.On: return "on";
    case State.Off: return "off";
  }
}
`;
const shared: Record<string, string> = {
  ...checked,
  "src/state.ts": state,
  "src/index.ts": `export { report, label, State } from "./state";\nexport type { Report } from "./state";\n`,
  "src/other.ts": `import { report, State, type Report } from "./state";
enum Own { A, B }
export function isOn(r: Report = report()): boolean {
  switch (r.state) {
    case State.On: return [Own.A].length === 1;
    case State.Off: return false;
  }
}
export type { Report };
`,
};
const sharedCaller = (library: string, typed: string) => `import * as library from "${library}/index${typed}";
import { isOn } from "${library}/other${typed}";
const report: library.Report = library.report();
const on: boolean = isOn(report);
const text: string = library.label(library.State.Off);
const wrong: library.Report = { state: 7 };
`;
// Only a holder has the object of its `const enum`. One holder is listed before its reader, and one after.
const held: Record<string, string> = {
  ...checked,
  "src/flags.ts": `export const enum Flag { None = 0, Bold = 1 }\n`,
  "src/marks.ts": `export const enum Mark { None = 0, Star = 1 }\n`,
  "src/flag-reader.ts": `import type { Flag } from "./flags";\nexport function isSet(flag: Flag): boolean { return flag !== 0; }\n`,
  "src/flag-holder.ts": `import { Flag } from "./flags";\nexport function bold(): Flag { return Flag.Bold; }\nexport { Flag };\n`,
  "src/mark-reader.ts": `import type { Mark } from "./marks";\nexport function isMarked(mark: Mark): boolean { return mark !== 0; }\n`,
  "src/mark-holder.ts": `import { Mark } from "./marks";\nexport function star(): Mark { return Mark.Star; }\nexport { Mark };\n`,
};
const heldCaller = (library: string, typed: string) => `import { bold, Flag } from "${library}/flag-holder${typed}";
import { isSet } from "${library}/flag-reader${typed}";
import { Mark, star } from "${library}/mark-holder${typed}";
import { isMarked } from "${library}/mark-reader${typed}";
const set: boolean = isSet(bold()) || isSet(Flag.None) || isMarked(star()) || isMarked(Mark.None);
isSet(7);
`;
const moved: Record<string, string> = {
  "tsconfig.json": checked["tsconfig.json"].replace(
    '"strict"',
    '"jsx":"preserve","useDefineForClassFields":false,"strict"',
  ),
  "package.json": JSON.stringify({
    name: "moved",
    compilerOptions: { ...compilerOptions, jsx: "preserve", useDefineForClassFields: false },
  }),
  "src/state.ts": `export function useState<T>(initial: T): [T] { return [initial]; }\n`,
  "src/index.tsx": `import { useState } from "./state";
export enum Unit { Px = "px", Em = "em" }
export function useBoth(first: number = 1, unit = Unit.Px): [number, Unit] {
  const [value] = useState(first);
  return [value, unit];
}
export class Box {
  readonly #unit = Unit.Px;
  get unit(): Unit.Px { return this.#unit; }
}
`,
};
const movedCaller = (library: string) => `import { Box, Unit, useBoth } from "${library}";
const both: [number, Unit] = useBoth(1, Unit.Em);
const px: Unit.Px = new Box().unit;
useBoth(1, "x");
const wrong: Unit.Em = new Box().unit;
`;
// `twins`: a typed file exports the twin of an enum that another typed file imports, and no other: not that of `Own`.
const twin = (name: string) => `export type { ${name} as __enum_${name} };`;
const fixtures = [
  {
    title: "entry points that share an enum",
    files: {
      ...shared,
      "callers/of-the-sources.ts": sharedCaller("../src", ""),
      "callers/of-the-typed-files.ts": sharedCaller("../out", ".aot"),
    },
    args: ["./src/index.ts", "./src/other.ts"],
    errors: ["(6,33): TS2322"],
    twins: [twin("State")],
  },
  {
    title: "entry points that share an enum, --splitting",
    files: {
      ...shared,
      "callers/of-the-sources.ts": sharedCaller("../src", ""),
      "callers/of-the-typed-files.ts": sharedCaller("../out", ".aot"),
    },
    args: ["./src/index.ts", "./src/other.ts", "--splitting"],
    errors: ["(6,33): TS2322"],
    twins: [twin("State")],
  },
  {
    title: "entry points of which one holds the object of a const enum",
    files: {
      ...held,
      "callers/of-the-sources.ts": heldCaller("../src", ""),
      "callers/of-the-typed-files.ts": heldCaller("../out", ".aot"),
    },
    args: ["flag-reader", "flag-holder", "mark-holder", "mark-reader"].map(name => `./src/${name}.ts`),
    errors: ["(6,7): TS2345"],
    twins: [twin("Flag"), twin("Mark")],
  },
  {
    title: "--react-compiler and useDefineForClassFields: false",
    files: {
      ...moved,
      "callers/of-the-sources.ts": movedCaller("../src/index"),
      "callers/of-the-typed-files.ts": movedCaller("../out/index.aot"),
    },
    args: ["./src/index.tsx", "--react-compiler", "--target=bun"],
    errors: ["(4,12): TS2345", "(5,7): TS2322"],
    twins: [],
  },
];

describe.concurrent("bun build --dts", () => {
  test.each(fixtures)("$title: the .aot.ts files judge a caller as the sources do", async row => {
    const { files, args, errors, twins } = row;
    using dir = tempDir("build-dts-enum", files);
    const built = await bun(String(dir), "build", ...args, "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect((await checkedIn(String(dir))).errors).toEqual({
      "callers/of-the-sources.ts": errors,
      "callers/of-the-typed-files.ts": errors,
    });
    const typed = readdirSync(join(String(dir), "out")).filter(name => name.endsWith(".aot.ts"));
    const exported = typed.flatMap(name => {
      const text = readFileSync(join(String(dir), "out", name), "utf8");
      return text.match(/^export type \{ \w+ as __enum_\w+ \};$/gm) ?? [];
    });
    expect(exported.map(line => line.replace(/\d+/g, "")).sort()).toEqual(twins);
  });

  // `index.ts` is the one entry point, so each twin is written for it alone.
  const one = {
    ...checked,
    "src/kind.ts": `export enum Kind { Circle = "circle", Square = "square", "no-shape" = "none" }\n`,
    "src/index.ts": `import { Kind } from "./kind";
const enum Hidden { X = 1, Y = 2 }
export class Shape {
  kind: Kind = Kind.Circle;
}
export const square = Kind.Square as const;
export const none = Kind["no-shape"] as const;
export const hidden = [Hidden.X];
export { Kind };
`,
  };

  test("index.aot.ts casts the constant of an enum member to the type of the member", async () => {
    using dir = tempDir("build-dts-enum-casts", one);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const written = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(written).toContain(`type Kind2_Circle = (typeof Kind2)["Circle"];\n`);
    expect(written).toContain(`  kind: Kind2 = ("circle" as Kind2_Circle)! /* Circle */;\n`);
    expect(written).toContain(`const square = "square" as Kind2.Square /* Square */;\n`);
    expect(written).toContain(`const none = "none" as Extract<Kind2, (typeof Kind2)["no-shape"]> /* no-shape */;\n`);
    expect(written).toContain(`declare const enum Hidden { X = 1, Y = 2 }\n`);
    expect(written).toContain(`const hidden = [(1 as Hidden_X)! /* X */];\n`);
  });

  // The typed file finds the constant by its place in the source map. A build without `--dts` notes no such place.
  test("only the map of a build with --dts has a place for the constant of another file's enum member", async () => {
    using dir = tempDir("build-dts-enum-map", one);
    const build = ["build", "./src/index.ts", "--sourcemap=external", "--outdir"];
    const typed = await bun(String(dir), ...build, "typed", "--dts");
    const plain = await bun(String(dir), ...build, "plain");
    expect([typed.stderr, plain.stderr]).toEqual(["", ""]);
    const read = (name: string) => readFileSync(join(String(dir), name), "utf8");
    const at = (text: string, token: string) => {
      const lines = text.split("\n");
      const line = lines.findIndex(line => line.includes(token));
      return { line: line + 1, column: lines[line].indexOf(token) };
    };
    const placesOfTheConstant = async (outdir: string) => {
      const constant = at(read(`${outdir}/index.js`), `"circle" /* Circle */`);
      const places: { line: number; column: number }[] = [];
      await SourceMapConsumer.with(JSON.parse(read(`${outdir}/index.js.map`)), null, consumer => {
        consumer.eachMapping(place => {
          if (place.generatedLine === constant.line && place.generatedColumn === constant.column)
            places.push({ line: place.originalLine, column: place.originalColumn });
        });
      });
      return places;
    };
    expect({ typed: await placesOfTheConstant("typed"), plain: await placesOfTheConstant("plain") }).toEqual({
      typed: [at(one["src/index.ts"], "Kind.Circle")],
      plain: [],
    });
  });

  // Under `--dts` the parser folds no arithmetic on an enum member. What `index.js` does must stay the same.
  test.each([[["--minify-syntax"]], [["--dts", "--minify-syntax"]], [["--dts"]]])(
    "index.js of a build with %j computes what the sources do",
    async flags => {
      using dir = tempDir("build-dts-enum-run", {
        ...checked,
        "src/index.ts": `export enum Num { Neg = -2, Two = 2 }\nexport const pow = Num.Neg ** Num.Two;\n`,
        "run.mjs": `console.log((await import("./out/index.js")).pow);\n`,
      });
      const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(await bun(String(dir), "run.mjs")).toEqual({ stdout: "4\n", stderr: "", exitCode: 0 });
    },
  );

  test("a byte that is not UTF-8 behind the last enum: index.aot.ts is written", async () => {
    const source = `export enum Unit { Px = "px" }\nexport const units = [Unit.Px];\n// caf\xE9\n`;
    using dir = tempDir("build-dts-latin", { ...checked, "src/index.ts": Buffer.from(source, "latin1") });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      `const units = [("px" as Unit2_Px)! /* Px */];\n`,
    );
  });

  // Each of these has no right `.aot.ts` file yet. The build says so. It writes no wrong one.
  test.each([
    [
      "an enum in a namespace",
      {
        "src/index.ts": `export namespace Shapes {
  export enum Kind { Circle = "circle", Square = "square" }
  export function area(kind: Kind, size: number): number { return kind === Kind.Circle ? 3 * size * size : size * size; }
}
`,
      },
      /^warn: the \.aot\.ts files that --aot compiles a package from are left out: they have type errors, the first at index\.aot\.ts:\d+:\d+: TS2749: /,
    ],
    [
      "the object of an enum of a TypeScript file of another package",
      {
        "node_modules/levels/package.json": JSON.stringify({ name: "levels", version: "1.0.0", main: "index.ts" }),
        "node_modules/levels/index.ts": `export enum Level { Low = 1, High = 2 }\n`,
        "src/index.ts": `import { Level } from "levels";\nexport const levels = [Level.Low];\nexport { Level };\n`,
      },
      /^warn: the \.aot\.ts files that --aot compiles a package from are left out: index\.js: .*levels\/index\.ts declares the enum Level, and the type check of the build does not cover that file\n$/,
    ],
  ])("%s: the .aot.ts files are left out, with the reason", async (_, files, reason) => {
    using dir = tempDir("build-dts-left-out", { ...checked, ...files });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.stderr.replaceAll("\\", "/")).toMatch(reason);
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js"]);
    expect(built.exitCode).toBe(0);
  });

  // The facts of the type checker are places in the text that it read. A plugin can give the bundle another text.
  test("a plugin changes the text of a file that declares an enum: the .aot.ts files are left out", async () => {
    using dir = tempDir("build-dts-plugin", {
      ...checked,
      "src/index.ts": `export enum Unit { Px = "px" }\nexport const units = [Unit.Px];\n`,
    });
    const built = await Bun.build({
      entrypoints: [join(String(dir), "src/index.ts")],
      outdir: join(String(dir), "out"),
      tsconfig: join(String(dir), "tsconfig.json"),
      dts: true,
      plugins: [
        {
          name: "other text",
          setup(build) {
            build.onLoad({ filter: /index\.ts$/ }, async ({ path }) => ({
              contents: "// other\n" + (await Bun.file(path).text()),
              loader: "ts",
            }));
          },
        },
      ],
    });
    expect(built.logs.map(log => String(log.message).replaceAll("\\", "/"))).toEqual([
      expect.stringMatching(
        /src\/index\.ts declares the enum Unit, and the bundle has another text of that file than the type check read$/,
      ),
    ]);
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js"]);
  });

  test("thirty entry points that read one enum of another file", async () => {
    const entries = Array.from({ length: 30 }, (_, index) => `entry${index}`);
    const caller = (library: string, typed: string) =>
      entries.map((name, index) => `import { held as held${index} } from "${library}/${name}${typed}";\n`).join("") +
      entries.map((_, index) => `held${index}.push(2);\n`).join("") +
      `held29.push(99);\n`;
    using dir = tempDir("build-dts-thirty", {
      ...checked,
      "src/level.ts": `export enum Level { Low = 1, High = 2 }\n`,
      ...Object.fromEntries(
        entries.map((name, index) => [
          `src/${name}.ts`,
          `import { Level } from "./level";\nenum Own { A = ${index}, B }\nexport const held = [Level.High, Own.B];\n`,
        ]),
      ),
      "callers/of-the-sources.ts": caller("../src", ""),
      "callers/of-the-typed-files.ts": caller("../out", ".aot"),
    });
    const paths = entries.map(name => `./src/${name}.ts`);
    const built = await bun(String(dir), "build", ...paths, "--root", "src", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect((await checkedIn(String(dir))).errors).toEqual({
      "callers/of-the-sources.ts": ["(61,13): TS2345"],
      "callers/of-the-typed-files.ts": ["(61,13): TS2345"],
    });
  });

  // No build is part of this: it says what the type checker makes of each spelling that the casts are written in.
  // `Unit2_Px` is the type of the twin's own property, which is the type that a read of the member has. `!` changes
  // no type: without it the cast is the whole expression, and then TypeScript widens nothing.
  test("the type checker widens the cast of a constant where it widens a read of the member", async () => {
    using dir = tempDir("build-dts-cast", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, types: [] } }),
      "cast.ts": `declare enum Unit2 { Px = "px", Em = "em" }
type Unit2_Px = (typeof Unit2)["Px"];
const list = [("px" as Unit2_Px)!];
list.push(Unit2.Em);
let held = ("px" as Unit2_Px)!;
held = Unit2.Em;
const fixed = ("px" as Unit2_Px)!;
const px: Unit2.Px = fixed;
const em: Unit2.Em = fixed;
const whole = ["px" as Unit2_Px];
whole.push(Unit2.Em);
const written = [("px" as Unit2.Px)!];
written.push(Unit2.Em);
export { em, held, list, px, whole, written };
`,
    });
    expect((await checkedIn(String(dir))).errors).toEqual({
      "cast.ts": ["(9,7): TS2322", "(11,12): TS2345", "(13,14): TS2345"],
    });
  });
});
