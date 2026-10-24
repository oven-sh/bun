function textOf(length: number, base: number, changed: number): string {
  const codes: number[] = [];
  for (let i = 0; i < length; i++) codes.push(base + ((i * 7) % 23) + (i === changed ? 1 : 0));
  return String.fromCharCode(...codes);
}
function same(a: string, b: string): boolean {
  return a === b;
}
function sameWhateverTheyAre(a: unknown, b: unknown): boolean {
  return a === b;
}
function looselySame(a: any, b: any): boolean {
  return a == b;
}
const lines: string[] = [];
for (const base of [0x41, 0xc0, 0x3b1]) {
  for (let length = 28; length <= 76; length++) {
    const text = textOf(length, base, -1);
    const places = [-1, 0, 1, 3, 4, 7, 8, 9, length >> 1, length - 10, length - 9, length - 8, length - 5, length - 4, length - 2, length - 1];
    let bits = "";
    for (const place of places) {
      const other = textOf(length, base, place);
      const list = [textOf(length, base, 2), other, textOf(length, base, length - 3)];
      bits += same(text, other) ? "s" : ".";
      bits += sameWhateverTheyAre(other, text) ? "u" : ".";
      bits += looselySame(text, other) ? "l" : ".";
      bits += text !== other ? "." : "n";
      bits += list.includes(text) ? "i" : ".";
      bits += list.indexOf(text);
      bits += new Set(list).has(text) ? "h" : ".";
      bits += " ";
    }
    lines.push(`${base} ${length} ${bits}`);
  }
}
const narrow = textOf(40, 0x41, -1);
const wide = (textOf(40, 0x41, -1) + String.fromCharCode(0x3b1)).slice(0, 40);
lines.push(`${same(narrow, wide)} ${sameWhateverTheyAre(wide, narrow)} ${[wide].includes(narrow)} ${same(narrow, textOf(41, 0x41, -1))}`);
console.log(lines.join("\n"));
