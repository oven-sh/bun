// A constant of the module whose initializer folds to a primitive is that primitive in every function that reads it, and a read in its dead zone still throws.
const out: unknown[] = [];

function early(): string {
  return `${LATE}!`;
}
try {
  out.push(early());
} catch (error) {
  out.push((error as Error).name);
}
const LATE = `${"l"}${"ate"}`;
out.push(early());

const PREFIX = `${"ab"}${"+"}`;
const COUNT = 2 + 3;
const FLAG = "x".length === 1;
function pattern(): RegExp {
  return new RegExp(`^${PREFIX}c{${COUNT}}$`, FLAG ? "i" : "");
}
out.push(pattern().source, pattern().flags, pattern().test("ABBCCCCC"), pattern().test("abc"));

// Stored more than once, or with a value that only the running program knows: no constant.
let changed = `${"a"}${"b"}`;
function readChanged(): string {
  return `${changed}?`;
}
out.push(readChanged());
changed = `${"c"}${"d"}`;
out.push(readChanged());

const FROM_OUTSIDE = `${Date.now() > 0 ? "after" : "before"}-1970`;
function readFromOutside(): string {
  return `${FROM_OUTSIDE}.`;
}
out.push(readFromOutside());

// One of two stores runs.
let either: string;
if (Date.now() > 0) either = `${"fir"}${"st"}`;
else either = `${"sec"}${"ond"}`;
function readEither(): string {
  return `${either};`;
}
out.push(readEither());

console.log(out.map(String).join(" | "));
