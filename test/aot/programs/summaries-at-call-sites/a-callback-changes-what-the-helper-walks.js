// While a helper walks what one caller passed, the callback changes it: other kinds of elements, a shorter array, a getter in place of an element, the helper called again from inside.
function each(array, callback) {
  let count = 0;
  for (let i = 0; i < array.length; i++) {
    callback(array[i], i, array);
    count++;
  }
  return count;
}
function findLast(array, predicate) {
  let found;
  for (let i = 0; i < array.length; i++) if (predicate(array[i])) found = array[i];
  return found;
}
class Point {
  constructor(x) {
    this.x = x;
  }
}
const lines = [];
const points = [new Point(1), new Point(2)];
lines.push(each(points, (p, i, all) => {
  if (i === 0) all.push("text", 3.5, null, { x: "other" });
  lines.push(typeof p + " " + (p === null ? "null" : p.x));
}));
const shrinking = [new Point(1), new Point(2), new Point(3), new Point(4)];
lines.push(each(shrinking, (p, i, all) => {
  all.length = 2;
  lines.push(p.x);
}));
const withGetter = [new Point(1), new Point(2), new Point(3)];
lines.push(each(withGetter, (p, i, all) => {
  if (i === 0) Object.defineProperty(all, 1, { get() { return "from a getter"; } });
  lines.push(typeof p === "string" ? p : p.x);
}));
const outer = [new Point(10), new Point(20)];
const inner = ["a", "b", "c"];
lines.push(each(outer, p => {
  lines.push(p.x + ":" + each(inner, s => lines.push(s + s.length)));
}));
lines.push(String(findLast(points, p => p !== null && typeof p === "object").x));
lines.push(String(findLast(inner, s => s < "c")));
lines.push(String(findLast([], () => true)));
console.log(lines.join("\n"));
