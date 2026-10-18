// Pieces of a text that holds a character outside Latin-1 are appended in loops, as they are and escaped: the pieces that are Latin-1 themselves, those that are not, and the texts whole. The answers are plain Bun's.
const escape = Bun.escapeHTML;
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.length <= 120 ? text : text.slice(0, 50) + ".." + text.slice(-50)));
}
function pieces(text: string, size: number): string {
  let out = "";
  for (let at = 0; at < text.length; at += size) out += "[" + text.slice(at, at + size) + "]";
  return out;
}
function escapedPieces(text: string, size: number): string {
  let out = "";
  for (let at = 0; at < text.length; at += size) out += "<i>" + escape(text.slice(at, at + size)) + "</i>";
  return out;
}
function escapedWords(text: string): string {
  let out = "";
  for (const word of text.split(" ")) out += escape(word) + "|";
  return out;
}
function words(text: string): string {
  let out = "";
  for (const word of text.split(" ")) out += word + "|";
  return out;
}
function whole(texts: string[]): string {
  let out = "";
  for (const text of texts) out += escape(text) + "," + text + ";";
  return out;
}
const texts: string[] = [
  "plain words <b>and</b> 'marks' & \"more\" 東京",
  "東京 at the start, café & crème after it",
  "one 😀 pair, a lone \ud83d half & another \ude00 half",
  "ÿþý <Latin-1> only until here: 語",
  "語",
  "a語",
  "<語>",
  "0123456789abcdef".repeat(20) + "&語" + "0123456789abcdef".repeat(20),
];
for (const text of texts) {
  for (const size of [1, 2, 3, 7, 16, 33, 1000]) {
    show("pieces " + size, pieces(text, size));
    show("escaped pieces " + size, escapedPieces(text, size));
  }
  show("words", words(text));
  show("escaped words", escapedWords(text));
  show("a slice of a slice", escapedPieces(text.slice(1, -1), 5));
  show("a rope", escapedPieces(text + "|" + text, 9));
}
show("whole", whole(texts));
let total = 0;
for (let round = 0; round < 3000; round++) {
  total += escapedPieces("round " + round + " <of> many & 東京 " + (round % 5 ? "" : "😀"), 4).length + words("a b " + round + " 語").length;
  if (round % 1000 === 0) Bun.gc(true);
}
console.log(total);
