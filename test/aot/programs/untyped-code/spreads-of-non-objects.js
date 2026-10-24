// Spreads of values that are no objects, written so that the compiler sees the constant: `...(c ? x : undefined)`, `...(c && x)`, `...null`, numbers, booleans, bigints, symbols; strings do have properties.
const show = value => JSON.stringify(value);
const r = { p: 1, q: 2 };
function orUndefined(c, i) { return { ...(c ? r : undefined), g: i }; }
function orNull(c, i) { return { g: i, ...(c ? r : null) }; }
function andObject(c, i) { return { g: i, ...(c && r), h: i }; }
function orFalse(c, i) { return { ...(c ? r : false), ...(c ? false : r), g: i }; }
function orNumber(c, i) { return { ...(c ? r : 0), g: i, ...(c ? r : 5.5), ...(c ? r : NaN) }; }
function orString(c, i) { return { ...(c ? r : "ab"), g: i, ...(c ? r : "") }; }
function orBigInt(c, i) { return { ...(c ? r : 10n), g: i }; }
function orSymbol(c, i) { return { ...(c ? r : Symbol.iterator), g: i }; }
function constants(i) { return { ...undefined, ...null, ...true, ...false, ...1, ...1.5, ..."xy", ...2n, g: i }; }
function onlyNothing() { return { ...undefined }; }
function inTry(c, i) { try { return { g: i, ...(c ? r : undefined), h: i }; } catch (e) { return e.name; } }
function nested(c, i) { return { a: { ...(c ? r : undefined) }, b: [{ ...(c && r), i }] }; }
function assign(c, i) { return Object.assign({ g: i }, c ? r : undefined, c ? null : r, 5, true); }
function restOf(c) { const { p, ...others } = c ? r : {}; return { ...others, ...(c ? undefined : others), p }; }
for (const c of [true, false, 0, 1, "", "s", null, undefined]) {
  for (const [name, f] of Object.entries({ orUndefined, orNull, andObject, orFalse, orNumber, orString, orBigInt, orSymbol, inTry, nested, assign }))
    console.log(name, show(c), show(f(c, 7)), Object.keys(f(c, 7)).join());
  console.log("restOf", show(c), show(restOf(c)));
}
console.log(show(constants(1)), show(onlyNothing()), Object.getPrototypeOf(onlyNothing()) === Object.prototype, onlyNothing() !== onlyNothing());
let sum = 0; for (let i = 0; i < 100000; i++) sum += orUndefined(i & 1, i).g + Object.keys(andObject(i & 2, i)).length + Object.keys(orFalse(i & 4, i)).length; console.log(sum);
