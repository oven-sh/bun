// `v === "literal"` in a loop gives the same answer however the string was created: literals, property keys, JSON.parse results, slices, ropes, 16-bit strings (the same program without type annotations).
const base = "xx-b-text-a longer one!-\u0416b";
function made(text) {
  const rope = text.slice(0, 1) + text.slice(1), flat = text.slice(0, 1) + text.slice(1);
  flat.charCodeAt(0);
  const padded = "<" + text + ">", part = padded.slice(1, 1 + text.length);
  const parsed = JSON.parse(JSON.stringify({ v: text, [text]: 1 }));
  const key = Object.keys(parsed)[1], wide = ("\u0416" + text).slice(1), joined = [text.slice(0, 1), text.slice(1)].join("");
  return [text, rope, flat, part, parsed.v, key, wide, joined, String(text), text.toLowerCase(), text + "", `${text}`, Symbol.for(text).description];
}
const names = ["written", "a rope", "a concatenation read once", "a slice", "out of JSON.parse", "a key of an object", "a slice of 16 bits", "joined", "String()", "toLowerCase()", "+ nothing", "a template", "a symbol's description"];
const texts = ["b", "text", "a longer one!", "c", "texu", "a longer one?", "", "bb", "B"];
const lists = texts.map(made);
let rows = 0;
function countB(rs) {
  let n = 0;
  for (let j = 0;j < rs.length; j++)
    if (rs[j].kind === "b")
      n++;
  return n;
}
function countText(rs) {
  let n = 0;
  for (let j = 0;j < rs.length; j++)
    if (rs[j].kind === "text")
      n++;
  return n;
}
function countLong(rs) {
  let n = 0;
  for (let j = 0;j < rs.length; j++)
    if (rs[j].kind === "a longer one!")
      n++;
  return n;
}
function valuesB(rs) {
  let s = "";
  for (let j = 0;j < rs.length; j++) {
    const is = rs[j].kind === "b";
    s += is ? "1" : "0";
  }
  return s;
}
function valuesText(rs) {
  let s = "";
  for (let j = 0;j < rs.length; j++) {
    const is = rs[j].kind === "text";
    s += is ? "1" : "0";
  }
  return s;
}
function valuesLong(rs) {
  let s = "";
  for (let j = 0;j < rs.length; j++) {
    const is = rs[j].kind === "a longer one!";
    s += is ? "1" : "0";
  }
  return s;
}
function notText(rs) {
  let n = 0;
  for (let j = 0;j < rs.length; j++)
    if (rs[j].kind !== "text")
      n++;
  return n;
}
function anything(vs) {
  let s = "";
  for (let j = 0;j < vs.length; j++)
    s += vs[j] === "text" ? "1" : vs[j] === "b" ? "2" : "0";
  return s;
}
function elements(vs) {
  let n = 0;
  for (let j = 0;j < vs.length; j++)
    if (vs[j] === "text")
      n++;
  return n;
}
for (let turn = 0;turn < 3; turn++) {
  for (let t = 0;t < texts.length; t++)
    for (let k = 0;k < names.length; k++) {
      const rs = [{ kind: lists[t][k] }, { kind: "b" }, { kind: lists[t][k] }, { kind: "text" }, { kind: lists[(t + 1) % texts.length][k] }, { kind: "a longer one!" }];
      rows++;
      console.log(JSON.stringify(texts[t]) + " " + names[k] + " -> " + countB(rs) + " " + countText(rs) + " " + countLong(rs) + " " + valuesB(rs) + " " + valuesText(rs) + " " + valuesLong(rs) + " " + notText(rs) + " " + elements(rs.map((r) => r.kind)));
    }
  const mixed = ["text", "b", 1, null, undefined, {}, [], true, Symbol("text"), 10n, lists[1][1], lists[1][3], lists[0][4], new String("text"), () => "text", lists[1][6]];
  rows++;
  console.log("anything -> " + anything(mixed));
  const holes = [{ kind: "text" }, { kind: undefined }, { kind: null }, { kind: lists[1][1] }];
  rows++;
  console.log("nil -> " + countText(holes) + " " + valuesText(holes) + " " + notText(holes));
}
console.log(rows + " rows " + "xx-b-text-a longer one!-\u0416b".length);
