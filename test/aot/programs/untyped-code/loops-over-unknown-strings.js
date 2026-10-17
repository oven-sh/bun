// A loop in JavaScript that walks over a value that is nearly always a string, by `length` and `charCodeAt`: what it finds when the value is a flat string, a rope, a 16-bit string, a substring, a String object, an array or an object of its own, and when the index is no integer.
function pathOf(request) {
  const url = request.url;
  const start = url.indexOf("/", 8);
  let i = start;
  for (; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code === 37) return "escaped at " + i;
    if (code === 63 || code === 35) break;
  }
  return url.slice(start, i);
}
function sumFrom(text, from, step) {
  let sum = 0;
  for (let i = from; i < text.length; i += step) sum += text.charCodeAt(i);
  return sum;
}
const flat = "http://localhost/users/1234/posts?limit=10";
const rope = n => "http://localhost/" + "a".repeat(n) + String(n) + "#" + n;
const wide = "http://localhost/café/世界?x";
const odd = {
  length: 14,
  indexOf() { return 9; },
  charCodeAt(i) { this.asked = (this.asked ?? "") + i + ","; return i === 12 ? 63 : 65; },
  slice(a, b) { return "slice " + a + " " + b + " after " + this.asked; },
};
const growing = { size: 10, get length() { return this.size < 13 ? ++this.size : this.size; }, indexOf: () => 8, charCodeAt: i => 60 + i, slice: (a, b) => a + ".." + b };
const values = [flat, rope(3), rope(40), wide, flat.slice(0, 30), new String(flat), Object(rope(5)), "http://localhost", "http://localhost/%41", ""];
const said = new Set();
for (let turn = 0; turn < 3000; turn++) {
  for (const url of values) said.add(pathOf({ url }));
  if (turn % 1000 === 999) {
    said.add(pathOf({ url: { ...odd } }));
    said.add(pathOf({ url: { ...growing, get length() { return this.size < 13 ? ++this.size : this.size; } } }));
    said.add(pathOf({ url: Object.assign(["h", "/", "x"], { charCodeAt: () => 1, indexOf: () => 1 }) }).join("+"));
    try { pathOf({ url: 5 }); } catch (error) { said.add(error.constructor.name); }
    try { pathOf({}); } catch (error) { said.add(error.constructor.name); }
  }
}
console.log([...said].join("\n"));
const sums = [];
for (let turn = 0; turn < 2000; turn++) {
  sums.length = 0;
  sums.push(sumFrom(flat, 0, 1), sumFrom(flat, 3, 2), sumFrom(wide, 0, 1), sumFrom(rope(9), 1, 3), sumFrom(flat, 0.5, 1), sumFrom(flat, -2, 1), sumFrom(flat, "1", 1), sumFrom(flat, 0, 1.5), sumFrom(flat, 2 ** 31, 1), sumFrom(flat, 40, 2 ** 31 - 1));
}
console.log(sums.join());
