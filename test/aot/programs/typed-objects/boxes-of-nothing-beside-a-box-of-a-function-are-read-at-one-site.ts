// One site reads `value` from boxes of undefined, null, a function, a bigint, an array, a string and a number. The box of a function may keep its closure unmade until it is read,
// and such a slot holds neither undefined nor null. The slots of the other boxes are ordinary ones: what they hold has to come out as it is.
interface Box<T> {
  value: T;
}
const nothing: Box<undefined> = { value: undefined };
const nil: Box<null> = { value: null };
const thunk: Box<() => number> = { value: () => 42 };
const other: Box<() => number> = { value: () => 7 };
const big: Box<bigint> = { value: 12345678901234567890n };
const list: Box<number[]> = { value: [1, 2] };
const word: Box<string> = { value: "word" };
const count: Box<number> = { value: 1.5 };
const all: Box<unknown>[] = [nothing, nil, thunk, big, list, word, count, other, nil, nothing];

console.log(all.map(b => typeof b.value).join());
console.log(all.map(b => (typeof b.value === "function" ? (b.value as () => number)() : String(b.value))).join("|"));
console.log(all.map(b => b.value === undefined).join(), all.map(b => b.value === null).join());
console.log(all.map(b => b.value == null).join(), all.map(b => !!b.value).join());
console.log(all.map(b => (Array.isArray(b.value) ? b.value.length : typeof b.value === "bigint" ? "big" : -1)).join());
console.log(all.map(b => "value" in b).join(), all.map(b => Object.keys(b).join()).join());

function describe(b: Box<unknown>): string {
  const v = b.value;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "function") return "function " + v();
  if (typeof v === "object") return "object " + JSON.stringify(v);
  return typeof v + " " + String(v);
}
let text = "";
for (let round = 0; round < 300; round++) text = all.map(describe).join(";");
console.log(text);

// Only boxes of nothing and of functions.
const few: Box<(() => number) | undefined | null>[] = [{ value: undefined }, { value: () => 1 }, { value: null }, { value: () => 2 }];
console.log(few.map(b => (b.value ? b.value() : String(b.value))).join(), few.map(b => typeof b.value).join());
few[0].value = () => 3;
few[1].value = undefined;
few[3].value = null;
console.log(few.map(b => (b.value ? b.value() : String(b.value))).join(), few.map(b => typeof b.value).join());

// The same with objects of different shapes, which have a layout each whatever the type of `value` is.
interface HasValue {
  value: unknown;
}
const shapedNothing = { value: undefined, a: 1 };
const shapedNil = { value: null, b: 2 };
const shapedThunk = { value: () => 42, c: 3 };
const shapedBig = { value: 12345678901234567890n, d: 4 };
const shapedList = { value: [1, 2], e: 5 };
const shapedWord = { value: "word", f: 6 };
const shaped: HasValue[] = [shapedNothing, shapedNil, shapedThunk, shapedBig, shapedList, shapedWord, shapedNil, shapedNothing];
console.log(shaped.map(b => typeof b.value).join());
console.log(shaped.map(b => (typeof b.value === "function" ? (b.value as () => number)() : String(b.value))).join("|"));
function describeShaped(b: HasValue): string {
  const v = b.value;
  if (typeof v === "bigint") return "big";
  if (typeof v === "function") return "function " + v();
  if (typeof v === "string") return "string " + v.length;
  if (Array.isArray(v)) return "array " + v.length;
  return String(v);
}
for (let round = 0; round < 300; round++) text = shaped.map(describeShaped).join(";");
console.log(text);
