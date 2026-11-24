// A type that a class's member creates is instantiated with the type of `this`. TypeScript leaves a property, a method or a parameter of it as it is if its annotation can't mention `this`
// (`isThisless`), so the annotation is what a declaration file gets, and TS9039 reports a name in it that isn't accessible there. The checker did that for a class's own members only.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const property = "(1,37): error TS9012: Property must have an explicit type annotation with --isolatedDeclarations.";
const variable = (at = "1,14") => `(${at}): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.`;
const inaccessible = (at: string, name: string) => `(${at}): error TS9039: Type containing private name '${name}' can't be used with --isolatedDeclarations.`;
const inProperty = (statements: string) => `export const v = (() => { class L { v = (() => { ${statements} })(); } return null! as L; })();`;

// Each program, and the errors that TypeScript reports.
const programs: Record<string, [source: string, errors: string[]]> = {
  "a property of a type literal": [inProperty("type B = { x: 1 }; return null! as { b: B };"), [variable(), property, inaccessible("1,90", "B")]],
  "a method of a type literal": [inProperty("type B = { x: 1 }; return null! as { d(): B };"), [variable(), property, inaccessible("1,92", "B")]],
  "type arguments": [inProperty("type B = { x: 1 }; return null! as { f: Map<string, B> };"), [variable(), property, inaccessible("1,102", "B")]],
  "a tuple": [inProperty("type B = { x: 1 }; return null! as { f: [B] };"), [variable(), property]],
  "a parameter of a function type": [inProperty("type A = (n: B) => 1; type B = { x: 1 }; return null! as A;"), [variable(), property, inaccessible("1,63", "B")]],
  "parameters of a function": [
    inProperty("type B = { x: 1 }; return function (this: B, n: B): B { return n; };"),
    [variable(), property, inaccessible("1,92", "B"), inaccessible("1,98", "B")],
  ],
  "a type guard": [inProperty("type B = { x: 1 }; return (o: B): o is B => true;"), [variable(), property, inaccessible("1,80", "B"), inaccessible("1,89", "B")]],
  "a method of a class": [
    "class L { m() { type B = { x: 1 }; return null! as { b: B }; } }\nexport const v = new L().m();",
    [inaccessible("1,57", "B"), variable("2,14")],
  ],
  "a method of a generic class": [
    "class L<T> { m() { type B = { x: 1 }; return null! as { b: B }; } }\nclass M extends L<string> { }\nexport const v = new M().m();",
    [variable("3,14")],
  ],
};

test.concurrent.each(Object.keys(programs))("%s", async name => {
  const [source, errors] = programs[name];
  const compilerOptions = { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [], declaration: true, isolatedDeclarations: true };
  using dir = tempDir("check-aliases-in-members", { "tsconfig.json": JSON.stringify({ compilerOptions, files: ["a.ts"] }), "a.ts": source + "\n" });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const reported = stdout.split("\n").filter(line => line.includes("error TS"));
  expect(reported.sort()).toEqual(errors.map(it => `a.ts${it}`).sort());
});
