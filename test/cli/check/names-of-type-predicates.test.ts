// A type predicate names a parameter. If the signature is instantiated and the parameter's type changes, that parameter isn't the declared one any more, and TypeScript reports TS9039 twice: for the name
// and for the predicate. The checker lost the one for the name.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const variable = (at: string) =>
  `(${at}): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.`;
const expression = (at: string) =>
  `(${at}): error TS9013: Expression type can't be inferred with --isolatedDeclarations.`;
const inaccessible = (at: string, name: string) =>
  `(${at}): error TS9039: Type containing private name '${name}' can't be used with --isolatedDeclarations.`;
const property = "(1,37): error TS9012: Property must have an explicit type annotation with --isolatedDeclarations.";

// Each program, and the errors that TypeScript reports.
const programs: Record<string, [source: string, errors: string[]]> = {
  "a function": [
    "function g<T>(x: T) { return (o: T | string): o is string => true; }\nexport const v = g(1);",
    [inaccessible("1,47", "o is string"), inaccessible("1,47", "o"), variable("2,14")],
  ],
  "an assertion": [
    "function g<T>(x: T) { return (o: T): asserts o => {}; }\nexport const v = g(1);",
    [inaccessible("1,38", "asserts o"), inaccessible("1,46", "o"), variable("2,14")],
  ],
  "a method of a class": [
    "class C<T> { m(o: T | string): o is string { return true; } }\nexport const v = new C<number>().m;",
    [inaccessible("1,32", "o is string"), inaccessible("1,32", "o"), variable("2,14")],
  ],
  "a method of an interface": [
    "export interface I<T> { m(o: T | string): o is string }\nexport const v = { m: (null! as I<number>).m };",
    [inaccessible("1,43", "o is string"), inaccessible("1,43", "o"), expression("2,23")],
  ],
  "a declared function": [
    "declare function g<T>(x: T): (o: T | string) => o is string;\nexport const v = g(1);",
    [inaccessible("1,49", "o is string"), inaccessible("1,49", "o"), variable("2,14")],
  ],
  "type parameters in a class's member": [
    "export const v = (() => { class L { v = (() => { type B = { x: 1 }; return <T extends B>(n: T, o: B): o is B => true; })(); } return null! as L; })();",
    [
      variable("1,14"),
      property,
      inaccessible("1,87", "B"),
      inaccessible("1,103", "o is B"),
      inaccessible("1,103", "o"),
    ],
  ],
  "a union of object types": [
    "export const v = (() => { class L { v = (() => { return (o: { x: 1 } | 1): o is 1 => true; })(); } return null! as L; })();",
    [variable("1,14"), property, inaccessible("1,76", "o is 1"), inaccessible("1,76", "o")],
  ],
  "a parameter that stays": [
    "function g<T>(x: T) { return (o: any): asserts o => {}; }\nexport const v = g(1);",
    [variable("2,14")],
  ],
  "a type predicate that changes": [
    "function g<T>(x: T) { return (o: any): o is T => true; }\nexport const v = g(1);",
    [
      "(1,30): error TS9007: Function must have an explicit return type annotation with --isolatedDeclarations.",
      variable("2,14"),
    ],
  ],
  "a type query": ["function g<T>(x: T) { return (o: T): typeof o => o; }\nexport const v = g(1);", [variable("2,14")]],
};

test.concurrent.each(Object.keys(programs))("%s", async name => {
  const [source, errors] = programs[name];
  const compilerOptions = {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    lib: ["esnext"],
    types: [],
    declaration: true,
    isolatedDeclarations: true,
  };
  using dir = tempDir("check-names-of-predicates", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: ["a.ts"] }),
    "a.ts": source + "\n",
  });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const reported = stdout.split("\n").filter(line => line.includes("error TS"));
  expect(reported.sort()).toEqual(errors.map(it => `a.ts${it}`).sort());
});
