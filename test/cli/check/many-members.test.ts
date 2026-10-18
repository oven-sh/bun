import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, spawn } from "../children";
import { env, linesOf, tsc } from "./differential";

afterAll(endChildren);

// `bun check` keeps lists with an entry for each name: of the members of a class, an interface or a type literal, of
// the computed names of whatever has them, of the accessors and the private names of a class, of the properties of two
// base interfaces, and of the properties of an object literal. A list is searched entry by entry while it is shorter
// than 32 names, and the names after those are found through a map. So each program here is checked with sizes on
// both sides of that, and the size must not change what is reported. And one declaration with many names must not
// take time that grows with the square of their count.
//
// On one thread and one after the other: a debug build takes seconds to start more threads, and more when several start
// at once.

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

/** `text(0)`, `text(1)` .. up to `count` of them. */
const each = (count: number, text: (i: number) => string, separator = " ") =>
  Array.from({ length: count }, (_, i) => text(i)).join(separator);

// `errors`: what TypeScript 7.0.2 reports about `program(count)`, for every `count` in `sizes`, after the name of the file.
const cases: Record<string, { program: (count: number) => string; errors: string }> = {
  // `first` is the first name and `late` comes after `count` others. A class that declares `prototype` twice has two
  // symbols for it, and the second is the one that counts.
  "overloads, accessors and duplicates of a name that other names come between": {
    program: count => `
declare class P {
  static first(x: number): 1;
  ${each(count, i => `static s${i}: 0;`)}
  static late(x: number): 1;
  static first(x: string): 2;
  static late(x: string): 2;
  static prototype(): void;
  protected static get prototype(): 3;
  first(x: number): 1;
  ${each(count, i => `i${i}: 0;`)}
  late(x: number): 1;
  get pair(): 4;
  first(x: string): 2;
  late(x: string): 2;
  set pair(value: 4);
  i0: string;
}
interface I {
  first(x: number): 1;
  ${each(count, i => `i${i}: 0;`)}
  late(x: number): 1;
  get pair(): 4;
  first(x: string): 2;
  late(x: string): 2;
  set pair(value: 4);
  i0: string;
}
declare const p: P;
declare const i: I;
declare const o: {
  first(x: number): 1;
  ${each(count, i => `i${i}: 0;`)}
  late(x: number): 1;
  get pair(): 4;
  first(x: string): 2;
  late(x: string): 2;
  set pair(value: 4);
  i0: string;
};
const a: never = [P.s0, P.s${count - 1}, P.first(0), P.first(""), P.late(0), P.late("")];
const b: never = P.prototype;
const c: never = [p.i0, p.i${count - 1}, p.first(0), p.first(""), p.late(0), p.late(""), p.pair];
const d: never = [i.i0, i.i${count - 1}, i.first(0), i.first(""), i.late(0), i.late(""), i.pair];
const e: never = [o.i0, o.i${count - 1}, o.first(0), o.first(""), o.late(0), o.late(""), o.pair];
export {};
`,
    errors: `
(8,10): error TS2300: Duplicate identifier 'prototype'.
(11,3): error TS2300: Duplicate identifier 'i0'.
(17,3): error TS2300: Duplicate identifier 'i0'.
(17,3): error TS2717: Subsequent property declarations must have the same type.  Property 'i0' must be of type '0', but here has type 'string'.
(21,3): error TS2300: Duplicate identifier 'i0'.
(27,3): error TS2300: Duplicate identifier 'i0'.
(27,3): error TS2717: Subsequent property declarations must have the same type.  Property 'i0' must be of type '0', but here has type 'string'.
(33,3): error TS2300: Duplicate identifier 'i0'.
(39,3): error TS2300: Duplicate identifier 'i0'.
(39,3): error TS2717: Subsequent property declarations must have the same type.  Property 'i0' must be of type '0', but here has type 'string'.
(41,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(42,7): error TS2322: Type '3' is not assignable to type 'never'.
(42,20): error TS2445: Property 'prototype' is protected and only accessible within class 'P' and its subclasses.
(43,7): error TS2322: Type '(0 | 1 | 2 | 4)[]' is not assignable to type 'never'.
(44,7): error TS2322: Type '(0 | 1 | 2 | 4)[]' is not assignable to type 'never'.
(45,7): error TS2322: Type '(0 | 1 | 2 | 4)[]' is not assignable to type 'never'.
`,
  },
  // The same with computed names, in everything that has them: the two sides of a class, an interface, a type literal,
  // an object literal and a function that is assigned to.
  "computed names that are declared again after others": {
    program: count => `
${each(count + 3, i => `declare const k${i}: "n${i}";`)}
declare const first: unique symbol;
declare const late: "late";
declare const pair: "pair";
declare class P {
  static [first](x: number): 1;
  ${each(count, i => `static [k${i}]: 0;`)}
  static [late](x: number): 1;
  static [first](x: string): 2;
  static [late](x: string): 2;
  static [k0]: string;
  [first](x: number): 1;
  ${each(count, i => `[k${i}]: 0;`)}
  [late](x: number): 1;
  [first](x: string): 2;
  [late](x: string): 2;
  [k0]: string;
}
interface I {
  [first](x: number): 1;
  ${each(count, i => `[k${i}]: 0;`)}
  [late](x: number): 1;
  [first](x: string): 2;
  [late](x: string): 2;
  [k0]: string;
}
declare const p: P;
declare const i: I;
declare const o: {
  [first](x: number): 1;
  ${each(count, i => `[k${i}]: 0;`)}
  [late](x: number): 1;
  [first](x: string): 2;
  [late](x: string): 2;
  [k0]: string;
};
const literal = {
  [first]: 1 as const,
  ${each(count, i => `[k${i}]: 0 as const,`)}
  [late]: 1 as const,
  get [pair]() { return 4 as const; },
  [first]: 2 as const,
  [late]: 2 as const,
  set [pair](value: 4) {},
  get [pair]() { return 5 as const; },
};
function f() {}
f[first] = 1 as const;
${each(count, i => `f[k${i}] = 0 as const;`)}
f[late] = 1 as const;
f[first] = 2 as const;
f[late] = 2 as const;
const a: never = [P.n0, P.n${count - 1}, P[first](0), P[first](""), P.late(0), P.late("")];
const c: never = [p.n0, p.n${count - 1}, p[first](0), p[first](""), p.late(0), p.late("")];
const d: never = [i.n0, i.n${count - 1}, i[first](0), i[first](""), i.late(0), i.late("")];
const e: never = [o.n0, o.n${count - 1}, o[first](0), o[first](""), o.late(0), o.late("")];
const g: never = [literal.n0, literal.n${count - 1}, literal[first], literal.late, literal.pair];
const h: never = [f.n0, f.n${count - 1}, f[first], f.late];
export {};
`,
    errors: `
(8,10): error TS2300: Duplicate identifier '[k0]'.
(12,10): error TS2300: Duplicate identifier '[k0]'.
(12,10): error TS2717: Subsequent property declarations must have the same type.  Property '[k0]' must be of type '0', but here has type 'string'.
(14,3): error TS2300: Duplicate identifier '[k0]'.
(18,3): error TS2300: Duplicate identifier '[k0]'.
(18,3): error TS2717: Subsequent property declarations must have the same type.  Property '[k0]' must be of type '0', but here has type 'string'.
(22,3): error TS2300: Duplicate identifier '[k0]'.
(26,3): error TS2300: Duplicate identifier '[k0]'.
(26,3): error TS2717: Subsequent property declarations must have the same type.  Property '[k0]' must be of type '0', but here has type 'string'.
(32,3): error TS2300: Duplicate identifier '[k0]'.
(36,3): error TS2300: Duplicate identifier '[k0]'.
(36,3): error TS2717: Subsequent property declarations must have the same type.  Property '[k0]' must be of type '0', but here has type 'string'.
(42,7): error TS2300: Duplicate identifier 'pair'.
(43,3): error TS1117: An object literal cannot have multiple properties with the same name.
(44,3): error TS1117: An object literal cannot have multiple properties with the same name.
(45,7): error TS2300: Duplicate identifier 'pair'.
(46,7): error TS1118: An object literal cannot have multiple get/set accessors with the same name.
(46,7): error TS2300: Duplicate identifier 'pair'.
(54,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(55,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(56,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(57,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(58,7): error TS2322: Type '(0 | 2 | 5)[]' is not assignable to type 'never'.
(59,7): error TS2322: Type '(0 | 2)[]' is not assignable to type 'never'.
`,
  },
  // A getter and its setter are one property, and another declaration of the name is a duplicate. So is a private name
  // that a static member and an instance member have.
  "accessors and private names that are declared again after others": {
    program: count => `
declare class P {
  ${each(count, i => `get a${i}(): 0; set a${i}(value: 0);`)}
  get late(): 1;
  static get late(): 2;
  twice: 3;
  static twice: 4;
  ${each(count, i => `static get s${i}(): 0; static set s${i}(value: 0);`)}
  set late(value: 1);
  static set late(value: 2);
  twice: 3;
  get a0(): 0;
  late: 1;
  #first: 0;
  ${each(count, i => `#p${i}: 0;`)}
  static #before: 0;
  #late: 1;
  static #first: 0;
  static #late: 1;
  static #only: 2;
}
interface I {
  ${each(count, i => `get a${i}(): 0; set a${i}(value: 0);`)}
  get late(): 1;
  twice: 3;
  set late(value: 1);
  twice: 3;
  late: 1;
}
declare const p: P;
declare const i: I;
const a: never = [p.a0, p.a${count - 1}, p.late, p.twice, P.s0, P.s${count - 1}, P.late, P.twice];
const b: never = [i.a0, i.a${count - 1}, i.late, i.twice];
export {};
`,
    errors: `
(3,7): error TS2300: Duplicate identifier 'a0'.
(3,20): error TS2300: Duplicate identifier 'a0'.
(4,7): error TS2300: Duplicate identifier 'late'.
(6,3): error TS2300: Duplicate identifier 'twice'.
(9,7): error TS2300: Duplicate identifier 'late'.
(11,3): error TS2300: Duplicate identifier 'twice'.
(12,7): error TS2300: Duplicate identifier 'a0'.
(13,3): error TS2300: Duplicate identifier 'late'.
(14,3): error TS2804: Duplicate identifier '#first'. Static and instance elements cannot share the same private name.
(17,3): error TS2804: Duplicate identifier '#late'. Static and instance elements cannot share the same private name.
(18,10): error TS2804: Duplicate identifier '#first'. Static and instance elements cannot share the same private name.
(19,10): error TS2804: Duplicate identifier '#late'. Static and instance elements cannot share the same private name.
(24,7): error TS2300: Duplicate identifier 'late'.
(25,3): error TS2300: Duplicate identifier 'twice'.
(26,7): error TS2300: Duplicate identifier 'late'.
(27,3): error TS2300: Duplicate identifier 'twice'.
(28,3): error TS2300: Duplicate identifier 'late'.
(32,7): error TS2322: Type '(0 | 1 | 2 | 3 | 4)[]' is not assignable to type 'never'.
(33,7): error TS2322: Type '(0 | 1 | 3)[]' is not assignable to type 'never'.
`,
  },
  // Two bases must agree on a property, unless the interface declares it itself, as `C` and `F` do `c0`, `c1` ..
  "properties that two base interfaces declare, after others": {
    program: count => `
interface A { first: 1; ${each(count, i => `a${i}: 0;`)} ${each(count, i => `c${i}: 1;`)} late: 1; same: 2; mine: 3; }
interface B { first: "b"; ${each(count, i => `b${i}: 0;`)} ${each(count, i => `c${i}: 2;`)} late: "b"; same: 2; mine: "b"; }
interface D { ${each(count, i => `d${i}: 0;`)} late: 1; same: 2; b0: "d"; }
interface C extends A, B { ${each(count, i => `c${i}: never;`)} mine: never; }
interface E extends A, D { ${each(count, i => `d${i}: 0;`)} }
interface F extends D, B, A { ${each(count, i => `c${i}: never;`)} first: never; }
declare const c: C;
declare const e: E;
declare const f: F;
const x: never = [c.a0, c.b${count - 1}, c.c${count - 1}, c.first, c.late, c.same, c.mine];
const y: never = [e.a0, e.d${count - 1}, e.late, e.same, e.b0];
const z: never = [f.a0, f.b${count - 1}, f.d${count - 1}, f.first, f.late, f.same, f.mine, f.b0];
export {};
`,
    errors: `
(5,11): error TS2320: Interface 'C' cannot simultaneously extend types 'A' and 'B'.
  Named property 'first' of types 'A' and 'B' are not identical.
(5,11): error TS2320: Interface 'C' cannot simultaneously extend types 'A' and 'B'.
  Named property 'late' of types 'A' and 'B' are not identical.
(7,11): error TS2320: Interface 'F' cannot simultaneously extend types 'B' and 'A'.
  Named property 'mine' of types 'B' and 'A' are not identical.
(7,11): error TS2320: Interface 'F' cannot simultaneously extend types 'D' and 'B'.
  Named property 'b0' of types 'D' and 'B' are not identical.
(7,11): error TS2320: Interface 'F' cannot simultaneously extend types 'D' and 'B'.
  Named property 'late' of types 'D' and 'B' are not identical.
(11,7): error TS2322: Type '(0 | 1 | 2)[]' is not assignable to type 'never'.
(12,7): error TS2322: Type '("d" | 0 | 1 | 2)[]' is not assignable to type 'never'.
(13,7): error TS2322: Type '("b" | "d" | 0 | 1 | 2)[]' is not assignable to type 'never'.
`,
  },
  // An object literal whose names are all written down: they are compared because one is there twice.
  "properties of an object literal that are written again after others": {
    program: count => `
const literal = {
  first: 1 as const,
  ${each(count, i => `k${i}: 0 as const,`)}
  late: 1 as const,
  get pair() { return 4 as const; },
  method() { return 6 as const; },
  first: 2 as const,
  late: 2 as const,
  set pair(value: 4) {},
  method() { return 7 as const; },
  get late() { return 5 as const; },
};
const g: never = [literal.k0, literal.k${count - 1}, literal.first, literal.late, literal.pair, literal.method()];
export {};
`,
    errors: `
(7,3): error TS2300: Duplicate identifier 'method'.
(8,3): error TS1117: An object literal cannot have multiple properties with the same name.
(9,3): error TS1117: An object literal cannot have multiple properties with the same name.
(11,3): error TS2300: Duplicate identifier 'method'.
(12,7): error TS1119: An object literal cannot have property and accessor with the same name.
(14,7): error TS2322: Type '(0 | 2 | 4 | 5 | 7)[]' is not assignable to type 'never'.
`,
  },
};

// With 29 to 33 other names, `late` is on either side of the 32nd place of its list, in every program.
const sizes = [2, 29, 30, 31, 32, 33, 100];

/** What `cmd` reports about the programs of `titles`, for each of them and each size: the lines after the name of the file. */
async function reported(cmd: string[], titles: string[]) {
  const programs = titles.flatMap(title => sizes.map(size => [`${title} ${size}`, cases[title].program(size)]));
  using dir = tempDir("bun-check-members", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(programs.map(([, program], n) => [`program${n}.ts`, program])),
  });
  const lines: Record<string, string[]> = Object.fromEntries(programs.map(([name]) => [name, []]));
  let name = "";
  for (const line of await linesOf(cmd, String(dir), String(dir))) {
    // The lines that explain an error come after it, indented.
    const error = /^program(\d+)\.ts(\(.*)$/.exec(line);
    if (error) name = programs[Number(error[1])][0];
    lines[name].push(error ? error[2] : line);
  }
  return lines;
}

/** The same errors for every size. */
const expected = (titles: string[]) =>
  Object.fromEntries(
    titles.flatMap(title => sizes.map(size => [`${title} ${size}`, cases[title].errors.trim().split("\n")])),
  );

// A debug build that is not in memory takes longer to start than the 5 seconds that a test has without `--timeout`. No
// build on CI is a debug build, so this shortens no limit there.
const slow = isDebug ? 20_000 : undefined;

test.each(Object.keys(cases))(
  "%s",
  async title => {
    expect(await reported([bunExe(), "check", "--threads", "1"], [title])).toEqual(expected([title]));
  },
  slow,
);

test.skipIf(!tsc)(
  "TypeScript reports the same about these programs",
  async () => {
    const titles = Object.keys(cases);
    expect(await reported([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], titles)).toEqual(
      expected(titles),
    );
  },
  slow,
);

// One declaration, or one object literal, with many names. Each of these lists was searched entry by entry for every
// name, which took the seconds beside it in a release build. The clock says nothing on a busy machine, so the limit is on
// the time of the processor.
const probe = `export const probe: never = 0;\n`;
// `count` lines with a name each, none twice: a hundred lines with `@` in their names, for every number in place of the
// `@`. A debug build of JavaScriptCore makes them many times faster than one by one.
const numbered = (count: number, line: (i: number) => string) => {
  const parts = each(100, line, "").split("@");
  return each(count / 100, i => parts.join(String(i)), "");
};
const large: [string, number, number, (count: number) => string][] = [
  // 3.3 seconds, and now 0.1.
  [
    "the members of an interface",
    128_000,
    1,
    count => `interface I {\n${numbered(count, i => `  k@_${i}: number;\n`)}}\ndeclare const o: I;\no.k0_0;\n`,
  ],
  // 6.3 seconds, and now 0.6.
  [
    "the computed names of an interface",
    128_000,
    2.5,
    count =>
      numbered(count, i => `declare const k@_${i}: "p@_${i}";\n`) +
      `interface I {\n${numbered(count, i => `  [k@_${i}]: number;\n`)}}\ndeclare const o: I;\no.p0_0;\n`,
  ],
  // 2.8 seconds, and now 0.2.
  [
    "the accessors of a class",
    64_000,
    1,
    count =>
      `declare class C {\n${numbered(count, i => `  get a@_${i}(): number;\n  set a@_${i}(value: number);\n`)}}\n` +
      `declare const o: C;\no.a0_0;\n`,
  ],
  // 5.8 seconds, and now 0.2.
  [
    "the private names of a class",
    128_000,
    1.5,
    count => `declare class C {\n${numbered(count, i => `  #p@_${i}: number;\n`)}}\ndeclare const o: C;\no;\n`,
  ],
  // 4.4 seconds, and now 0.2.
  [
    "the properties of two base interfaces",
    64_000,
    1.5,
    count =>
      `interface A {\n${numbered(count, i => `  a@_${i}: number;\n`)}}\n` +
      `interface B {\n${numbered(count, i => `  b@_${i}: number;\n`)}}\n` +
      `interface C extends A, B {}\ndeclare const o: C;\no.a0_0;\n`,
  ],
  // 2.6 seconds, and now 0.2.
  [
    "the properties of an object literal with a computed name",
    128_000,
    1,
    count =>
      `declare const z: "z";\nconst o = {\n  [z]: 0,\n${numbered(count, i => `  k@_${i}: ${i},\n`)}};\no.k0_0;\n`,
  ],
];
// A debug build is some fifty times slower. It has the first of them, with fewer members: 7.5 seconds, and now 1.7.
test.each(isDebug ? large.slice(0, 1) : large)(
  "%s do not take quadratic time",
  async (_, most, seconds, program) => {
    const [count, limit] = isDebug ? [32_000, 4] : [most, isASAN ? seconds * 10 : seconds];
    using dir = tempDir("bun-check-members", { "tsconfig.json": tsconfig, "a.ts": program(count) + probe });
    await using proc = spawn({
      cmd: [bunExe(), "check", "--threads", "1"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A crash, an assertion or a sanitizer report: the exit code alone says nothing about why.
    if (exitCode !== 1) console.error(`bun check exited with ${exitCode}:\n${stderr}`);
    expect({ errors: stdout.trim().replace(/^a\.ts\(\d+,/, "("), exitCode }).toEqual({
      errors: "(14): error TS2322: Type '0' is not assignable to type 'never'.",
      exitCode: 1,
    });
    expect(Number(proc.resourceUsage()!.cpuTime.user) / 1e6).toBeLessThan(limit);
  },
  slow,
);
