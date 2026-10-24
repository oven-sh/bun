// Two typed strings compared with < > <= >=, alone and twice in a row as a comparator does: flat, ropes, substrings, Latin-1 above 127, 16-bit, prefixes, and values that are not strings behind the type.
type Row = { name: string; id: number };
const lines: string[] = [];
const base = "abcdefghijklmnopqrstuvwxyz0123456789";
const texts: string[] = ["", "a", "b", "ab", "abc", "abd", "abcd", "abce", "abcdefg", "abcdefgh", "abcdefgi", "abcdefghi", "abcdefghj", "abcdefghijklmnop", "abcdefghijklmnoq", "abcdefghijklmnopq", "B", "Z", "a\u0000", "a\u0001", "\u007f", "\u0080", "é", "ÿ", "aÿ", "aĀ", "Ā", "āa", "😀", "￿", "", "10", "9", "-1", "0", " "];
for (let i = 0; i < 24; i++) texts.push(base.slice(0, i) + "!" + base.slice(i + 1, 24));
for (let i = 1; i < 12; i++) texts.push(base.slice(i, i + 9), base.slice(0, i) + base.slice(0, i), base.slice(0, i) + "Δ" + base.slice(0, 3));

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function orderOfRows(a: Row, b: Row): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
function backwards(a: Row, b: Row): number {
  return b.name > a.name ? -1 : a.name > b.name ? 1 : 0;
}
function inclusive(a: string, b: string): number {
  return (a <= b ? 1 : 0) + (a >= b ? 2 : 0) + (b <= a ? 4 : 0) + (b >= a ? 8 : 0) + (a < b ? 16 : 0) + (b < a ? 32 : 0);
}
function alone(a: string, b: string): number {
  let n = 0;
  if (a < b) n += 1;
  return n;
}

let sum = 0;
let kinds = 0;
for (let i = 0; i < texts.length; i++)
  for (let j = 0; j < texts.length; j++) {
    const a = texts[i]!;
    const b = texts[j]!;
    sum = (sum * 3 + order(a, b) + 1) % 1000003;
    kinds = (kinds * 7 + inclusive(a, b) + alone(a, b)) % 1000003;
  }
lines.push(sum + ":" + kinds);

const rows: Row[] = texts.map((name, id) => ({ name, id }));
for (let i = 0; i < texts.length; i += 3) rows.push({ name: texts[i]!.slice(0, 2) + texts[(i * 7) % texts.length]!, id: 1000 + i });
lines.push(rows.slice().sort(orderOfRows).map(r => r.id).join());
lines.push(rows.slice().sort(backwards).map(r => r.id).join());
lines.push(rows.slice().sort((a, b) => (a.name > b.name ? -1 : a.name < b.name ? 1 : a.id - b.id)).map(r => r.id).join());

const loose: any[] = [undefined, null, "", "0", "-1", "1", "a", "null", "undefined"];
const smuggled: string[] = loose as string[];
let answers = "";
for (let r = 0; r < 3; r++) {
  answers = "";
  for (const a of smuggled) for (const b of smuggled) answers += order(a, b) + 1 + "" + inclusive(a, b).toString(36) + alone(a, b);
}
lines.push(answers);
const odd: Row[] = loose.map((name, id) => ({ name, id }));
let fields = "";
for (const a of odd) for (const b of odd) fields += orderOfRows(a, b) + 1 + "" + (backwards(a, b) + 1);
lines.push(fields);

function longest(words: string[]): string {
  let best = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    try {
      if (word > best) best = word;
      else if (word < best && word >= "a") best = best + "";
    } catch {
      best = "";
    }
  }
  return best;
}
lines.push(JSON.stringify(longest(texts)));
console.log(lines.join("\n"));
