// Writes test/aot/parallel/chains-of-list-methods/: ONE CHAIN OF LIST METHODS AND ONE DEED A PROGRAM, each held against `bun <file>` by run-parallel.ts.
//
//   bun test/aot/tools/generate-chains-of-list-methods.ts        the same bytes every time
//
// The library's own methods go over a plain vector by a run of their own, and the compiler may put one traversal in the place of `list.filter(f).map(g)`. What neither may ever change: the order in which the callbacks are seen to run, which elements they meet,
// what is thrown and when, and who is asked where the list is no plain list. A program prints, for each run, the answer, the log of all that ran and the list as it is left.
// Of the words of "is not a function" the quoted source goes: a compiled program quotes a call without the text of a function among its arguments, with or without a chain.
// A chain: a line of `chains`. F G H E R P are the callbacks. Quiet ones do nothing that anybody sees, so the compiler may run them element by element; loud ones log each call.
// A deed on the list: a line of `deedsOnList`, the body of deed(list), done through names that only the run knows. It goes with every chain, quiet and loud.
// A deed of a callback: a line of `deedsOfCallbacks`, what F does at its third call or G at its first: run element by element, G's first call comes in front of F's third. It goes with every chain, loud.
// Where the chain stands: a line of `places`. `written`: on a parameter that is written to be a list (no word in the file's name). `in-a-loop`: the same in a loop of its own function, where the compiler may read the traversal in line: every deed.
// `in-sight`: on a list that the function itself has made and stored where the callbacks find it. `of-a-row`: on a list that a built-in has just made for the chain alone, which only the first callback can get hold of, as its third argument;
// there one method is a chain too (`single`). Nobody can do a deed on these two lists in front of the chain, so they go with the deeds of callbacks and with no deed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const folder = join(import.meta.dirname, "..", "parallel", "chains-of-list-methods");

const chains: Record<string, string> = {
  "filter-map": "list.filter(F).map(G)",
  "map-filter": "list.map(G).filter(H)",
  "map-filter-boolean": "list.map(G).filter(Boolean)",
  "filter-length": "list.filter(F).length",
  "filter-map-filter": "list.filter(F).map(G).filter(H)",
  "map-some": "list.map(G).some(H)",
  "map-every": "list.map(G).every(H)",
  "filter-find": "list.filter(F).find(H)",
  "filter-find-index": "list.filter(F).findIndex(H)",
  "filter-for-each": "list.filter(F).forEach(E)",
  "map-reduce": "list.map(G).reduce(R, 0)",
  "filter-reduce-without-a-start": "list.filter(F).reduce(R)",
  "map-join": 'list.map(G).join("-")',
  "filter-map-join": "list.filter(F).map(G).join()",
  "slice-map": "list.slice(1).map(G)",
  "filter-flat-map": "list.filter(F).flatMap(P)",
  "filter-map-that-looks-at-its-list": "list.filter(F).map((x, i, all) => x + all.length)",
  "filter-map-that-counts-its-arguments": "list.filter(F).map(function (x) { return x + arguments.length + arguments[2].length; })",
  "filter-map-with-this": "list.filter(F).map(function (this: { more: number }, x) { return x + this.more; }, { more: 1 })",
  "filter-map-of-what-is-no-function": "list.filter(F).map(hidden.none)",
};

// One method on a list that a built-in has just made.
const single: Record<string, string> = {
  "map": "list.map(G)",
  "filter": "list.filter(F)",
  "for-each": "list.forEach(E)",
  "some": "list.some(H)",
  "every": "list.every(H)",
  "find": "list.find(H)",
  "find-index": "list.findIndex(H)",
  "reduce": "list.reduce(R, 0)",
  "reduce-without-a-start": "list.reduce(R)",
  "flat-map": "list.flatMap(P)",
  "join": 'list.join("-")',
  "filter-boolean": "list.filter(Boolean)",
};

type Place = "written" | "in-a-loop" | "in-sight" | "of-a-row";
const places: Record<Place, (chain: string) => string> = {
  "written": chain => `function subject(list: number[]) { return ${chain}; }`,
  "in-a-loop": chain => `function subject(list: number[]) { let answer: any; for (let again = 0; again < 2; again++) answer = ${chain}; return answer; }`,
  "in-sight": chain => `function subject(from: number[]) { const list = [from[0], from[1], from[2], from[3]]; source = list; return ${chain}; }`,
  "of-a-row": chain => `function subject(from: number[]) { return ${chain.replace(/^list\b/, "Object.values(from)")}; }`,
};
// The first callback of the chain keeps the list that its method hands it, so that the deeds find it.
const keepingItsList = (callback: string) => callback.replace(/^x => \{ /, "(x, _at, all) => { source = all; ").replace(/^\(sum, x\) => \{ /, "(sum, x, _at, all) => { source = all; ");

const callbacks: Record<"quiet" | "loud", Record<string, string>> = {
  quiet: {
    F: "x => x > 1",
    G: "x => x * 2",
    H: "x => x > 4",
    E: "x => { total += x; }",
    R: "(sum, x) => sum + x",
    P: "x => x > 2 ? [x, x + 1] : []",
  },
  loud: {
    F: 'x => { note("f" + x); inFirst(); return x > 1; }',
    G: 'x => { note("g" + x); inSecond(); return x * 2; }',
    H: 'x => { note("h" + x); return x > 4; }',
    E: 'x => { note("e" + x); total += x; }',
    R: '(sum, x) => { note("r" + x); return sum + x; }',
    P: 'x => { note("p" + x); return x > 2 ? [x, x + 1] : []; }',
  },
};

const deedsOnList: Record<string, string> = {
  "nothing-is-done": "",
  "an-element-is-deleted": "reflect[hidden.remove](list, 1);",
  "a-hole-lies-over-an-index-below": "reflect[hidden.remove](list, 1); reflect[hidden.below](list, { 1: 7, __proto__: Array.prototype });",
  "the-list-gets-methods-of-its-own": 'for (const name of ["filter", "map", "slice"]) reflect[hidden.define](list, name, { value() { note("own " + name); return [9, 1]; } });',
  "the-list-gets-a-constructor-of-its-own": 'reflect[hidden.set](list, "constructor", { [Symbol.species]: function (length: number) { note("species " + length); return new Array(length); } });',
  "the-list-comes-to-stand-below-a-class": "reflect[hidden.below](list, Below.prototype);",
  "the-list-comes-to-stand-below-nothing": "reflect[hidden.below](list, null);",
  "an-index-gets-a-getter": 'reflect[hidden.define](list, 1, { get() { note("get"); return 5; }, enumerable: true, configurable: true });',
  "the-list-is-frozen": "object[hidden.freeze](list);",
  "two-elements-convert-themselves": 'for (const at of [1, 2]) reflect[hidden.set](list, at, { valueOf() { note("valueOf" + at); return 3; }, toString() { note("toString" + at); return "3"; } });',
  "an-element-is-a-text": 'reflect[hidden.set](list, 1, "3");',
  "an-element-is-a-fraction": "reflect[hidden.set](list, 1, 2.5);",
  "an-element-is-not-a-number": "reflect[hidden.set](list, 1, NaN);",
  "an-element-is-undefined": "reflect[hidden.set](list, 1, undefined);",
  "an-element-is-a-symbol": "reflect[hidden.set](list, 1, Symbol.iterator);",
  "an-element-is-the-list": "reflect[hidden.set](list, 1, list);",
  "an-element-lies-far-behind-the-end": "reflect[hidden.set](list, 40, 9);",
  "the-list-is-emptied": 'reflect[hidden.set](list, "length", 0);',
  "the-list-gets-a-name": 'reflect[hidden.set](list, "extra", 1);',
  "a-proxy-stands-in-front": 'list = new Proxy(list, { get(target, key, receiver) { note("get " + String(key)); return Reflect.get(target, key, receiver); }, has(target, key) { note("has " + String(key)); return Reflect.has(target, key); } });',
  "an-object-with-a-length-comes": "list = { length: 3, 0: 1, 1: 2, 2: 5, filter: Array.prototype.filter, map: Array.prototype.map, slice: Array.prototype.slice } as any;",
  "an-object-of-a-class-below-lists-comes": "list = Below.from(list) as any;",
  "null-comes": "list = null as any;",
  "undefined-comes": "list = undefined as any;",
  "a-text-comes": 'list = "1234" as any;',
};

const deedsOfCallbacks: Record<string, { inFirst?: string; inSecond?: string }> = {
  "the-first-appends": { inFirst: "source.push(8);" },
  "the-first-takes-the-last-away": { inFirst: "source.pop();" },
  "the-first-takes-the-first-away": { inFirst: "source.shift();" },
  "the-first-empties-the-list": { inFirst: "source.length = 0;" },
  "the-first-replaces-an-element-to-come": { inFirst: "source[3] = 0;" },
  "the-first-deletes-an-element-to-come": { inFirst: "delete source[3];" },
  "the-first-sorts-the-list": { inFirst: "source.sort((a, b) => b - a);" },
  "the-first-stores-a-text": { inFirst: 'source[3] = "6" as any;' },
  "the-first-lays-a-getter-on-an-index": { inFirst: 'reflect[hidden.define](source, 3, { get() { note("get"); return 6; }, configurable: true, enumerable: true });' },
  "the-first-moves-the-list-below-a-class": { inFirst: "reflect[hidden.below](source, Below.prototype);" },
  "the-first-freezes-the-list": { inFirst: "object[hidden.freeze](source);" },
  "the-first-collects": { inFirst: "(globalThis as any).Bun.gc(true);" },
  "the-first-throws": { inFirst: 'throw new RangeError("first");' },
  "the-second-throws": { inSecond: 'throw new RangeError("second");' },
  "both-throw": { inFirst: 'throw new RangeError("first");', inSecond: 'throw new TypeError("second");' },
  "the-second-appends-to-the-source": { inSecond: "source.push(8);" },
  "the-second-empties-the-source": { inSecond: "source.length = 0;" },
  "the-second-replaces-an-element-of-the-source": { inSecond: "source[3] = 0;" },
  "the-second-collects": { inSecond: "(globalThis as any).Bun.gc(true);" },
};

function program(chain: string, manner: "quiet" | "loud", deed: string, onList: string, inFirst: string, inSecond: string, place: Place = "written") {
  let isFirst = true;
  const subject = (chains[chain] ?? single[chain]).replace(/\b[FGHERP]\b/g, letter => {
    const callback = callbacks[manner][letter];
    const keeps = isFirst && place === "of-a-row";
    isFirst = false;
    return keeps ? keepingItsList(callback) : callback;
  });
  return `// ${chain}${place === "written" ? "" : " " + place.replaceAll("-", " ")}, ${manner} callbacks: ${deed.replaceAll("-", " ")}
const hidden = JSON.parse('{"set":"set","define":"defineProperty","remove":"deleteProperty","below":"setPrototypeOf","freeze":"freeze"}');
const reflect: any = Reflect;
const object: any = Object;
const log: string[] = [];
let source: number[] = [];
let isArmed = false;
let firsts = 0;
let seconds = 0;
let total = 0;
class Below extends Array<number> {
  filter(...operands: any[]): any { note("below filter"); return (super.filter as any)(...operands); }
  map(...operands: any[]): any { note("below map"); return (super.map as any)(...operands); }
  slice(...operands: any[]): any { note("below slice"); return (super.slice as any)(...operands); }
}
function note(text: string) { log.push(text); }
function show(value: any): string {
  if (!Array.isArray(value)) return typeof value + " " + String(value);
  let text = "[";
  for (let index = 0; index < value.length && index < 50; index++) text += (index ? "," : "") + (index in value ? (value[index] === value ? "itself" : String(value[index])) : "hole");
  return text + "]";
}
function inFirst() { if (isArmed && ++firsts === 3) { ${inFirst} } }
function inSecond() { if (isArmed && ++seconds === 1) { ${inSecond} } }
${places[place](subject)}
function deed(list: number[]): number[] { isArmed = true; ${onList} return list; }
function run(list: number[]) {
  log.length = 0;
  firsts = seconds = total = 0;
  source = list;
  let answer: string;
  try { answer = show(subject(list)); } catch (error: any) { answer = error.name + ": " + error.message.replace(/ \\(In '[^]*$/, ""); }
  isArmed = false;
  let left: string;
  try { left = show(${place === "in-sight" || place === "of-a-row" ? "source" : "list"}); } catch (error: any) { left = error.name; }
  console.log(answer + " | " + log.join(" ") + " | " + total + " | " + left);
}
run([1, 2, 3, 4]);
for (let turn = 0; turn < 3; turn++) run([turn, 2, 5, 4]);
run(deed([1, 2, 3, 4]));
run([1, 2, 3, 4]);
`;
}

mkdirSync(folder, { recursive: true });
for (const chain of Object.keys(chains)) {
  for (const [deed, onList] of Object.entries(deedsOnList)) {
    for (const manner of ["quiet", "loud"] as const) writeFileSync(join(folder, `${chain}.${manner}.${deed}.ts`), program(chain, manner, deed, onList, "", ""));
  }
  for (const [deed, { inFirst = "", inSecond = "" }] of Object.entries(deedsOfCallbacks))
    writeFileSync(join(folder, `${chain}.loud.${deed}.ts`), program(chain, "loud", deed, "", inFirst, inSecond));
}
for (const chain of Object.keys(chains)) {
  for (const [deed, onList] of Object.entries(deedsOnList)) {
    for (const manner of ["quiet", "loud"] as const) writeFileSync(join(folder, `${chain}.in-a-loop.${manner}.${deed}.ts`), program(chain, manner, deed, onList, "", "", "in-a-loop"));
  }
  for (const [deed, { inFirst = "", inSecond = "" }] of Object.entries(deedsOfCallbacks))
    writeFileSync(join(folder, `${chain}.in-a-loop.loud.${deed}.ts`), program(chain, "loud", deed, "", inFirst, inSecond, "in-a-loop"));
}
for (const place of ["in-sight", "of-a-row"] as const) {
  for (const chain of [...Object.keys(chains), ...(place === "of-a-row" ? Object.keys(single) : [])]) {
    for (const manner of ["quiet", "loud"] as const) writeFileSync(join(folder, `${chain}.${place}.${manner}.nothing-is-done.ts`), program(chain, manner, "nothing-is-done", "", "", "", place));
    for (const [deed, { inFirst = "", inSecond = "" }] of Object.entries(deedsOfCallbacks))
      writeFileSync(join(folder, `${chain}.${place}.loud.${deed}.ts`), program(chain, "loud", deed, "", inFirst, inSecond, place));
  }
}
