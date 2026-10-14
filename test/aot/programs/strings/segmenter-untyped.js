// `Intl.Segmenter`: iterations that finish, stop early, interleave and nest, and `containing()` (the same program without type annotations).
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
const collect = typeof globalThis.gc === "function" ? globalThis.gc : () => {};
const graphemes = new Intl.Segmenter;
const words = new Intl.Segmenter("en", { granularity: "word" });
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
function piece(d) {
  return d === undefined ? "-" : show(d.segment) + "@" + d.index + (d.isWordLike === undefined ? "" : d.isWordLike ? "w" : "n") + d.input.length;
}
export function all(seg, s) {
  let out = "";
  for (const d of seg.segment(s))
    out += piece(d) + " ";
  return out;
}
export function first(seg, s, n) {
  let out = "";
  for (const d of seg.segment(s)) {
    if (n-- <= 0)
      break;
    out += piece(d) + " ";
  }
  return out;
}
export function nested(seg, a, b, c) {
  let out = "";
  for (const x of seg.segment(a))
    for (const y of seg.segment(b))
      for (const z of seg.segment(c))
        out += x.segment + y.segment + z.segment + ",";
  return out;
}
export function interleaved(seg, a, b) {
  const i = seg.segment(a)[Symbol.iterator](), j = seg.segment(b)[Symbol.iterator](), k = seg.segment(a)[Symbol.iterator]();
  let out = "";
  for (let n = 0;n < 7; n++) {
    const x = i.next(), y = j.next();
    out += (x.done ? "." : x.value.segment) + (y.done ? "." : y.value.segment);
    if (n & 1) {
      const z = k.next();
      out += z.done ? "." : z.value.segment;
    }
    out += " ";
  }
  return out;
}
export function sameSegments(seg, s) {
  const segments = seg.segment(s);
  const i = segments[Symbol.iterator](), j = segments[Symbol.iterator]();
  let out = piece(segments.containing(1)) + " ";
  out += piece(i.next().value) + piece(i.next().value) + " " + piece(segments.containing(0)) + " " + piece(j.next().value) + piece(i.next().value) + " " + piece(segments.containing(s.length - 1)) + piece(segments.containing(s.length)) + piece(segments.containing(-1));
  return out + " " + [...segments].length + [...segments].length;
}
export function afterTheEnd(seg, s) {
  const i = seg.segment(s)[Symbol.iterator]();
  let n = 0;
  while (!i.next().done)
    n++;
  const other = all(seg, "xy");
  return n + String(i.next().done) + String(i.next().value) + String(i.next().done) + " " + other + String(i.next().done);
}
const texts = ["", "a", "abc", "caf\xE9", "e\u0301a", "\u65E5\u672C\u8A9E", "a\uD83D\uDE00b", "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67!", "\uD83D", cat("ab", "cd"), part("xx\u65E5yxx", 2, 4), "Hello, world. It is 3.5 km! Yes?"];
for (const s of texts)
  print(show(s) + ": " + all(graphemes, s) + "| " + first(graphemes, s, 2) + "| " + afterTheEnd(graphemes, s) + (s.length ? " | " + sameSegments(graphemes, s) : ""));
print(all(words, texts[11]));
print(all(sentences, texts[11]));
print(sameSegments(words, texts[11]));
print(first(words, "one two three", 3) + "| " + all(words, "\u65E5\u672C\u8A9E\u306E\u6587"));
print(nested(graphemes, "ab", "\u65E5\u672C", "xy"));
print(interleaved(graphemes, "abc", "\u65E5\u672C\u8A9E\u6587\u5B57"));
print(interleaved(words, "a b", "c d e f"));
{
  let sum = 0;
  for (let round = 0;round < 300; round++) {
    const s = "r" + round + (round & 1 ? "\u65E5" : "") + "x".repeat(round & 31);
    let n = 0;
    for (const d of graphemes.segment(s))
      n += d.segment.length + d.index;
    sum = sum * 31 + n | 0;
    if (round % 50 === 0)
      collect();
    if (round % 7 === 0)
      first(graphemes, s, 1);
  }
  print("sum " + sum);
}
{
  const kept = [];
  for (let i = 0;i < 20; i++)
    kept.push(new Intl.Segmenter().segment("k" + i + "\xE9z")[Symbol.iterator]());
  collect();
  const garbage = [];
  for (let i = 0;i < 5000; i++)
    garbage.push("g" + i);
  collect();
  print(kept.map((k) => {
    let out = "";
    for (let r = k.next();!r.done; r = k.next())
      out += r.value.segment;
    return out;
  }).join() + " " + garbage.length);
}
print([...graphemes.segment("a\u0301b")].map(piece).join() + " " + Array.from(words.segment("x y"), piece).join() + " " + attempt(() => graphemes.segment.call({}, "x")) + " " + attempt(() => graphemes.segment(Symbol())) + " " + [...graphemes.segment(12)].map(piece).join() + [...graphemes.segment(undefined)].length);
globalThis.kept = [all, first, nested, interleaved, sameSegments, afterTheEnd];
console.log("number");
