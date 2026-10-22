// The odd value comes in the middle of a loop. The turns in front of it, the turn itself and the turns behind it each count once, and what the loop carries from turn to turn goes along.
type Item = { weight: number; label: string; next: Item | null };
function total(items: Item[], from: number): string {
    let sum = from;
    let labels = "";
    let longest = 0;
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        sum += item.weight;
        labels += item.label[0];
        if (item.label.length > longest) longest = item.label.length;
        let depth = 0;
        for (let link = item.next; link; link = link.next) depth += link.weight;
        sum += depth * 0.5;
    }
    return sum + "|" + labels + "|" + longest;
}
const plain = (n: number): Item => ({ weight: n, label: "item" + n, next: n % 3 ? { weight: 1, label: "l", next: null } : null });
const honest = Array.from({ length: 12 }, (_, n) => plain(n));
const lines: string[] = [];
for (let round = 0; round < 300; round++) total(honest, round);
const oddOnes: unknown[] = [
    { label: "swapped", weight: 100, next: null },
    { weight: 1.5, label: "fraction", next: null },
    { weight: "7", label: "text", next: null },
    { weight: 3, label: ["a", "rray"], next: null },
    { weight: 3, label: "odd link", next: { next: null, weight: 4, label: "x" } },
    { weight: 2 ** 31, label: "large", next: null },
    { weight: -0, label: "minus zero", next: undefined },
    { weight: NaN, label: "not a number", next: null },
];
for (const odd of oddOnes) {
    for (const place of [0, 5, 11]) {
        const items = honest.slice();
        items[place] = odd as Item;
        lines.push(place + ": " + total(items, 1));
    }
}
const holes = honest.slice();
delete (holes as unknown[])[4];
try {
    lines.push(total(holes, 0));
} catch (error) {
    lines.push((error as Error).constructor.name);
}
lines.push(total(honest, 0));
console.log(lines.join("\n"));
