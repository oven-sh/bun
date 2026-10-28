// Tests on `number | undefined` and `number | null | undefined` values read from optional fields: typeof, truthiness, ??, === undefined, === null. An absent field, a field that holds undefined, NaN, zero and negative zero must all answer as in JavaScript.
// SIZE< typeIsNumber 32
// SIZE< typeIsUndefined 32
// SIZE< truthy 40
// SIZE< orDefault 32
type Options = { name: string; limit?: number; count?: number | null; whole?: number };
function typeIsNumber(options: Options): boolean { return typeof options.limit === "number"; }
function typeIsUndefined(options: Options): boolean { return typeof options.limit === "undefined"; }
function typeIsObject(options: Options): boolean { return typeof options.count === "object"; }
function typeIsString(options: Options): boolean { return typeof options.limit === "string"; }
function nullableTypeIsNumber(options: Options): boolean { return typeof options.count === "number"; }
function nullableTypeIsUndefined(options: Options): boolean { return typeof options.count === "undefined"; }
function isUndefined(options: Options): boolean { return options.limit === undefined; }
function isNotUndefined(options: Options): boolean { return options.limit !== undefined; }
function nullableIsUndefined(options: Options): boolean { return options.count === undefined; }
function nullableIsNull(options: Options): boolean { return options.count === null; }
function looselyNull(options: Options): boolean { return options.count == null; }
function truthy(options: Options): number { return options.limit ? 1 : 2; }
function nullableTruthy(options: Options): number { return options.count ? 1 : 2; }
function orDefault(options: Options): number { return options.limit ?? 7; }
function nullableOrDefault(options: Options): number { return options.count ?? 7; }
function orFallback(options: Options): number { return options.limit || 9; }
function addOne(options: Options): number { return options.limit === undefined ? -1 : options.limit + 1; }
function handedOn(options: Options): number | undefined { return options.limit; }
function copied(options: Options): Options { const made: Options = { name: "copy" }; made.limit = options.limit; return made; }
function wholeIsNumber(options: Options): boolean { return typeof options.whole === "number"; }
function wholeOrDefault(options: Options): number { return (options.whole ?? 5) | 0; }
const tests: ((options: Options) => unknown)[] = [typeIsNumber, typeIsUndefined, typeIsObject, typeIsString, nullableTypeIsNumber, nullableTypeIsUndefined, isUndefined, isNotUndefined, nullableIsUndefined, nullableIsNull, looselyNull, truthy, nullableTruthy, orDefault, nullableOrDefault, orFallback, addOne, handedOn, wholeIsNumber, wholeOrDefault];
const all: Options[] = [
  { name: "absent" },
  { name: "undefined", limit: undefined, count: undefined, whole: undefined },
  { name: "null", count: null },
  { name: "zero", limit: 0, count: 0, whole: 0 },
  { name: "negative zero", limit: -0, count: -0 },
  { name: "NaN", limit: NaN, count: NaN },
  { name: "fraction", limit: 0.5, count: -2.5 },
  { name: "integer", limit: 3, count: 4, whole: 5 },
  { name: "infinity", limit: Infinity, count: -Infinity },
  { name: "large", limit: 1e300, count: 4294967296, whole: 2147483647 },
];
const late: Options = { name: "late" };
late.limit = 1.5;
late.count = null;
all.push(late);
const removed: Options = { name: "removed", limit: 2, count: 3 };
delete removed.limit;
delete removed.count;
all.push(removed);
for (const options of all) {
  const answers: string[] = [];
  for (const test of tests) answers.push(String(test(options)));
  const copy = copied(options);
  console.log(options.name, answers.join(), Object.keys(copy).join(), "limit" in copy, String(copy.limit));
}
let total = 0;
for (let round = 0; round < 40000; round++) {
  const options = all[round % all.length];
  if (options === undefined) continue;
  total += (typeIsNumber(options) ? 1 : 0) + (isUndefined(options) ? 2 : 0) + truthy(options) + (orDefault(options) > 1 ? 1 : 0) + (nullableIsNull(options) ? 4 : 0) + nullableTruthy(options);
}
console.log(total);
