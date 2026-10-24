const texts: string[] = ["", "a", "ab", "abc", "abcabc", "/usr/lib/node.d.ts", ".", ".ts", "..", "é", "éa", "日本語", "日本", "a日本", "x".repeat(40), "x".repeat(39) + "y"];
const left = "/usr/";
const ropes: string[] = [left + texts[3] + texts[4], texts[11] + left + texts[2], texts[14] + texts[15]];
const all = texts.concat(ropes);

function startsWithByLastIndexOf(text: string, prefix: string): boolean {
  return text.lastIndexOf(prefix, 0) === 0;
}
function endsWithByIndexOf(text: string, suffix: string): boolean {
  const expected = text.length - suffix.length;
  return expected >= 0 && text.indexOf(suffix, expected) === expected;
}

let rows = 0;
let digest = 0;
const wrong: string[] = [];
for (let i = 0; i < all.length; i++) {
  for (let j = 0; j < all.length; j++) {
    const text = all[i];
    const other = all[j];
    const starts = text.startsWith(other);
    const ends = text.endsWith(other);
    if (starts !== startsWithByLastIndexOf(text, other)) wrong.push(`start ${i} ${j}`);
    if (ends !== endsWithByIndexOf(text, other)) wrong.push(`end ${i} ${j}`);
    if (starts !== (text.slice(0, other.length) === other)) wrong.push(`slice ${i} ${j}`);
    for (const position of [-1, 0, 1, 2, 5, 39, 40, 41, 1000]) {
      const at = text.startsWith(other, position);
      const clamped = Math.min(Math.max(position, 0), text.length);
      if (at !== (text.slice(clamped, clamped + other.length) === other)) wrong.push(`at ${i} ${j} ${position}`);
      const until = text.endsWith(other, position);
      if (until !== (clamped >= other.length && text.slice(clamped - other.length, clamped) === other)) wrong.push(`until ${i} ${j} ${position}`);
      digest = (digest * 31 + (at ? 1 : 0) + (until ? 2 : 0)) | 0;
      rows++;
    }
    digest = (digest * 31 + (starts ? 1 : 0) + (ends ? 2 : 0)) | 0;
  }
}
console.log(rows, digest, wrong.length, wrong.slice(0, 8).join("|"));

for (const text of all) {
  console.log(
    JSON.stringify(text.length > 12 ? text.slice(0, 12) : text),
    text.lastIndexOf(".", 0),
    text.lastIndexOf("", 0),
    text.lastIndexOf("a", 0),
    text.lastIndexOf("ab", 0),
    text.lastIndexOf("ab", -5),
    text.lastIndexOf("/usr/", 0),
    text.lastIndexOf("日", 0),
    text.lastIndexOf("日本", 0),
    text.lastIndexOf("é", 0),
    text.lastIndexOf("é", -1),
    text.lastIndexOf("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 0),
    text.lastIndexOf(".", 1),
    text.lastIndexOf("a", NaN),
    text.lastIndexOf("ab", 3),
  );
}
