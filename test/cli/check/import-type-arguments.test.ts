// What `bun check` prints about the type arguments of an `import()` type, with what `tsc` 7.1 prints for the same
// programs. `differential.test.ts` has cross products of these, and there `tsc` itself is the oracle.
//
// `checkImportType` checks the argument of an import type and none of its type arguments. A type argument is resolved
// with the import type. What is below it, such as the type of a member of a type literal or of a parameter of a
// function type, is resolved when something asks for it. Only then is an error in it reported, and a name in it used.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";
import { linesOf, tsc, env as withoutAgents } from "./differential";

afterAll(endChildren);

const env = {
  ...withoutAgents,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_SCRIPTS_OF_COMMANDS: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
};

// A debug build reads and checks the library in seconds: the smallest one, and unchecked.
const compilerOptions = {
  strict: true,
  noEmit: true,
  types: [],
  lib: ["es5"],
  skipLibCheck: true,
  module: "esnext",
  moduleResolution: "bundler",
};
const box = `export interface Box<T> { value: T }
export type Alias<T> = { value: T };
export type NotGeneric = string;
export declare function f<T>(x: T): T;
`;

/**
 * `order`: the files in the order in which `tsc --singleThreaded` checks them, if it isn't that of their names.
 * `errors`: what `bun check` and `tsc` 7.1 print.
 */
type Program = {
  options?: object;
  order?: string[];
  files: Record<string, string>;
  errors: string[];
};
const programs: Record<string, Program> = {
  "reports nothing below type arguments that nothing reads": {
    files: {
      "use.ts": `type Member = import("./box").Box<{ a: MissingA; m(x: MissingB): MissingC; [k: string]: MissingD }>;
type Signature = import("./box").Box<(x: MissingE, ...rest: MissingF[]) => MissingG>;
type Nested = import("./box").Box<{ a: import("./box").NotGeneric<string>; b: import("./nope").T }[]>;
type Mapped = import("./box").Alias<Array<{ [K in "a"]: MissingH }>>;
type Constraint = import("./box").Box<<U extends MissingI>(x: U) => void>;
type Circular = import("./box").Box<<U extends U>(x: U) => void>;
type Implicit = import("./box").Box<{ a; m(x, ...rest): void }>;
type Query = import("./box").Box<{ a: typeof missingJ; b: typeof import("./box").f<MissingK> }>;
type Indexes = import("./box").Box<{ [k: string]: string; [l: string]: number }>;
type Mode = import("./box").Box<{ a: import("./box", { with: { "resolution-mode": "bogus" } }).NotGeneric }>;
export declare const all: [Member, Signature, Nested, Mapped, Constraint, Circular, Implicit, Query, Indexes, Mode];
`,
    },
    errors: [],
  },
  "reports what an import type resolves with its type arguments": {
    files: {
      "use.ts": `type Argument = import("./box").Box<MissingA>;
type Element = import("./box").Box<MissingB[]>;
type Tuple = import("./box").Box<[MissingC]>;
type Union = import("./box").Box<MissingD | string>;
type Reference = import("./box").Box<Array<MissingE>>;
type Key = import("./box").Box<{ [K in MissingF]: string }>;
type Query = import("./box").Box<typeof missingG>;
type Module = import("./box").Box<import("./nope").T>;
type Count = import("./box").Box<import("./box").NotGeneric<string>>;
export declare const all: [Argument, Element, Tuple, Union, Reference, Key, Query, Module, Count];
`,
    },
    errors: [
      "use.ts(1,37): error TS2304: Cannot find name 'MissingA'.",
      "use.ts(2,36): error TS2304: Cannot find name 'MissingB'.",
      "use.ts(3,35): error TS2304: Cannot find name 'MissingC'.",
      "use.ts(4,34): error TS2304: Cannot find name 'MissingD'.",
      "use.ts(5,44): error TS2304: Cannot find name 'MissingE'.",
      "use.ts(6,40): error TS2304: Cannot find name 'MissingF'.",
      "use.ts(7,41): error TS2304: Cannot find name 'missingG'.",
      "use.ts(8,42): error TS2307: Cannot find module './nope' or its corresponding type declarations.",
      "use.ts(9,34): error TS2315: Type 'NotGeneric' is not generic.",
    ],
  },
  "reports an error below type arguments once something reads the member": {
    files: {
      "use.ts": `declare const member: import("./box").Box<{ read: MissingA; unread: MissingB }>;
export const read = member.value.read;
declare const signature: import("./box").Box<{ call(x: MissingC): MissingD; never(x: MissingE): void }>;
export const result = signature.value.call(null as never);
declare const implicit: import("./box").Box<(x, y: typeof missingF) => void>;
implicit.value(1, 2);
declare const constraint: import("./box").Box<{ read: <U extends U>() => void; unread: <V extends V>() => void }>;
constraint.value.read();
type Source = import("./box").Box<{ a: string }>;
type Target = import("./box").Box<{ a: import("./nope").T }>;
export const compared: Target = null! as Source;
`,
    },
    errors: [
      "use.ts(1,51): error TS2304: Cannot find name 'MissingA'.",
      "use.ts(3,56): error TS2304: Cannot find name 'MissingC'.",
      "use.ts(3,67): error TS2304: Cannot find name 'MissingD'.",
      "use.ts(5,46): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      "use.ts(5,59): error TS2304: Cannot find name 'missingF'.",
      "use.ts(7,66): error TS2313: Type parameter 'U' has a circular constraint.",
      "use.ts(10,47): error TS2307: Cannot find module './nope' or its corresponding type declarations.",
    ],
  },
  "checks the type arguments of a type query when something resolves it": {
    files: {
      "use.ts": `declare function one<T>(x: T): T;
declare function two<T, U>(x: T, y: U): T;
type Direct = import("./box").Box<typeof one<{ a: MissingA }>>;
type Unread = import("./box").Box<{ m: typeof one<{ a: MissingB }> }>;
type Read = import("./box").Box<{ m: typeof one<{ a: MissingC }> }>;
type Arity = import("./box").Box<typeof two<{ a: MissingD }>>;
type Circular = import("./box").Box<typeof one<{ a: <U extends U>() => void }>>;
type Indexes = import("./box").Box<typeof one<{ [k: string]: string; [l: string]: number }>>;
type Implicit = import("./box").Box<typeof one<{ a; m(x): void }>>;
type Nested = import("./box").Box<typeof one<import("./box").Box<{ a: MissingE }>>>;
declare const read: Read;
export const member = read.value.m;
export declare const all: [Direct, Unread, Arity, Circular, Indexes, Implicit, Nested];
`,
    },
    errors: [
      "use.ts(3,51): error TS2304: Cannot find name 'MissingA'.",
      "use.ts(5,54): error TS2304: Cannot find name 'MissingC'.",
      "use.ts(6,45): error TS2635: Type '<T, U>(x: T, y: U) => T' has no signatures for which the type argument list is applicable.",
      "use.ts(6,50): error TS2304: Cannot find name 'MissingD'.",
      "use.ts(7,64): error TS2313: Type parameter 'U' has a circular constraint.",
      "use.ts(8,49): error TS2374: Duplicate index signature for type 'string'.",
      "use.ts(8,70): error TS2374: Duplicate index signature for type 'string'.",
      "use.ts(9,50): error TS7008: Member 'a' implicitly has an 'any' type.",
      "use.ts(9,55): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    ],
  },
  "a name below type arguments is used once something resolves it": {
    options: { noUnusedLocals: true, noUnusedParameters: true },
    files: {
      "other.ts": `export type Other = string;
`,
      "use.ts": `import type { Other } from "./other";
import { type Other as Renamed } from "./other";
import type { Other as Argument } from "./other";
type Unread = string;
type Read = string;
type Lazy = string;
type Predicate = string;
type Direct = string;
export type Member = import("./box").Box<{ local: Unread }>;
export type Signature = import("./box").Box<(x: string) => Other>;
export type Imported = import("./box").Box<{ value: Renamed }>;
export type Resolved = import("./box").Box<Argument | Direct[] | { value: Unread }>;
export type Template = import("./box").Box<Array<{ a: Lazy }>>;
export type Guard = import("./box").Box<{ is: (x: unknown) => x is Predicate }>;
declare const read: import("./box").Box<{ value: Read; other: Unread }>;
export const value = read.value.value;
declare const guard: Guard;
export const is = guard.value.is;
`,
    },
    errors: [
      "use.ts(1,15): error TS6196: 'Other' is declared but never used.",
      "use.ts(2,24): error TS6133: 'Renamed' is declared but its value is never read.",
      "use.ts(4,6): error TS6196: 'Unread' is declared but never used.",
      "use.ts(6,6): error TS6196: 'Lazy' is declared but never used.",
      "use.ts(7,6): error TS6196: 'Predicate' is declared but never used.",
    ],
  },
  "an earlier file that reads reports, a later file does not": {
    order: ["early.ts", "use.ts", "late.ts"],
    files: {
      "early.ts": `const early = a.value.read;
`,
      "use.ts": `declare const a: import("./box").Box<{ read: MissingA }>;
declare const b: import("./box").Box<{ read: MissingB }>;
`,
      "late.ts": `const late = b.value.read;
`,
    },
    errors: ["use.ts(1,46): error TS2304: Cannot find name 'MissingA'."],
  },
  "a name that an earlier file resolves is used, one that a later file resolves is not": {
    options: { noUnusedLocals: true },
    order: ["early.ts", "use.ts", "late.ts"],
    files: {
      "early.ts": `export const early = a.value.read;
`,
      "use.ts": `type Early = number;
type Late = number;
declare global {
  const a: import("./box").Box<{ read: Early }>;
  const b: import("./box").Box<{ read: Late }>;
}
export {};
`,
      "late.ts": `export const late = b.value.read;
`,
    },
    errors: ["use.ts(2,6): error TS6196: 'Late' is declared but never used."],
  },
  "reports nothing below the type arguments of an import type in an expression": {
    files: {
      "use.ts": `declare const anyValue: any;
declare function g<T>(x?: T): T;
export const cast = anyValue as import("./box").Box<{ a: typeof missingA; b: MissingB }>;
export const satisfied = anyValue satisfies import("./box").Box<{ a: typeof missingC }>;
export const called = g<import("./box").Box<{ a: typeof missingD }>>();
export const instantiated = g<import("./box").Box<{ a: typeof missingE }>>;
export const arrow = (x: import("./box").Box<{ a: typeof missingF }>) => x;
`,
    },
    errors: [],
  },
  "with `declaration`, what the declaration file needs is resolved after every check": {
    options: { declaration: true, noUnusedLocals: true },
    order: ["early.ts", "use.ts"],
    files: {
      "early.ts": `export const early = G.a.value;
`,
      "use.ts": `namespace G {
  type Local = string;
  type Emitted = string;
  export declare const a: import("./box").Box<{ read: Local; emitted: MissingA }>;
  export declare const b: import("./box").Box<{ emitted: Emitted }>;
  export const read = a.value.read;
}
`,
    },
    errors: ["use.ts(3,8): error TS6196: 'Emitted' is declared but never used."],
  },
  "does not abort when it checks a binding pattern of another file": {
    options: { noUnusedLocals: true },
    order: ["first.ts", "second.ts", "third.ts"],
    files: {
      "first.ts": `const early = late;
`,
      "second.ts": `declare function f<T>(): T;
const late = f<({ a: b }: { a: string }) => typeof b>();
declare function g<T>(): T;
declare const below: import("./box").Box<{ m: typeof g<({ c: d }: { c: string }) => typeof d> }>;
`,
      "third.ts": `const last = below.value.m;
`,
    },
    errors: [],
  },
  "type arguments of `typeof import()` that fit no signature are not resolved": {
    files: {
      "use.ts": `export type None = typeof import("./box").f<MissingA, string>;
export type Below = typeof import("./box").f<{ a: MissingB }>;
export type Fits = typeof import("./box").f<MissingC>;
`,
    },
    errors: [
      "use.ts(1,45): error TS2635: Type '<T>(x: T) => T' has no signatures for which the type argument list is applicable.",
      "use.ts(3,45): error TS2304: Cannot find name 'MissingC'.",
    ],
  },
  "reports what the first declaration that is checked reports for all of them": {
    options: { noUnusedLocals: true },
    files: {
      "use.ts": `type Used = string;
export type Infer<T> = T extends [import("./box").Box<infer U extends { a: Used }>, infer U extends { a: string }] ? U : never;
export type Differ<T> = T extends [import("./box").Box<infer V extends string>, infer V extends number] ? V : never;
export type Indexes = import("./box").Box<{ a: Merged }>;
interface Merged { [k: string]: string }
interface Merged { [l: string]: number }
`,
    },
    errors: [
      "use.ts(3,62): error TS2838: All declarations of 'V' must have identical constraints.",
      "use.ts(3,87): error TS2838: All declarations of 'V' must have identical constraints.",
      "use.ts(5,11): error TS6196: 'Merged' is declared but never used.",
      "use.ts(5,20): error TS2374: Duplicate index signature for type 'string'.",
      "use.ts(6,11): error TS6196: 'Merged' is declared but never used.",
      "use.ts(6,20): error TS2374: Duplicate index signature for type 'string'.",
    ],
  },
  "reports nothing below the type arguments of an import type in a JSDoc comment": {
    options: { module: "commonjs", allowJs: true, checkJs: true },
    files: {
      "map.js": `/**
 * @template K
 * @template V
 */
class TupleMap {
  /** @param {K} k @param {V} v */
  set(k, v) {}
}
module.exports = TupleMap;
`,
      "use.js": `/** @typedef {import("./map")<string, { a: MissingA }>} Literal */
/** @typedef {import("./map")<string, (x: MissingB) => void>} Signature */
/** @typedef {import("./map")<string, MissingC>} Argument */
/** @type {Literal | Signature | Argument | undefined} */
let cache;
module.exports = { cache };
`,
    },
    errors: ["use.js(3,39): error TS2304: Cannot find name 'MissingC'."],
  },
};

const written = ({ options, order, files }: Program) => ({
  "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, ...options }, files: order }),
  "box.ts": box,
  ...files,
});

/** What `bun check` prints for `program`, by line, and its exit code. */
async function check(program: Program, args: string[] = []) {
  using dir = tempDir("bun-check-import-type", written(program));
  await using proc = spawn({
    cmd: [bunExe(), "check", ...args],
    cwd: String(dir),
    env,
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash, an assertion or a sanitizer report: the test that asserts the exit code says nothing about why.
  if (exitCode !== 0 && exitCode !== 1)
    console.error(`bun check ${args.join(" ")} exited with ${exitCode}:\n${stderr}`);
  return { errors: stdout.split(/\r?\n/).filter(line => line.trim()), exitCode };
}

// A debug build that was just linked is read from the disk by the first process, and starts many processes together
// too slowly for the five seconds that a test has by default. So a hook with the limit of a process starts the first
// one, and the tests start one at a time.
beforeAll(async () => {
  await check({ files: { "a.ts": `export {};\n` }, errors: [] });
}, longLimit);

describe("bun check, below the type arguments of an `import()` type", () => {
  for (const [title, program] of Object.entries(programs)) {
    test(title, async () => {
      const expected = { errors: program.errors, exitCode: program.errors.length ? 1 : 0 };
      // One thread checks the files in the order of the program. More threads start with the largest.
      const [byDefault, onOneThread] = await Promise.all([check(program), check(program, ["--threads=1"])]);
      expect(byDefault).toEqual(expected);
      expect(onOneThread).toEqual(expected);
    });
  }

  // `bun lint --type-check` runs the same check and prints an error as a problem of the rule `typescript/TS<code>`.
  test("`bun lint --type-check` reports the same errors", async () => {
    const program = programs["reports an error below type arguments once something reads the member"];
    using dir = tempDir("bun-check-import-type", written(program));
    await using proc = spawn({
      cmd: [bunExe(), "lint", "--type-check", "-f", "unix"],
      cwd: String(dir),
      env,
      timeout: longLimit,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const problem = /([^\\/]+):(\d+):(\d+): (.+) \[Error\/typescript\/(TS\d+)\]$/;
    const errors = stdout
      .split(/\r?\n/)
      .map(line => problem.exec(line))
      .filter(found => found !== null)
      .map(([, file, line, column, message, code]) => `${file}(${line},${column}): error ${code}: ${message}`);
    expect(errors).toEqual(program.errors);
    expect(exitCode).toBe(1);
  });

  test.skipIf(!tsc)("tsc prints what these tests say it prints", async () => {
    for (const [title, program] of Object.entries(programs)) {
      using dir = tempDir("bun-check-import-type", written(program));
      const root = String(dir);
      const errors = await linesOf([tsc!, "--pretty", "false", "--singleThreaded"], root, root);
      expect({ title, errors }).toEqual({ title, errors: program.errors });
    }
  });
});
