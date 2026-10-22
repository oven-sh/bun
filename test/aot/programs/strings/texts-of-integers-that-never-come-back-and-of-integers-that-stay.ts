// The text of an integer is remembered by the integer. Integers that never come back fill that memory with texts that die; integers whose texts are kept as keys come back and must give the same text.
// Collections run in between: what they find dead is forgotten, what they find alive is still found, whatever size the memory has by then.
let seed = 12345;
function next(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
let lengths = 0;
let digits = 0;
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 30000; i++) {
    const text = `${next() % 10000000}`;
    lengths += text.length;
    digits += text.charCodeAt(text.length - 1) - 48;
  }
  Bun.gc(true);
}
console.log(lengths, digits);

const kept = new Map<string, number>();
for (let i = 256; i < 40000; i++) kept.set(`${i}`, i);
Bun.gc(true);
let found = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 256; i < 40000; i++) if (kept.get(String(i)) === i) found++;
  Bun.gc(round === 1);
}
console.log(found, kept.size);

// Both at once: the texts that stay are asked for between texts that die.
let mixed = 0;
for (let i = 0; i < 60000; i++) {
  const gone = "" + (next() % 100000000);
  const stays = "" + (256 + (i % 39000));
  if (kept.has(stays)) mixed++;
  if (kept.has(gone) && Number(gone) >= 40000) mixed += 1000000;
  if (i % 20000 === 19999) Bun.gc(true);
}
console.log(mixed);
kept.clear();
Bun.gc(true);
let again = 0;
for (let i = 256; i < 40000; i += 7) again += `${i}`.length;
console.log(again);
