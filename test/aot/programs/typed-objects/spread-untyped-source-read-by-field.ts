declare const aotOperationCount: (name: string) => number;
type Mark = { pos: number; size: number; note: string; done: boolean; extra: unknown };

function sampleMark(): Mark {
  return { pos: 0, size: 1.5, note: "sample", done: false, extra: null };
}

function totalOfMoved(marks: readonly Mark[], by: number, kept: unknown[]): number {
  const moved = marks.map(mark => ({ ...mark, pos: mark.pos + by }));
  let total = 0;
  for (const mark of moved) {
    total += mark.pos + mark.size + mark.note.length + (mark.done ? 1 : 0) + (mark.extra === null ? 1 : 0);
    kept.push(mark);
  }
  return total;
}

function totalOfMovedAndResized(marks: readonly Mark[], by: number, size: number, kept: unknown[]): number {
  const moved = marks.map(mark => ({ ...mark, size, pos: mark.pos + by }));
  let total = 0;
  for (const mark of moved) {
    total += mark.pos + mark.size + mark.note.length + (mark.done ? 1 : 0);
    kept.push(mark);
  }
  return total;
}

function totalOfPositions(marks: readonly Mark[], by: number, kept: unknown[]): number {
  const moved = marks.map(mark => ({ ...mark, pos: mark.pos + by }));
  let total = 0;
  for (const mark of moved) {
    total += mark.pos;
    kept.push(mark);
  }
  return total;
}

function show(label: string, marks: Mark[], conversions: number, totals: string, kept: unknown[]): void {
  console.log(label + ": " + totals + ": " + conversions + " conversions by the runtime");
  for (let i = 0; i < kept.length; i++) {
    const copy = kept[i] as Record<string, unknown>;
    const source = marks[i % marks.length] as unknown as Record<string, unknown>;
    console.log("  " + JSON.stringify(copy) + " | " + Object.keys(copy).join() + " | " + Object.is(copy.pos, -0) + " " + Object.is(copy.size, -0) + " " + (Object.getPrototypeOf(copy) === Object.prototype) + " " + (copy !== source) + " " + (copy.extra === source.extra) + " " + Object.isFrozen(copy) + " " + Object.getOwnPropertySymbols(copy).length);
    copy.note = "written";
    copy.added = 1;
    console.log("  " + JSON.stringify(copy));
  }
  console.log("  " + JSON.stringify(marks));
}

function reportRead(label: string, text: string): void {
  const marks: Mark[] = JSON.parse(text);
  const kept: unknown[] = [];
  const before = aotOperationCount("operationAOTEnforceType");
  const totals = totalOfMoved(marks, 1, kept) + " " + totalOfMovedAndResized(marks, 2, 7, kept);
  show(label, marks, aotOperationCount("operationAOTEnforceType") - before, totals, kept);
}

function showPositionsOnly(label: string, marks: Mark[]): void {
  const kept: unknown[] = [];
  const before = aotOperationCount("operationAOTEnforceType");
  const total = totalOfPositions(marks, 1, kept);
  show(label, marks, aotOperationCount("operationAOTEnforceType") - before, String(total), kept);
}

const parsed = (text: string): Mark[] => {
  const marks: Mark[] = JSON.parse(text);
  return marks;
};
const changed = (change: (mark: any) => void): Mark[] => {
  const marks = parsed('[{"pos":1,"size":2,"note":"n","done":true,"extra":0}]');
  change(marks[0]);
  return marks;
};

console.log(JSON.stringify(sampleMark()));
reportRead("matching data", '[{"pos":1,"size":2,"note":"one","done":true,"extra":[1]},{"pos":2,"size":2.5,"note":"two","done":false,"extra":{"a":1}}]');
reportRead("matching data in another key order", '[{"extra":"x","done":true,"note":"one","size":2,"pos":1}]');
reportRead("numbers at the edges", '[{"pos":-1,"size":-0,"note":"","done":false,"extra":-0},{"pos":1073741822,"size":1073741824,"note":"n","done":true,"extra":1e300},{"pos":-1073741825,"size":-1073741825,"note":"n","done":true,"extra":2147483648},{"pos":2147483646,"size":-2147483648,"note":"n","done":true,"extra":null}]');
reportRead("a property the type does not have", '[{"pos":1,"size":2,"note":"n","done":true,"extra":0,"more":1}]');
reportRead("an index among the properties", '[{"pos":1,"size":2,"note":"n","done":true,"extra":0,"0":1}]');
reportRead("more properties than fit in the object", '[{"pos":1,"size":2,"note":"n","done":true,"extra":0,"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10}]');
showPositionsOnly("the stored field is missing in the source", parsed('[{"size":2,"note":"one","done":true,"extra":0}]'));
showPositionsOnly("a required field is missing", parsed('[{"pos":1,"size":2,"done":true,"extra":0}]'));
showPositionsOnly("a number where a string belongs", parsed('[{"pos":1,"size":2,"note":3,"done":true,"extra":0}]'));
showPositionsOnly("a string where a number belongs", parsed('[{"pos":1,"size":"2","note":"n","done":true,"extra":0}]'));
showPositionsOnly("a number where a boolean belongs", parsed('[{"pos":1,"size":2,"note":"n","done":1,"extra":0}]'));
showPositionsOnly("null where a string, a number and a boolean belong", parsed('[{"pos":1,"size":null,"note":null,"done":null,"extra":null}]'));
let reads = 0;
showPositionsOnly("a getter", changed(mark => Object.defineProperty(mark, "size", { get() { return ++reads; }, enumerable: true, configurable: true })));
showPositionsOnly("a property that is not enumerable", changed(mark => Object.defineProperty(mark, "note", { enumerable: false })));
showPositionsOnly("a property that is not writable", changed(mark => Object.defineProperty(mark, "note", { writable: false })));
showPositionsOnly("a frozen source", changed(mark => Object.freeze(mark)));
showPositionsOnly("a source that cannot be extended", changed(mark => Object.preventExtensions(mark)));
showPositionsOnly("a source with another prototype", changed(mark => Object.setPrototypeOf(mark, { inherited: 1 })));
showPositionsOnly("a source without a prototype", changed(mark => Object.setPrototypeOf(mark, null)));
showPositionsOnly("a symbol among the keys", changed(mark => { mark[Symbol.iterator] = 1; }));
showPositionsOnly("a property deleted and added again", changed(mark => { delete mark.size; mark.size = 3; }));
console.log(reads);

const many = parsed("[" + Array.from({ length: 300 }, (_, i) => '{"pos":' + i + ',"size":' + (i + 0.5) + ',"note":"n' + i + '","done":' + (i % 2 === 0) + ',"extra":[' + i + "]}").join() + "]");
let total = 0;
const beforeMany = aotOperationCount("operationAOTEnforceType");
for (let round = 0; round < 40; round++) total += totalOfMoved(many, round, []);
console.log("12,000 copies: " + total + ": " + (aotOperationCount("operationAOTEnforceType") - beforeMany) + " conversions by the runtime");
