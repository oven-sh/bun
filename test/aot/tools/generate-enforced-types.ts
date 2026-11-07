// Writes test/aot/parallel/enforced-types/<road>-<kind>-field.ts: ONE LIE A PROGRAM. A field is written with a type, which the slot is held to, and one road brings it a value of another type.
//
//   bun test/aot/tools/generate-enforced-types.ts
//
// A kind is what is written of the field: its type, two honest values, a lie (JSON: it comes out of a parse, so no flow of the build sees it arrive) and what a reader does with the field.
// A road is the one statement that brings the lie. Each program prints the field before and behind the deed, behind an honest store, and in a loop of three turns whose second does the deed.
// To add a kind or a road: one line in its table. The programs that this file does not write (a cast, a declaration file, a subclass ..) stand beside them by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Kind {
  head: string[];
  type: string;
  honest: [string, string];
  lie: string;
  read: string;
}

const kinds: Record<string, Kind> = {
  number: { head: [], type: "number", honest: ["1.5", "2.5"], lie: '"text"', read: "h.field + 1" },
  enum: { head: ["enum Flags { None, Union = 1, Object = 2 }"], type: "Flags", honest: ["Flags.Union", "Flags.Object"], lie: '"text"', read: "(h.field & 3) + 1" },
  boolean: { head: [], type: "boolean", honest: ["true", "false"], lie: "7", read: '(h.field ? "yes" : "no")' },
  string: { head: [], type: "string", honest: ['"one"', '"three"'], lie: "7", read: "h.field.length" },
  class: { head: ["class Point { x: number; constructor(x: number) { this.x = x; } }"], type: "Point", honest: ["new Point(1)", "new Point(2)"], lie: '{ "x": "ordinary" }', read: "h.field.x + 1" },
  interface: { head: ["interface Named { name: string; size: number }", 'function named(size: number): Named { return { name: "n", size }; }'], type: "Named", honest: ["named(1)", "named(2)"], lie: '{ "name": 5 }', read: "h.field.size + h.field.name" },
  union: { head: [], type: "number | string", honest: ["1", '"two"'], lie: "[true]", read: "h.field + \"!\"" },
  function: { head: [], type: "(by: number) => number", honest: ["by => by + 1", "by => by + 2"], lie: '"no function"', read: "h.field(1)" },
};

const roads: Record<string, string> = {
  "any-stored-into": "(h as any).field = lie; return h;",
  "object-assign-into": "return Object.assign(h, { field: lie });",
  "spread-over": "return { ...h, field: lie } as any;",
  "define-property-on": 'return Object.defineProperty(h, "field", { value: lie, writable: true, enumerable: true, configurable: true });',
  "reflect-set-on": 'Reflect.set(h, "field", lie); return h;',
  "delete-of": "delete (h as any).field; return h;",
  "reviver-stores-into": 'JSON.parse("[0]", () => { (h as any).field = lie; return 0; }); return h;',
  "structured-clone-of": "(h as any).field = lie; return structuredClone(h);",
  "proxy-stores-into": "new Proxy(h, {}).field = lie; return h;",
};

const program = (road: string, kind: string) => {
  const { head, type, honest, lie, read } = kinds[kind];
  return [
    `// ${road} a field that is written \`${type}\`: the slot is held to what is written, and whoever breaks it pays by the object. Every answer is that of plain Bun.`,
    "// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to",
    ...head,
    `class Holder { field: ${type}; other: number; constructor(field: ${type}) { this.field = field; this.other = 1; } }`,
    "function attempt(read: () => unknown): string { try { return String(read()); } catch (error) { return (error as Error).name; } }",
    `function read(h: Holder): string { return attempt(() => ${read}) + " " + typeof h.field + " " + Object.keys(h).join(); }`,
    `function deed(h: Holder, lie: any): Holder { ${roads[road]} }`,
    "function tryDeed(h: Holder, lie: any): Holder { try { return deed(h, lie); } catch (error) { console.log((error as Error).name); return h; } }",
    `const lie = JSON.parse(${JSON.stringify(lie)});`,
    `const straight = new Holder(${honest[0]});`,
    'console.log("before", read(straight));',
    'console.log("behind", read(tryDeed(straight, lie)), "|", read(straight));',
    `straight.field = ${honest[1]};`,
    'console.log("honest again", read(straight));',
    "for (let turn = 0; turn < 3; turn++) {",
    `  const h = new Holder(turn % 2 ? ${honest[1]} : ${honest[0]});`,
    '  console.log(turn, read(h), "|", read(turn === 1 ? tryDeed(h, lie) : h), "|", read(h));',
    "}",
    "",
  ].join("\n");
};

const folder = join(import.meta.dir, "..", "parallel", "enforced-types");
mkdirSync(folder, { recursive: true });
for (const road of Object.keys(roads)) {
  for (const kind of Object.keys(kinds)) writeFileSync(join(folder, `${road}-${kind}-field.ts`), program(road, kind));
}
