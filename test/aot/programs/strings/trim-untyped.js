// `trim`, `trimStart`, `trimEnd`, `trimLeft` and `trimRight` (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
export function trim_(s) {
  return s.trim();
}
export function trimStart_(s) {
  return s.trimStart();
}
export function trimEnd_(s) {
  return s.trimEnd();
}
export function trimLeft_(s) {
  return s.trimLeft();
}
export function trimRight_(s) {
  return s.trimRight();
}
export function trimOfAnything(s) {
  return s.trim();
}
function all(s) {
  return show(trim_(s())) + show(trimStart_(s())) + show(trimEnd_(s())) + show(trimLeft_(s())) + show(trimRight_(s())) + show(trimOfAnything(s())) + trim_(s()).length;
}
let white = "";
for (const range of [[0, 768], [5760, 5761], [6158, 6159], [8191, 8208], [8231, 8240], [8286, 8289], [12287, 12290], [55296, 55297], [65278, 65280], [65534, 65536]]) {
  for (let c = range[0];c < range[1]; c++) {
    const u = String.fromCharCode(c);
    const a = trim_(u + "a" + u), b = trimStart_(u + "a" + u), e = trimEnd_(u + "a" + u);
    if (a.length !== 3 || b.length !== 3 || e.length !== 3 || trim_(u).length !== 1 || trim_(u + u).length !== 2)
      white += " " + c.toString(16) + ":" + a.length + b.length + e.length + trim_(u).length + trimStart_(u + u).length + trimEnd_(u + u).length;
  }
}
print(white);
for (const s of [
  () => "",
  () => " ",
  () => "  ",
  () => "a",
  () => " a",
  () => "a ",
  () => " a ",
  () => "  padded  ",
  () => "no space",
  () => "in the middle",
  () => `	
\v\f\r \xA0x y\xA0 \r\f\v
	`,
  () => "\x85x\x85",
  () => "\u200Bx\u200B",
  () => "\uFEFF\u2028\u2029\u3000x\u3000\u2029\u2028\uFEFF",
  () => " \u65E5\u672C ",
  () => "\u3000 ",
  () => " \xE9 ",
  () => "\xA0\xA0",
  () => "                                                                  ",
  () => cat("  left", "right  "),
  () => cat("   ", "   "),
  () => cat("  ", "x"),
  () => cat(" \u3000", "x\u3000 "),
  () => cat3(" ", " a ", " "),
  () => part("xx  padded  xx", 2, 12),
  () => part("xx    xx", 2, 6),
  () => part("x padded x", 1, 9),
  () => part(part("xx  padded  xx", 1, 13), 1, 11),
  () => part("\u65E5  x  \u65E5", 1, 6),
  () => flattened(cat("  a", "b  "))
])
  print(all(s));
const t = trim_("  key = value  ");
print(show(t.slice(0, 3)) + show(t.charCodeAt(0)) + show(t + "!") + show(t.indexOf("=")) + show(trim_(t) === t) + show(trim_(t.slice(3, 7))) + show(t.toUpperCase()));
for (const nil of [undefined, null]) {
  const s = nil;
  print(attempt(() => trim_(s)) + attempt(() => trimStart_(s)) + attempt(() => trimEnd_(s)) + attempt(() => trimOfAnything(nil)));
}

class Loud extends String {
  trim() {
    return "overridden";
  }
}
for (const other of [new String("  boxed  "), new Loud("  x  "), { trim() {
  return "mine";
} }, 12, true])
  print(attempt(() => trimOfAnything(other)));
print(attempt(() => String.prototype.trim.call(12)) + attempt(() => String.prototype.trim.call({ toString() {
  return "  object  ";
} })) + attempt(() => String.prototype.trimEnd.call(null)) + attempt(() => String.prototype.trimStart.call(Symbol())));
globalThis.kept = [trim_, trimStart_, trimEnd_, trimOfAnything];
console.log("number");
