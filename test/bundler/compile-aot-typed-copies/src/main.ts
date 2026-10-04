const out: unknown[] = [];

interface Style { name: string; color?: string; width?: number; bold?: boolean; margin?: number; padding?: number }
interface Wide { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: number; j: number; k: number; l: number }
interface Point { x: number; y: number }
interface Labelled { x: number; y: number; label: string }

function makesStyle(i: number): Style { return { name: "s" + (i & 3), color: "red", width: i, bold: (i & 1) === 0 }; }
function makesNarrowStyle(i: number): Style { return { name: "n", margin: i }; }
function makesLoose(i: number): any { return { name: "l", width: i, other: i + 1 }; }
function makesWide(i: number): Wide { return { a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11 }; }
function makesPoint(i: number): Point { return { x: i, y: i + 0.5 }; }

function literalThenSpread(a: Style): Style { return { name: "first", ...a }; }
function twoSpreads(a: Style, b: Style): Style { return { ...a, ...b }; }
function spreadThenLiteral(a: Style, w: number): Style { return { ...a, width: w }; }
function spreadOfLoose(a: any): Style { return { name: "typed", ...a }; }
function takesRest({ name, ...rest }: Style) { return (rest.width ?? -1) + name.length + (rest.margin ?? 0); }
function restOfLocal(a: Style) { const { color, bold, ...rest } = a; return rest.name + ":" + rest.width + ":" + color + ":" + bold; }
function widens(p: Point, label: string): Labelled { return { label, ...p }; }
function copiesWide(w: Wide, a: number): Wide { return { a, ...w }; }
function overwritesWide(w: Wide, v: Wide): Wide { return { ...w, ...v }; }

function widthOf(s: Style) { return s.width ?? -1; }
function marginOf(s: Style) { return s.margin ?? -1; }
function sumOfWide(w: Wide) { return w.a + w.b + w.c + w.d + w.e + w.f + w.g + w.h + w.i + w.j + w.k + w.l; }
function sumOfLabelled(p: Labelled) { return p.x + p.y + p.label.length; }
function describes(s: Style) { return s.name + "," + s.color + "," + s.width + "," + s.bold + "," + s.margin + "," + s.padding + "|" + Reflect.ownKeys(s).map(String).join(); }

let sum = 0;
for (let i = 0; i < 20000; ++i) {
  const a = makesStyle(i), b = makesNarrowStyle(i);
  sum += widthOf(literalThenSpread(a)) + marginOf(twoSpreads(a, b)) + widthOf(spreadThenLiteral(a, 7)) + widthOf(spreadOfLoose(makesLoose(i))) + takesRest(a) + restOfLocal(a).length;
  sum += sumOfLabelled(widens(makesPoint(i), "p")) + sumOfWide(copiesWide(makesWide(i), 3)) + sumOfWide(overwritesWide(makesWide(i), makesWide(i + 1)));
}
out.push(sum);
out.push(describes(literalThenSpread(makesStyle(5))), describes(twoSpreads(makesStyle(6), makesNarrowStyle(9))), describes(twoSpreads(makesNarrowStyle(1), makesStyle(2))));
out.push(describes(spreadThenLiteral(makesStyle(3), 8)), describes(spreadOfLoose(makesLoose(4))), takesRest(makesStyle(10)), takesRest(makesNarrowStyle(11)), restOfLocal(makesStyle(12)));
out.push(JSON.stringify(widens(makesPoint(2), "q")), JSON.stringify(copiesWide(makesWide(1), 9)), JSON.stringify(overwritesWide(makesWide(1), makesWide(2))));

function throwsOrDescribes(f: () => Style) { try { return describes(f()); } catch (e) { return (e as Error).constructor.name; } }
const symbol = Symbol("key");
const hidden = Object.defineProperty({ name: "h", width: 1 }, "margin", { value: 2, enumerable: false });
const readOnly = Object.defineProperty({ name: "r" }, "width", { value: 4, enumerable: true, writable: false });
const cases: [string, () => Style][] = [
  ["a string where a number is declared", () => spreadOfLoose({ width: "wide" })],
  ["a number where a string is declared", () => spreadOfLoose({ name: 5 })],
  ["the same, as the second spread", () => twoSpreads(makesStyle(1), { name: "x", width: "w" } as any)],
  ["the same, after values that are accepted", () => spreadOfLoose({ color: "c", margin: 1, bold: "no" })],
  ["null where it is not declared", () => spreadOfLoose({ width: null })],
  ["undefined for an optional member", () => spreadOfLoose({ width: undefined, color: undefined })],
  ["undefined for a required member", () => spreadOfLoose({ name: undefined })],
  ["a getter", () => spreadOfLoose({ get width() { return 3; } })],
  ["a getter that gives a string", () => spreadOfLoose({ get width() { return "g"; } })],
  ["a symbol", () => spreadOfLoose({ [symbol]: 1, width: 2 })],
  ["a member that is not enumerable", () => spreadOfLoose(hidden)],
  ["a member that is read-only", () => spreadOfLoose(readOnly)],
  ["null", () => spreadOfLoose(null)],
  ["a string", () => spreadOfLoose("ab")],
  ["an array", () => spreadOfLoose([7])],
  ["a proxy", () => spreadOfLoose(new Proxy({ width: 6 }, {}))],
  ["an instance", () => spreadOfLoose(new (class { width = 5; other = 1; })())],
  ["names in another order", () => spreadOfLoose({ padding: 1, margin: 2, bold: true, width: 3, color: "c", name: "o" })],
  ["many other names", () => spreadOfLoose(Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["n" + i, i])))],
  ["a double, an integer, a negative zero", () => twoSpreads({ name: "d", width: 1.5, margin: 2 }, { name: "e", padding: -0 })],
  ["a dictionary", () => { const o: any = { name: "x" }; for (let i = 0; i < 200; ++i) o["k" + i] = i; for (let i = 0; i < 199; ++i) delete o["k" + i]; return spreadOfLoose(o); }],
];
for (const [what, f] of cases) for (let i = 0; i < 3; ++i) out.push(what + ": " + throwsOrDescribes(f));

const kept = literalThenSpread(makesStyle(1));
const copy = twoSpreads(kept, makesNarrowStyle(2));
copy.width = 99; copy.name = "changed";
out.push(describes(kept), describes(copy), Object.is(twoSpreads({ name: "z", padding: -0 }, { name: "z" }).padding, -0), typeof widthOf(spreadOfLoose({ width: 3 })));
function storesLater(s: any, v: unknown) { try { s.width = v; return describes(s); } catch (e) { return (e as Error).constructor.name; } }
out.push(storesLater(literalThenSpread(makesStyle(1)), "late"), storesLater(twoSpreads(makesStyle(1), makesNarrowStyle(1)), "late"), storesLater(spreadOfLoose({}), 4));
console.log(out.join("\n"));
