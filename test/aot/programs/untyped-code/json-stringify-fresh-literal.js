// JSON.stringify of a fresh plain object literal is serialized from the values it was created with, and the object is only created on the slow path. Any other use of the object, and any mutation before the call, must still be observed.
function direct(name, sides) { return JSON.stringify({ name, sides }); }
function named(name, sides) { const row = { name, sides }; return JSON.stringify(row); }
function nested(name, sides) { return JSON.stringify({ first: { name, sides }, second: null, list: [sides, name] }); }
function changed(name, sides) { const row = { name, sides }; row.sides = sides + 1; return JSON.stringify(row); }
function grown(name, sides) { const row = { name, sides }; row.label = "late"; return JSON.stringify(row); }
function shrunk(name, sides) { const row = { name, sides, label: "early" }; delete row.label; return JSON.stringify(row); }
function touch(row) { row.name = row.name + "!"; }
function handedOn(name, sides) { const row = { name, sides }; touch(row); return JSON.stringify(row); }
function twice(name, sides) { const row = { name, sides }; return JSON.stringify(row) + JSON.stringify(row); }
function usedAfter(name, sides) { const row = { name, sides }; const text = JSON.stringify(row); return text + Object.keys(row).length; }
function usedInAnotherBlock(name, sides) { const row = { name, sides }; const text = JSON.stringify(row); if (sides > 2) return text + row.name; return text; }
function returned(name, sides) { const row = { name, sides }; kept = JSON.stringify(row); return row; }
function undefinedMember(name, sides) { return JSON.stringify({ name, next: undefined, sides, label: undefined }); }
function withGetter(name, sides) { return JSON.stringify({ name, get sides() { return sides * 2; } }); }
function withToJSON(name, sides) { return JSON.stringify({ name, sides, toJSON() { return "by toJSON " + name; } }); }
function withFunction(name, sides) { return JSON.stringify({ name, sides, call() { return 1; } }); }
function withSymbol(name, sides) { return JSON.stringify({ name, sides, mark: Symbol.iterator }); }
function withBigInt(name, sides) { try { return JSON.stringify({ name, sides, big: 1n }); } catch (error) { return error.constructor.name; } }
function indented(name, sides) { return JSON.stringify({ name, sides }, null, 1); }
function inTry(name, sides) { try { return JSON.stringify({ name, sides }); } catch { return "caught"; } }
function sharedInner(name, sides) { const inner = { name, sides }; return JSON.stringify({ first: inner, second: inner }); }
let escaped;
function innerEscapes(name, sides) { const inner = { name, sides }; escaped = inner; return JSON.stringify({ inner }) + (escaped === inner); }
function innerReadLater(name, sides) { const inner = { name, sides }; const text = JSON.stringify({ inner }); return text + inner.name; }
function threeLevels(name, sides) { return JSON.stringify({ a: { b: { name, sides }, sides }, name }); }
function fourLevels(name, sides) { return JSON.stringify({ a: { b: { c: { name, sides }, sides }, name }, sides }); }
function outerEscapes(name, sides) { const outer = { inner: { name, sides } }; const text = JSON.stringify(outer); return text + outer.inner.sides; }
function siblings(name, sides) { return JSON.stringify({ first: { name, sides }, second: { name: name + "2", sides: sides + 1 }, third: { label: name } }); }
let kept = "";
const writers = [direct, named, nested, changed, grown, shrunk, handedOn, twice, usedAfter, usedInAnotherBlock, undefinedMember, withGetter, withToJSON, withFunction, withSymbol, withBigInt, indented, inTry, sharedInner, innerEscapes, innerReadLater, threeLevels, fourLevels, outerEscapes, siblings];
const names = ["plain", "", 'quo"te', "line\nbreak", "é世😀", "\ud800", "a".repeat(300), 7, null, undefined, true, { inner: 1 }, [1, 2]];
const numbers = [0, -0, 1, 3, 2.5, -7, 1e21, 1e-7, NaN, Infinity, 2147483648, "text", null, undefined];
for (const write of writers) {
  for (const name of names) console.log(write(name, 3));
  for (const sides of numbers) console.log(write("n", sides));
}
const row = returned("r", 1);
console.log(kept, row.name, row.sides);
let total = 0;
for (let round = 0; round < 30000; round++) total += writers[round % writers.length]("r" + (round & 15), round / 4).length;
console.log(total);
