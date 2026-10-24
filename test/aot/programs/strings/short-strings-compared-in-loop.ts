// Two strings of the same length that are not one cell, compared in a loop: every length from 0 to 20, the same text, and a difference at each place.
function text(length: number, changed: number, wide: boolean): string {
  let made = "";
  for (let i = 0; i < length; i++) made += String.fromCharCode((i === changed ? 65 : 97 + (i % 26)) + (wide && i === 0 ? 0x400 : 0));
  return made;
}
const left: string[] = [], right: string[] = [], expected: boolean[] = [];
for (const wide of [false, true]) {
  for (let length = 0; length <= 20; length++) {
    for (let changed = -1; changed < length; changed++) {
      left.push(text(length, -1, wide)); right.push(text(length, changed, wide)); expected.push(changed < 0);
    }
  }
}
function count(a: string[], b: string[]): number { let same = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same += 1; return same; }
function wrong(a: string[], b: string[]): number { let bad = 0; for (let i = 0; i < a.length; i++) if ((a[i] === b[i]) !== expected[i]) bad += 1; return bad; }
function unlike(a: string[], b: string[]): number { let other = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) other += 1; return other; }
console.log(left.length, count(left, right), wrong(left, right), unlike(left, right), count(left, left), count(right, left));
const sliced: string[] = left.map(one => ("<" + one + ">").slice(1, -1));
const joined: string[] = left.map(one => one.slice(0, one.length >> 1) + one.slice(one.length >> 1));
console.log(count(left, sliced), count(sliced, joined), wrong(joined, right), wrong(sliced, right));
const starts: boolean[] = []; for (let i = 0; i < left.length; i++) starts.push(("x" + left[i] + "y").startsWith("x" + right[i]));
console.log(starts.filter(Boolean).length, [count, wrong, unlike].map(one => one.name).join());
