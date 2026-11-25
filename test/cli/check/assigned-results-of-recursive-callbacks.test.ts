// The argument of `strs.every(f)` in `f` is wrong, and the message about it prints the return type of `f`, which is what the call returns. The call already has its
// signature then, so TypeScript doesn't need its arguments a second time. The checker knew that for expressions that contain the call, but not for a variable that
// the result is assigned to: it reported TS7023, and the function returned `any`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const callback = "(value: string, index: number, array: string[]) => unknown";
const refused = (source: string) =>
  `error TS2345: Argument of type '${source}' is not assignable to parameter of type '${callback}'.`;
const noOverload = "error TS2769: No overload matches this call.";

// Each program, its return type in TypeScript, and the other errors that TypeScript reports. The last one is a cycle.
const programs: [source: string, returned: string, errors: string[]][] = [
  [`export function f(a: boolean) { let t; t = strs.every(f); return t; }`, "boolean", [`(2,55): ${noOverload}`]],
  [`export function f(a: boolean) { let t; t = [strs.every(f)][0]; return t; }`, "boolean", [`(2,56): ${noOverload}`]],
  [
    `export function f(a: boolean) { let t = [strs.some(f)]; if (a) t = [strs.every(f)]; return t; }`,
    "boolean[]",
    [`(2,52): ${refused("(a: boolean) => boolean[]")}`, `(2,80): ${noOverload}`],
  ],
  [
    `const o = { m(a: boolean) { let t; t = strs.every(o.m); return t; } }, f = o.m;`,
    "boolean",
    [`(2,51): ${noOverload}`],
  ],
  [
    `class C { m(a: boolean) { let t; t = strs.some(this.m); return t; } }; const f = (a: boolean) => new C().m(a);`,
    "boolean",
    [`(2,48): ${refused("(a: boolean) => boolean")}`],
  ],
  [
    `export function f(a: boolean) { const t = id(strs.filter(f)); return t; }`,
    "any",
    [
      "(2,17): error TS7023: 'f' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.",
      "(2,39): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.",
      `(2,58): ${noOverload}`,
    ],
  ],
];

test("results of recursive callbacks that are assigned to variables", async () => {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
    }),
  };
  const expected: string[] = [];
  programs.forEach(([source, returned, errors], at) => {
    const name = `f${at}.ts`;
    files[name] =
      `declare const strs: string[]; declare function id<T>(x: T): T;\n${source}\nexport const q: never = f(true);\n`;
    expected.push(
      ...errors.map(it => name + it),
      `${name}(3,14): error TS2322: Type '${returned}' is not assignable to type 'never'.`,
    );
  });
  using dir = tempDir("check-assigned-results", files);
  for (const threads of [1, 8]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    expect(
      stdout
        .split("\n")
        .filter(line => line.includes("error TS"))
        .sort(),
    ).toEqual(expected.sort());
  }
});
