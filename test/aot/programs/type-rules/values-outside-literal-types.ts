// A literal type says which values the compiler may expect, not which values arrive: a value of the right kind outside the list goes on as it is. Everything that could be specialized for the list is tried here with values from parsed text, which no analysis knows: switches, comparisons, tables, indexes, arithmetic, conditions, fields, elements, discriminants. Every line is what plain Bun prints.
const given: { strings: any[]; numbers: any[]; booleans: any[] } = JSON.parse(
  '{"strings":["a","b","c","ab","","A","__proto__","constructor","0","reference"],"numbers":[1,2,3,0,-1,1.5,-0,4294967297,2147483648,-2147483649,1e300,300],"booleans":[true,false]}',
);
given.numbers.push(NaN, Infinity);
// The same texts as cells that no literal of the program stands for.
const built: any[] = given.strings.map(text => (text + "!").slice(0, -1));
function line(label: string, values: unknown[]): void { console.log(label, values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" ")); }

type Name = "a" | "b";
type Level = 1 | 2;
enum Color { Red = "a", Blue = "b" }
enum Step { Low = 1, High = 2 }
enum Flag { None = 0, Read = 1, Write = 2 }
interface Specs { reference: number; "amd-module": number }
const specs: Specs = { reference: 1, "amd-module": 2 };

function switchedName(name: Name): string { switch (name) { case "a": return "first"; case "b": return "second"; } }
function switchedNameWithDefault(name: Name): string { switch (name) { case "a": return "first"; default: return "rest"; } }
function switchedLevel(level: Level): string { switch (level) { case 1: return "one"; case 2: return "two"; } }
function switchedColor(color: Color): string { switch (color) { case Color.Red: return "red"; case Color.Blue: return "blue"; } }
function switchedStep(step: Step): string { switch (step) { case Step.Low: return "low"; case Step.High: return "high"; } }
function chained(name: Name): string { if (name === "a") return "first"; else if (name === "b") return "second"; return "neither"; }
function otherwise(name: Name): string { return name === "a" ? "first" : "must be b: " + name; }
function notEqual(name: Name): boolean { return name !== "a" && name !== "b"; }
function loose(level: Level): boolean { return level == 1 || level == 2; }
for (const [label, texts] of [["literals", given.strings], ["built", built]] as const) {
  line("switch on strings, " + label, texts.map(switchedName));
  line("switch with default, " + label, texts.map(switchedNameWithDefault));
  line("switch on a string enum, " + label, texts.map(switchedColor));
  line("chain of comparisons, " + label, texts.map(chained));
  line("else of one comparison, " + label, texts.map(otherwise));
  line("unequal to every literal, " + label, texts.map(notEqual));
}
line("switch on numbers", given.numbers.map(switchedLevel));
line("switch on a numeric enum", given.numbers.map(switchedStep));
line("loosely equal", given.numbers.map(loose));

const words = ["zero", "one", "two"];
const bytes = new Uint8Array([10, 11, 12]);
function indexed(level: Level): unknown { return words[level]; }
function indexedBelow(level: Level): unknown { return words[level - 1]; }
function indexedBytes(level: Level): unknown { return bytes[level]; }
function character(level: Level): unknown { return "xyz"[level]; }
function characterAt(level: Level): unknown { return "xyz".charCodeAt(level); }
function reverse(step: Step): unknown { return Step[step]; }
function keyed(name: keyof Specs): unknown { return typeof specs[name]; }
function has(name: keyof Specs): boolean { return name in specs; }
line("index", given.numbers.map(indexed));
line("index minus one", given.numbers.map(indexedBelow));
line("index of a typed array", given.numbers.map(indexedBytes));
line("index of a string", given.numbers.map(character));
line("charCodeAt", given.numbers.map(characterAt));
line("reverse mapping", given.numbers.map(reverse));
line("keyof read", given.strings.map(keyed));
line("keyof read, built", built.map(keyed));
line("keyof in", given.strings.map(has));

function doubled(level: Level): number { return level * 2; }
function added(level: Level): number { return level + 2147483647; }
function shifted(level: Level): number { return 1 << level; }
function masked(flag: Flag): number { return flag & Flag.Write; }
function joined(flag: Flag): number { return flag | Flag.Read; }
function divided(level: Level): number { return 6 / level; }
function remainder(level: Level): number { return 7 % level; }
function negated(level: Level): number { return -level; }
function compared(level: Level): boolean { return level < 3 && level > 0; }
function counted(level: Level): number { let turns = 0; for (let i = 0; i < level && turns < 5; i++) turns++; return turns; }
function concatenated(name: Name): string { return name + name; }
function measured(name: Name): number { return name.length; }
function templated(name: Name, level: Level): string { return `${name}:${level}`; }
line("times two", given.numbers.map(doubled));
line("plus the largest int32", given.numbers.map(added));
line("shift", given.numbers.map(shifted));
line("and", given.numbers.map(masked));
line("or", given.numbers.map(joined));
line("divide", given.numbers.map(divided));
line("remainder", given.numbers.map(remainder));
line("negate", given.numbers.map(negated));
line("inside the list's range", given.numbers.map(compared));
line("loop bound", given.numbers.map(counted));
line("concatenate", given.strings.map(concatenated));
line("length", given.strings.map(measured));
line("template", given.strings.map((text, index) => templated(text, given.numbers[index])));

function whenTrue(on: true): string { return on ? "yes" : "no"; }
function whenFalse(off: false): string { if (off) return "yes"; return "no"; }
function inverted(on: true): boolean { return !on; }
function truthyName(name: Name): string { return name ? "text" : "empty"; }
function truthyLevel(level: Level): string { return level ? "some" : "none"; }
line("a condition on true", given.booleans.map(whenTrue));
line("a condition on false", given.booleans.map(whenFalse));
line("not true", given.booleans.map(inverted));
line("a string that is never empty", given.strings.map(truthyName));
line("a number that is never zero", given.numbers.map(truthyLevel));

class Holder { name: Name = "a"; level: Level = 1; on: true = true; step: Step = Step.Low; }
function throughFields(name: any, level: any, on: any): string {
  const holder = new Holder();
  holder.name = name; holder.level = level; holder.on = on; holder.step = level;
  return [switchedName(holder.name), holder.level * 2, holder.on ? "yes" : "no", Step[holder.step], holder.level === 1 || holder.level === 2].join("/");
}
line("fields", given.numbers.map((level, index) => throughFields(given.strings[index % given.strings.length], level, given.booleans[index % 2])));
const levels: Level[] = [];
for (const level of given.numbers) levels.push(level);
line("elements", levels.map(level => level * 2));
line("elements again", [levels.indexOf(1.5 as any), levels.includes(300 as any), levels.length, levels[5], Math.max(...levels.slice(0, 4))]);
const names: Name[] = [...built];
line("string elements", names.map(switchedName));
const byName = new Map<Name, Level>();
given.strings.forEach((text, index) => byName.set(text, given.numbers[index]));
line("map", [byName.size, byName.get("c" as any), byName.get("ab" as any), [...byName.keys()].join("")]);
const record: Record<Name, Level> = { a: 1, b: 2 };
for (const text of built) if (text !== "__proto__") record[text as Name] = given.numbers[5];
line("record", [Object.keys(record).join(), record.a, (record as any).c]);

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function area(shape: Shape): unknown { return shape.kind === "circle" ? shape.radius * 3 : shape.side * shape.side; }
function areaBySwitch(shape: Shape): unknown { switch (shape.kind) { case "circle": return shape.radius * 3; case "square": return shape.side * shape.side; } }
const shapes: any[] = JSON.parse('[{"kind":"circle","radius":1},{"kind":"square","side":2},{"kind":"line","radius":3,"side":4},{"kind":"circle","side":5},{"kind":"square","radius":6}]');
line("discriminant, parsed", shapes.map(area));
line("discriminant by switch, parsed", shapes.map(areaBySwitch));
function circleOf(kind: any): Shape { return { kind, radius: 2 }; }
function squareOf(kind: any): Shape { return { kind, side: 3 }; }
line("discriminant, created here", given.strings.slice(0, 3).concat("circle", "square").flatMap(kind => [area(circleOf(kind)), area(squareOf(kind)), areaBySwitch(circleOf(kind)), areaBySwitch(squareOf(kind))]));

function gives(value: any): Name { return value; }
function givesLevel(value: any): Level { return value; }
line("results", built.map(text => switchedName(gives(text))));
line("number results", given.numbers.map(level => givesLevel(level) * 2));
function optional(name?: Name): string { return name === undefined ? "none" : switchedName(name) + ""; }
line("optional", [optional(), optional(built[0]), optional(built[2])]);
function either(value: Name | Level): string { return typeof value === "string" ? switchedName(value) + "" : switchedLevel(value) + ""; }
line("strings or numbers", [...built.slice(0, 4), ...given.numbers.slice(0, 6)].map(either));

interface Item { name: Name; level: Level; on: true; step: Step; color: Color }
const itemsText = '[{"name":"a","level":1,"on":true,"step":1,"color":"a"},{"name":"c","level":7.5,"on":false,"step":9,"color":"green"},{"name":"","level":-0,"on":true,"step":4294967297,"color":"b"}]';
function showItem(item: Item): string { return [switchedName(item.name), item.level * 2, item.on ? "yes" : "no", Step[item.step], switchedColor(item.color), JSON.stringify(item)].join("/"); }
line("parsed and cast", (JSON.parse(itemsText) as Item[]).map(showItem));
const annotated: Item[] = JSON.parse(itemsText);
line("parsed into an annotation", annotated.map(showItem));
const shapesText = '[{"kind":"circle","radius":1},{"kind":"square","side":2},{"kind":"line","radius":3,"side":4},{"kind":"circle","side":5},{"kind":"","radius":6}]';
line("a parsed union", (JSON.parse(shapesText) as Shape[]).map(shape => area(shape) + "/" + areaBySwitch(shape) + "/" + JSON.stringify(shape)));
line("one parsed literal", [JSON.parse('"c"') as Name, JSON.parse("7.5") as Level, JSON.parse("false") as true].map(value => typeof value + ":" + value));
line("copies", annotated.map(item => showItem({ ...item })).concat(annotated.map(item => showItem(structuredClone(item)))));

interface Tagged { tag: "only"; zero: 0; yes: true; none: null; big: 1n }
function readTagged(t: Tagged): string { return [t.tag, t.zero, t.yes, t.none, t.big, t.tag === "only", t.zero === 0, t.zero + 1, t.tag.length, `${t.tag}${t.zero}`, JSON.stringify({ tag: t.tag, zero: t.zero, yes: t.yes })].join("/"); }
function makeTagged(tag: any, zero: any, yes: any, big: any): Tagged { return { tag, zero, yes, none: null, big }; }
line("one literal each", [makeTagged("only", 0, true, 1n), makeTagged(built[2], given.numbers[5], given.booleans[1], 7n), makeTagged("", -0, false, 0n)].map(readTagged));
line("serialized", [circleOf(built[2]), squareOf("line"), circleOf("circle")].map(shape => JSON.stringify(shape)).concat(annotated.map(item => JSON.stringify(item))));
function onlyTag(tag: "only"): string { return tag; }
function onlyZero(zero: 0): number { return zero; }
line("one literal as a parameter", [onlyTag(built[2]), onlyTag(built[0]), onlyZero(given.numbers[5]), onlyZero(given.numbers[6]), onlyZero(given.numbers[7])]);
const constant: "only" = built[3];
let counter: 0 = given.numbers[0];
line("one literal as a variable", [constant, constant === "only", counter, counter === 0, counter + 1]);
