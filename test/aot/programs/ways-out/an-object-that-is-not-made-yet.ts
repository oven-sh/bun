// An object that never leaves the function need not be made. Where the function goes on in another way it is made, once, with what has been stored into it so far, and it is the same object for everybody from then on.
type Source = { a: number; b: number };
const kept: object[] = [];
function sums(source: Source, keep: boolean): string {
    const pair = { first: source.a, second: 0, inner: { deep: source.a * 2 } };
    pair.second = pair.first + 1;
    const list = [pair.first, pair.second];
    const b = source.b;
    pair.inner.deep += b;
    list.push(b);
    if (keep) kept.push(pair, pair.inner, list);
    return pair.first + "," + pair.second + "," + pair.inner.deep + "," + list.join("+");
}
const lines: string[] = [];
for (let round = 0; round < 400; round++) sums({ a: round, b: 1 }, false);
for (const source of [{ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, get b() { return 20; } }, { a: 1 }, { a: 1, b: "two" }, Object.create({ a: 3, b: 4 })]) {
    lines.push(sums(source as Source, false));
    lines.push(sums(source as Source, true));
}
lines.push(JSON.stringify(kept));
lines.push(String(kept.length) + " " + new Set(kept).size);
console.log(lines.join("\n"));
