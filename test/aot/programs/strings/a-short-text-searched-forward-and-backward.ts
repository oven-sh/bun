const texts: string[] = [
  "",
  "a",
  "aa",
  "ab",
  "aab",
  "abab",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
  "/home/user/project/node_modules/package/lib/index.d.ts",
  "src/compiler/checker.ts",
  "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z",
  "no separator here at all, only words and a comma",
  "日本語のテキストと日本語",
  "mixed 日本 and latin 日本",
  "é".repeat(20) + "è",
];
const needles: string[] = ["", "a", "b", "aa", "ab", "aab", "ba", "/", ".", ".d.", ".ts", "/node_modules/", "node", "日", "日本", "日本語", "本語", "è", "éè", "éé", " and", "z", "y.z", "x".repeat(70)];
const positions: number[] = [-3, 0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 33, 52, 53, 54, 55, 100];

function slowIndexOf(text: string, other: string, from: number): number {
  const start = Math.min(Math.max(from, 0), text.length);
  for (let i = start; i + other.length <= text.length; i++) {
    let same = true;
    for (let k = 0; k < other.length && same; k++) same = text.charCodeAt(i + k) === other.charCodeAt(k);
    if (same) return i;
  }
  return -1;
}
function slowLastIndexOf(text: string, other: string, from: number): number {
  const start = Math.min(Math.max(from, 0), text.length - other.length);
  for (let i = start; i >= 0; i--) {
    let same = true;
    for (let k = 0; k < other.length && same; k++) same = text.charCodeAt(i + k) === other.charCodeAt(k);
    if (same) return i;
  }
  return -1;
}
function search(text: string, other: string, wrong: string[]): number {
  let digest = 0;
  for (let p = 0; p < positions.length; p++) {
    const from = positions[p];
    const forward = text.indexOf(other, from);
    const backward = text.lastIndexOf(other, from);
    if (forward !== slowIndexOf(text, other, from)) wrong.push(`indexOf ${JSON.stringify(text)} ${JSON.stringify(other)} ${from}: ${forward}`);
    if (backward !== slowLastIndexOf(text, other, from)) wrong.push(`lastIndexOf ${JSON.stringify(text)} ${JSON.stringify(other)} ${from}: ${backward}`);
    digest = (digest * 33 + forward * 3 + backward) | 0;
  }
  const first = text.indexOf(other);
  const last = text.lastIndexOf(other);
  if (first !== slowIndexOf(text, other, 0) || last !== slowLastIndexOf(text, other, text.length)) wrong.push(`whole ${JSON.stringify(text)} ${JSON.stringify(other)}`);
  if (text.includes(other) !== first >= 0) wrong.push(`includes ${JSON.stringify(text)} ${JSON.stringify(other)}`);
  return (digest * 33 + first * 3 + last) | 0;
}
function literals(text: string): string {
  return [
    text.indexOf("/"),
    text.lastIndexOf("/"),
    text.indexOf("."),
    text.lastIndexOf("."),
    text.lastIndexOf(".", 10),
    text.lastIndexOf(".", -1),
    text.lastIndexOf("a", -1),
    text.indexOf(".d."),
    text.lastIndexOf(".d."),
    text.lastIndexOf(".d.", 20),
    text.indexOf("/node_modules/"),
    text.lastIndexOf("/node_modules/"),
    text.indexOf("日本", 1),
    text.lastIndexOf("日本"),
    text.lastIndexOf("日本", 3),
    text.indexOf("ab", 1),
    text.lastIndexOf("ab", 1),
    text.indexOf("", 4),
    text.lastIndexOf("", 4),
  ].join(",");
}

const wrong: string[] = [];
let digest = 0;
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const rope = round ? text.slice(0, text.length >> 1) + text.slice(text.length >> 1) : text;
    for (const other of needles) digest = (digest * 31 + search(rope, other, wrong)) | 0;
  }
}
console.log(digest, wrong.length, wrong.slice(0, 6).join(" | "));
for (const text of texts) console.log(literals(text));
