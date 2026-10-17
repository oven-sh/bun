// The parts of a key that is put together on the spot need not be flat strings: slices of a longer text, pieces of a split, groups of a match, ropes, ropes of slices; 8-bit and 16-bit; short, and too long for any buffer. Each lookup is repeated with a key that was flattened beforehand.
const report: string[] = [];
let wrong = 0;
function flat(text: string): string {
  return text.split("").join("");
}
function note(table: Map<string, number>, left: string, right: string): void {
  const label = left + "=" + right;
  const times = table.get(label);
  table.set(label, times === undefined ? 1 : times + 1);
  if (table.get(flat(left) + "=" + flat(right)) !== (times ?? 0) + 1) wrong++;
}
const sources = ["the quick brown fox jumps over the lazy dog", "déjà vu, déjà lu, déjà bu", "αβγ δεζ αβγ δεζ", "0123456789".repeat(14)];

for (const source of sources) {
  const bySlices = new Map<string, number>();
  for (let width = 1; width <= 41; width += 8) for (let at = 0; at + 2 * width <= source.length; at += width) note(bySlices, source.slice(at, at + width), source.substring(at + width, at + 2 * width));
  const byPieces = new Map<string, number>();
  const words = source.split(" ");
  for (let turn = 0; turn < 2; turn++) for (let i = 0; i < words.length; i++) note(byPieces, words[i]!, words[(i + 2) % words.length]!);
  const byRopes = new Map<string, number>();
  for (let i = 1; i < words.length + 3; i++) {
    const rope = words[i % words.length]! + words[(i - 1) % words.length]!;
    note(byRopes, rope, rope.slice(1) + rope);
    note(byRopes, rope + rope + rope, source.slice(0, i));
  }
  report.push(bySlices.size + " " + byPieces.size + " " + byRopes.size + " " + [...byPieces.keys()].slice(0, 2).join("|"));
}

const shape = /(\w+)-(\d+)(?:-(\w+))?/;
const byGroups = new Set<string>();
let repeats = 0;
for (const code of ["ab-12", "ab-12-x", "cd-7-yy", "ab-12", "zz", "cd-7", "cd-7-yy"]) {
  const parts = shape.exec("<" + code + ">");
  if (!parts) continue;
  const label = parts[2]! + "@" + parts[1]! + "@" + parts[3];
  if (byGroups.has(label)) repeats++;
  else byGroups.add(label);
}
report.push([...byGroups].join(" ") + " " + repeats, "wrong " + wrong);
console.log(report.join("\n"));
