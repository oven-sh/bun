// `trim()`, `trimStart()` and `trimEnd()` on 16-bit strings, with every kind of Unicode white space (the same program without type annotations).
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
export function both(s) {
  return s.trim();
}
export function start(s) {
  return s.trimStart();
}
export function end(s) {
  return s.trimEnd();
}
export function lengths(s) {
  return s.trim().length + "," + s.trimStart().length + "," + s.trimEnd().length;
}
export function ofPieces(screen) {
  let out = "";
  for (const line of screen.split(`
`))
    out += "[" + line.trimEnd() + "]" + line.trim().length + ";";
  return out;
}
const codes = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16)).join(".");
const of = (...units) => String.fromCharCode(...units);
{
  const taken = [], takenAtStart = [], takenAtEnd = [];
  for (let c = 0;c < 65536; c++) {
    const s = of(c, 9474, c);
    if (both(s).length === 1)
      taken.push(c);
    if (start(s).length === 2)
      takenAtStart.push(c);
    if (end(s).length === 2)
      takenAtEnd.push(c);
  }
  print(taken.length + ": " + taken.map((c) => c.toString(16)).join() + " " + (taken.join() === takenAtStart.join()) + " " + (taken.join() === takenAtEnd.join()));
}
const box = of(9474);
const wide = of(12288);
const thin = of(8201);
const mark = of(65279);
const line = of(8232);
const high = of(55357);
const low = of(56832);
for (const s of [
  box,
  " " + box,
  box + " ",
  "  " + box + "  ",
  `	
` + box + "x" + box + `\r
`,
  wide + box + wide,
  thin + mark + line + box + line + mark + thin,
  box + " " + box,
  " a" + box + "b ",
  wide,
  wide + wide + thin,
  mark,
  " " + wide + " ",
  high + low,
  " " + high + low + " ",
  wide + high + wide,
  low + " ",
  " " + low,
  of(8203) + box + of(8203),
  of(6158) + box + of(6158),
  of(133) + box + of(133),
  of(160) + box + of(160),
  of(8288) + box,
  of(5760) + box + of(5760),
  of(8239, 8287) + box + of(8287, 8239)
])
  print(codes(both(s)) + " | " + codes(start(s)) + " | " + codes(end(s)) + " | " + lengths(s));
print((both(box + "x") === box + "x") + " " + codes(both(cat("  " + box, box + "  "))) + " " + codes(end(cat(cat(" ", box), cat(" ", wide)))) + " " + codes(start(part("ab  " + box + "  cd", 2, 7))) + " " + codes(both(part(part("ab  " + box + "x  cd", 1, 9), 1, 7))));
print(ofPieces(box + " one  " + box + `  
` + box + `   

   
` + wide + "two" + wide + `
plain  
` + box));
print(codes(both(" ".repeat(300) + box + " ".repeat(300))) + " " + both(wide.repeat(500)).length + " " + end(box.repeat(500) + wide.repeat(500)).length + " " + start(wide.repeat(500) + box.repeat(500)).length);
for (const s of ["", " ", "a", " a ", `	
\v\f\r a b 	
\v\f\r`, "\xA0a\xA0", "\x85a\x85", "\x1Fa\x1F", "a  ", "  a"])
  print(codes(both(s)) + " | " + codes(start(s)) + " | " + codes(end(s)));
print(attempt(() => both(undefined)) + " " + attempt(() => end(null)) + " " + attempt(() => start(12)));
globalThis.kept = [both, start, end, lengths, ofPieces];
console.log("number");
