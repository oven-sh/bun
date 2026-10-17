// Objects of many shapes copied property by property into fresh objects: more pairs of shape and key than any table holds, each copy like its source.
function copy(source) {
    const target = {};
    for (const name in source) target[name] = source[name];
    return target;
}
const lines = [];
for (const shapes of [3, 40, 150, 400]) {
    const sources = [];
    for (let s = 0; s < shapes; s++) {
        const source = {};
        for (let k = 0; k < 3 + s % 7; k++) source["name" + s + "_" + k] = s * 10 + k;
        if (s % 5 === 0) source[s] = "an index";
        if (s % 11 === 0) Object.defineProperty(source, "hidden", { value: 1, enumerable: false });
        sources.push(source);
    }
    let sum = 0;
    let keys = 0;
    for (let turn = 0; turn < shapes * 12; turn++) {
        const source = sources[(turn * 7) % shapes];
        const made = copy(source);
        const names = Object.keys(made);
        keys += names.length;
        if (names.join() !== Object.keys(source).join()) sum -= 1000000;
        for (const name of names) if (typeof made[name] === "number") sum += made[name];
        if ("hidden" in made) sum -= 1000000;
    }
    lines.push(shapes + " shapes: " + sum + " " + keys);
}
console.log(lines.join("\n"));
