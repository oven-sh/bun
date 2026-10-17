// Subclasses of Date that override `valueOf`, `getTime` or `Symbol.toPrimitive`.
const seen = [];

class Stamp extends Date {
  valueOf() {
    seen.push("Stamp.valueOf");
    return 5;
  }
}

class Plain extends Date {
}
function withValueOf(t, v) {
  const d = new Date(t);
  d.valueOf = () => {
    seen.push("own valueOf");
    return v;
  };
  return d;
}
function withToPrimitive(t, v) {
  const d = new Date(t);
  Object.defineProperty(d, Symbol.toPrimitive, { value: (hint) => {
    seen.push("own toPrimitive " + hint);
    return v;
  } });
  return d;
}
function withPrototype(t) {
  const d = new Date(t);
  Object.setPrototypeOf(d, { valueOf() {
    seen.push("other valueOf");
    return 77;
  }, toString() {
    return "other";
  } });
  return d;
}
function withProperty(t) {
  const d = new Date(t);
  d.extra = 1;
  return d;
}
const dates = [new Date(0), new Date(1000), new Date(1000), new Date(NaN), new Date(-1), new Stamp(9), new Plain(3), withValueOf(1, 2000), withValueOf(1, "zz"), withValueOf(1, {}), withToPrimitive(1, 500), withToPrimitive(1, "a"), withPrototype(4), withProperty(6), Object.freeze(new Date(8))];
const names = ["0", "1000", "1000 again", "invalid", "-1", "a subclass with valueOf", "a plain subclass", "own valueOf 2000", "own valueOf zz", "own valueOf {}", "own toPrimitive 500", "own toPrimitive a", "another prototype", "an extra property", "frozen", "beyond the end", "beyond the end too"];
function show(f) {
  seen.length = 0;
  let r;
  try {
    const v = f();
    r = typeof v + ":" + String(v);
  } catch (e) {
    r = "throws " + e.name;
  }
  return r + (seen.length ? " after " + seen.join() : "");
}
function plus(d) {
  return +d;
}
function less(a, b) {
  return a < b;
}
function lessEq(a, b) {
  return a <= b;
}
function greater(a, b) {
  return a > b;
}
function greaterEq(a, b) {
  return a >= b;
}
let rows = 0;
for (let turn = 0;turn < 2; turn++) {
  for (let i = 0;i < 17; i++) {
    rows++;
    console.log("+ " + names[i] + " -> " + show(() => +dates[i]) + " | " + show(() => plus(dates[i])) + " | Number() " + show(() => Number(dates[i])));
    for (let j = 0;j < 17; j++) {
      rows++;
      console.log(names[i] + " ? " + names[j] + " -> < " + show(() => dates[i] < dates[j]) + " | <= " + show(() => lessEq(dates[i], dates[j])) + " | > " + show(() => dates[i] > dates[j]) + " | >= " + show(() => greaterEq(dates[i], dates[j])) + " | " + show(() => less(dates[i], dates[j])) + " | " + show(() => greater(dates[i], dates[j])));
    }
  }
}
function watched(i, j) {
  try {
    return String(+dates[i]) + (dates[i] < dates[j]);
  } catch (e) {
    return "caught " + e.name;
  } finally {
    seen.push("finally");
  }
}
for (const [i, j] of [[0, 1], [9, 0], [0, 9], [16, 16], [5, 7]])
  console.log("watched " + i + " " + j + " -> " + show(() => watched(i, j)));
console.log(rows + " rows");
