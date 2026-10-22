// Reads, comparisons and searches on ropes of 3 and 70,000 pieces agree with the same operations on flat strings.
function digest(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + hash;
}
function concatenate(pieces) {
  let text = "";
  for (let i = 0; i < pieces.length; i++) text += pieces[i];
  return text;
}
function threePieces(a, b, c) {
  return a + b + c;
}
function flat(text) {
  return Array.from({ length: text.length }, (_, i) => text[i]).join("");
}
function repeated(count, piece, wide) {
  const pieces = [];
  for (let i = 0; i < count; i++) pieces.push(i === wide ? "日" : piece + (i % 10));
  return pieces;
}
const manyNarrow = repeated(70000, "a", -1);
const manyWide = repeated(70000, "b", 35000);
const sources = {
  "three narrow": () => threePieces("alpha-", "beta-", "gamma"),
  "three wide": () => threePieces("alpha-", "日本-", "gamma"),
  "three with empty": () => threePieces("", "middle", ""),
  "many narrow": () => concatenate(manyNarrow),
  "many wide": () => concatenate(manyWide),
  "substring of rope": () => threePieces("prefix-", concatenate(manyWide), "-suffix").substring(3, 69990),
  "rope of substrings": () => threePieces("alpha-beta".substring(2, 7), "日本語".substring(1), "gamma".substring(0, 0)),
};
const flats = {};
for (const name in sources) flats[name] = flat(sources[name]());
function positionsOf(length) {
  if (length > 1000) return [0, length >> 1, length - 1, length, -1, NaN];
  return [0, 1, 2, length >> 1, length - 1, length, length + 1, -1, -length, NaN, 2.5, Infinity, -Infinity];
}
function readsOf(make, length) {
  const lines = [];
  for (const position of positionsOf(length)) {
    lines.push(["charCodeAt", position, make().charCodeAt(position)]);
    lines.push(["at", position, make().at(position)]);
    lines.push(["startsWith", position, make().startsWith("a", position), make().startsWith("", position)]);
    lines.push(["indexOf", position, make().indexOf("a", position), make().indexOf("5-g", position), make().indexOf("日", position), make().indexOf("", position)]);
    lines.push(["substring", position, digest(make().substring(position)), digest(make().substring(1, position)), digest(make().substring(position, position))]);
  }
  return lines.map(line => line.join(" ")).join("\n");
}
function comparisonsOf(make, other) {
  const changed = other.slice(0, -1) + "~";
  return [
    make() === other, make() !== other, make() === make(), make() === changed, make() === other + "x",
    make() < other, make() > other, make() <= other, make() < changed, changed < make(), make() < "", "" < make(), make() < make(),
    make() < other + "x", make() + "x" > other,
  ].join(" ");
}
for (const name in sources) {
  const make = sources[name];
  const other = flats[name];
  const onRope = readsOf(make, other.length);
  const onFlat = readsOf(() => other, other.length);
  console.log(name, digest(make()), onRope === onFlat ? "same reads" : "different reads");
  console.log(onRope.length > 2000 ? digest(onRope) : onRope);
  console.log(comparisonsOf(make, other));
  console.log(comparisonsOf(() => other, other));
}
const empty = () => threePieces("", "", "");
console.log(empty() === "", empty().length, empty().charCodeAt(0), empty().indexOf(""), empty().indexOf("", 5), empty().startsWith(""), empty().startsWith("", 5), empty().substring(0, 5) === "");
console.log(threePieces("a￿", "b", "") < threePieces("a\ud83d", "\ude00", ""), threePieces("ÿ", "", "x") < threePieces("Ā", "", ""));
