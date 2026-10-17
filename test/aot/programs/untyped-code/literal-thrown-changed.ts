// A literal that is thrown has no written type, so whoever catches it may replace its members with other kinds of values.
function fail(): never {
  throw { count: 1, more: { n: 1, extra: "e" } };
}
let caught: any;
try {
  fail();
} catch (e) {
  caught = e;
}
caught.more = { n: 2 };
caught.count = "many";
console.log(caught.more.n, caught.more.extra, caught.count, JSON.stringify(caught));
const named = { count: 2, more: { n: 2, extra: "f" } };
try {
  throw named;
} catch (e: any) {
  e.more = { n: 3 };
  e.count = "many";
}
console.log(named.more.n, named.more.extra, String(named.count), JSON.stringify(named));
