type Make = () => string;

function fromUnits(units: number[]): string {
  return String.fromCharCode(...units);
}

function flatten(text: string): string {
  Symbol(text);
  return text;
}

function unitsOf(text: string | undefined): string {
  if (text === undefined) return "undefined";
  let units = "[";
  for (let i = 0; i < text.length; i++) units += (i ? " " : "") + text.charCodeAt(i).toString(16);
  return units + "]";
}

const narrowUnits: number[] = [];
for (let i = 0; i < 48; i++) narrowUnits.push(i % 11 === 10 ? 0xe9 : 0x61 + (i % 26));
const narrowTailUnits: number[] = [];
for (let i = 0; i < 40; i++) narrowTailUnits.push(0x30 + (i % 10));

const loneTrail = 0xdc00;
const loneLead = 0xd800;
const lead = 0xd83d;
const trail = 0xde00;
const wideUnits: number[] = [loneTrail, 0x61, lead, trail, 0x4e00, 0xe9, lead, 0x62];
for (let i = 0; i < 30; i++) wideUnits.push(i % 7 === 6 ? 0x3042 + i : 0x41 + i);
wideUnits.push(lead, trail, 0x7a, lead);
const wideTailUnits: number[] = [trail, 0x63, 0x4e8c];
for (let i = 0; i < 30; i++) wideTailUnits.push(0x0391 + i);
wideTailUnits.push(loneLead);

const makers: [string, Make][] = [
  ["flat 8-bit", () => fromUnits(narrowUnits)],
  ["flat 16-bit", () => fromUnits(wideUnits)],
  ["rope 8-bit", () => fromUnits(narrowUnits) + fromUnits(narrowTailUnits)],
  ["rope 16-bit", () => fromUnits(wideUnits) + fromUnits(wideTailUnits)],
  ["rope 8-bit then 16-bit", () => fromUnits(narrowUnits) + fromUnits(wideTailUnits)],
  ["rope 16-bit then 8-bit", () => fromUnits(wideUnits) + fromUnits(narrowUnits)],
  ["rope of three", () => fromUnits(narrowUnits) + fromUnits(wideUnits) + fromUnits(wideTailUnits)],
  ["rope of ropes", () => fromUnits(narrowUnits) + fromUnits(narrowTailUnits) + (fromUnits(wideUnits) + fromUnits(wideTailUnits))],
  ["substring 8-bit", () => fromUnits(narrowUnits).slice(3, 40)],
  ["substring 16-bit", () => fromUnits(wideUnits).slice(3, wideUnits.length - 2)],
  ["substring 16-bit with Latin-1 units only", () => fromUnits(wideUnits).slice(8, 14)],
  ["substring of a substring 8-bit", () => fromUnits(narrowUnits).slice(2, 44).slice(5, 30)],
  ["substring of a substring 16-bit", () => fromUnits(wideUnits).slice(1, 40).slice(1, 20)],
  ["substring of a rope", () => (fromUnits(narrowUnits) + fromUnits(wideTailUnits)).slice(40, 60)],
  ["substring across a surrogate pair of a rope", () => (fromUnits(wideUnits) + fromUnits(wideTailUnits)).slice(wideUnits.length - 1, wideUnits.length + 1)],
  ["substring of one 8-bit unit", () => fromUnits(narrowUnits).slice(10, 11)],
  ["substring of one 16-bit unit", () => fromUnits(wideUnits).slice(2, 3)],
  ["empty substring", () => fromUnits(wideUnits).slice(5, 5)],
];

function indexesOf(text: string): number[] {
  return [-1, 0, text.length - 1, text.length, NaN, 1e20];
}

function readsOfFreshStrings(make: Make, index: number): string {
  return [
    make().charCodeAt(index),
    make().codePointAt(index),
    unitsOf(make().at(index)),
    unitsOf(make()[index]),
    unitsOf(make().slice(index)),
    unitsOf(make().slice(0, index)),
    unitsOf(make().slice(index, index + 2)),
  ].join(" ");
}

function readsOfOneString(text: string, index: number): string {
  return [
    text.charCodeAt(index),
    text.codePointAt(index),
    unitsOf(text.at(index)),
    unitsOf(text[index]),
    unitsOf(text.slice(index)),
    unitsOf(text.slice(0, index)),
    unitsOf(text.slice(index, index + 2)),
  ].join(" ");
}

function readsAtEveryIndex(text: string): string {
  let unitSum = 0;
  let pointSum = 0;
  let fromEnd = "";
  let elements = "";
  let pairs = 0;
  for (let i = 0; i < text.length; i++) {
    unitSum += text.charCodeAt(i);
    pointSum += text.codePointAt(i) ?? -1;
    fromEnd += text.at(-1 - i);
    elements += text[i];
    pairs += text.slice(i, i + 2).length;
  }
  return [unitSum, pointSum, unitsOf(fromEnd), elements === text, pairs].join(" ");
}

function describe(text: string): string {
  const lines = [text.length + " " + readsAtEveryIndex(text)];
  for (const index of indexesOf(text)) lines.push(readsOfOneString(text, index));
  return lines.join("\n");
}

for (const [name, make] of makers) {
  console.log(name);
  for (const index of indexesOf(make())) {
    const fresh = readsOfFreshStrings(make, index);
    console.log(index, fresh, fresh === readsOfOneString(make(), index));
  }
  console.log(readsAtEveryIndex(make()));
}

function readsAroundKeyUse(text: string, table: Record<string, number>): string {
  const last = text.length - 1;
  const before = [text.charCodeAt(0), text.charCodeAt(last), text.codePointAt(1), unitsOf(text.at(-1)), unitsOf(text[1]), unitsOf(text.slice(1, 4))].join(" ");
  table[text] = last;
  const after = [text.charCodeAt(0), text.charCodeAt(last), text.codePointAt(1), unitsOf(text.at(-1)), unitsOf(text[1]), unitsOf(text.slice(1, 4))].join(" ");
  return [before === after, table[text], after].join(" ");
}

function sumWithKeyUseInLoop(text: string, table: Record<string, number>): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i);
    if (i === 2) table[text] = i;
    sum += text.codePointAt(i) ?? 0;
  }
  return sum;
}

console.log("used as a property key between reads");
for (const [name, make] of makers) {
  if (!make().length) continue;
  console.log(name, readsAroundKeyUse(make(), {}), readsAroundKeyUse(flatten(make()), {}), sumWithKeyUseInLoop(make(), {}), sumWithKeyUseInLoop(flatten(make()), {}));
}

function keyUnits(seed: number): number[] {
  const units: number[] = [];
  for (let i = 0; i < 12; i++) units.push(0x61 + ((i * 7 + seed) % 26));
  return units;
}

function substringOfBaseNarrowedTo8Bit(units: number[], table: Record<string, number>): string {
  table[fromUnits(units)] = 1;
  const base = flatten(flatten(fromUnits([...units, 0x4e00])).slice(0, units.length));
  const part = base.slice(1, 9);
  if (table[base] !== 1) throw new Error("the base is not a key of the table");
  return part;
}

function substringOfBaseWidenedTo16Bit(units: number[], table: Record<string, number>): string {
  table[flatten(flatten(fromUnits([...units, 0x4e00])).slice(0, units.length))] = 1;
  const base = fromUnits(units);
  const part = base.slice(1, 9);
  if (table[base] !== 1) throw new Error("the base is not a key of the table");
  return part;
}

console.log("substrings of a base whose characters changed width");
for (let seed = 0; seed < 4; seed++) {
  const expected = describe(fromUnits(keyUnits(seed).slice(1, 9)));
  console.log(seed, describe(substringOfBaseNarrowedTo8Bit(keyUnits(seed), {})) === expected, describe(substringOfBaseWidenedTo16Bit(keyUnits(seed + 13), {})) === describe(fromUnits(keyUnits(seed + 13).slice(1, 9))));
  console.log(expected);
}

function sumWithCollectionInLoop(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    if (i === 3) Bun.gc(true);
    sum += text.charCodeAt(i) + (text.codePointAt(i) ?? 0);
  }
  return sum;
}

function sumWithoutCollection(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i) + (text.codePointAt(i) ?? 0);
  return sum;
}

console.log("after a collection");
const retained = makers.map(([, make]) => make());
Bun.gc(true);
for (let i = 0; i < makers.length; i++) {
  const [name, make] = makers[i];
  const first = describe(retained[i]);
  Bun.gc(true);
  console.log(name, first === describe(make()), describe(retained[i]) === first, sumWithCollectionInLoop(make()) === sumWithoutCollection(make()));
}
