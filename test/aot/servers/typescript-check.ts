// What ./budgets.test.ts counts under the name "typescript": the type checker of the typescript package checks one fixed text, as
// often as the first argument says, without a file system and without the standard library. It prints the codes of the three errors
// that the text has on purpose.
import ts from "typescript";

// It is built in a folder that has the typescript package and nothing else, so it says itself what it uses of the host.
declare const process: { argv: string[] };
declare const console: { log(text: string): void };

const globals = `
interface Array<T> { length: number; [index: number]: T; push(...items: T[]): number; map<U>(callback: (value: T, index: number) => U): U[]; filter(callback: (value: T) => boolean): T[]; reduce<U>(callback: (sum: U, value: T) => U, start: U): U; }
interface ReadonlyArray<T> { readonly length: number; readonly [index: number]: T; }
interface Boolean {} interface CallableFunction {} interface Function {} interface IArguments {} interface NewableFunction {}
interface Number { toFixed(digits?: number): string; } interface Object {} interface RegExp {} interface String { readonly length: number; toUpperCase(): string; }
interface Promise<T> { then<U>(callback: (value: T) => U | Promise<U>): Promise<U>; }
type Partial<T> = { [K in keyof T]?: T[K] };
type Record<K extends string | number | symbol, T> = { [P in K]: T };
`;

const program = `
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "rectangle"; width: number; height: number };
interface Named { name: string; }
abstract class Item<T extends Named> implements Named {
  constructor(public name: string, protected readonly parts: T[]) {}
  abstract weigh(part: T): number;
  total(): number { return this.parts.reduce((sum, part) => sum + this.weigh(part), 0); }
  names(): string[] { return this.parts.map(part => part.name.toUpperCase()); }
}
class Crate extends Item<Named & { grams: number }> {
  weigh(part: Named & { grams: number }) { return part.grams; }
}
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return 3 * shape.radius * shape.radius;
    case "square": return shape.side * shape.side;
    case "rectangle": return shape.width * shape.height;
  }
}
function pick<T, K extends keyof T>(from: T, ...keys: K[]): Partial<T> {
  const picked: Partial<T> = {};
  for (let i = 0; i < keys.length; i++) picked[keys[i]] = from[keys[i]];
  return picked;
}
const byKind: Record<Shape["kind"], number> = { circle: 0, square: 0, rectangle: 0 };
const shapes: Shape[] = [{ kind: "circle", radius: 2 }, { kind: "square", side: 3 }, { kind: "rectangle", width: 2, height: 5 }];
for (let i = 0; i < shapes.length; i++) byKind[shapes[i].kind] += area(shapes[i]);
const crate = new Crate("crate", [{ name: "bolt", grams: 12 }, { name: "nut", grams: 5 }]);
const wrong: string = crate.total();
const alsoWrong = pick(crate, "name", "weight");
async function later(): Promise<number> { return area({ kind: "square", side: "4" }); }
`;

const files: Record<string, string> = { "globals.d.ts": globals, "main.ts": program };
const options: ts.CompilerOptions = { noLib: true, strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] };
const host: ts.CompilerHost = {
  getSourceFile: (name, version) => (name in files ? ts.createSourceFile(name, files[name], version) : undefined),
  getDefaultLibFileName: () => "globals.d.ts",
  writeFile: () => {},
  getCurrentDirectory: () => "",
  getCanonicalFileName: name => name,
  useCaseSensitiveFileNames: () => true,
  getNewLine: () => "\n",
  fileExists: name => name in files,
  readFile: name => files[name],
};

const units = Number(process.argv[2]);
const codes: number[] = [];
for (let unit = 0; unit < units; unit++) {
  codes.length = 0;
  for (const diagnostic of ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host))) codes.push(diagnostic.code);
}
console.log(codes.join(" "));
