// `<`, `<=`, `>` and `>=` on strings of lengths 0, 7, 8, 9, 16 and 17 that differ at every position (the same program without type annotations).
const narrow = (text) => text.split("").join("");
function typed(a, b) {
  return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0);
}
function any(a, b) {
  return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0);
}
const base = "abcdefghijklmnopq";
const out = [];
for (const m of [0, 7, 8, 9, 16, 17])
  for (const n of [0, 7, 8, 9, 16, 17])
    out.push(typed(narrow(base.slice(0, m)), narrow(base.slice(0, n))), any(narrow(base.slice(0, m)), narrow(base.slice(0, n))));
for (let at = 0;at < 17; at++)
  for (const unit of ["\x00", "`", "z", "\x7F", "\x80", "\xFF"])
    for (const against of ["\x7F", "\x80", "\xFF", base[at]]) {
      const a = narrow(base.slice(0, at) + unit + base.slice(at + 1)), b = narrow(base.slice(0, at) + against + base.slice(at + 1));
      out.push(typed(a, b), any(b, a));
    }
console.log(out.join(""));
