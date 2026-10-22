// Integers, fractions, booleans, strings, objects, null and undefined are alive in the function when a test fails. Each goes on with the value it had.
type Cell = { value: number };
function mix(cell: Cell, i: number, d: number, flag: boolean, text: string, object: { k: number } | null, nothing: undefined | number): string {
    const small = (i | 0) + 1;
    const wide = i * 4294967296 + 1;
    const fraction = d / 3;
    const negativeZero = flag ? -0 : 0;
    const notANumber = d - d === 0 ? 0 / (flag ? 0 : 1) : 1;
    const both = flag && i > 2;
    const joined = text + i;
    const held = object;
    const read = cell.value;
    return [small, wide, fraction, Object.is(negativeZero, -0), notANumber, both, joined, held === object, held ? held.k : "none", nothing, read].join();
}
const lines: string[] = [];
const shared = { k: 5 };
for (let round = 0; round < 400; round++) mix({ value: round }, round, round + 0.5, round % 2 === 0, "t", round % 3 ? shared : null, undefined);
for (const cell of [{ value: 1 }, { other: 0, value: 2 }, { get value() { return 3; } }, Object.create({ value: 4 }), { value: "five" }, 6, "seven", true]) {
    lines.push(mix(cell as Cell, 2147483646, 1e300, true, "a", shared, undefined));
    lines.push(mix(cell as Cell, -2147483648, -0.75, false, "", null, 9));
    lines.push(mix(cell as Cell, 3, Infinity, true, "\u{1F600}", { k: -1 }, undefined));
}
for (const cell of [null, undefined]) {
    try {
        lines.push(mix(cell as unknown as Cell, 1, 1, true, "x", null, undefined));
    } catch (error) {
        lines.push((error as Error).constructor.name);
    }
}
console.log(lines.join("\n"));
