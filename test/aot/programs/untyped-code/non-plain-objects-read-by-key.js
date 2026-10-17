// Objects that are ordinary in what they do and are no plain objects (wrappers of booleans), and others that are not ordinary, read by keys that are computed.
const lines = [];
const names = ["first", "second", "third", "NOBODY_SPELLS_THIS"];
function fresh(index) { return [["fir", "st"], ["sec", "ond"], ["thi", "rd"], ["NOBODY_SPELLS", "_THIS"]][index].join(""); }
function ask(object, rounds) {
    const seen = [];
    for (let round = 0; round < rounds; round++) {
        let line = "";
        for (let i = 0; i < names.length; i++) {
            const a = object[names[i]];
            const b = object[fresh(i)];
            line += (a === undefined ? "." : String(a)) + (b === undefined ? "." : String(b)) + " ";
        }
        if (seen[seen.length - 1] !== line) seen.push(line);
    }
    return seen.join("| ");
}
const wrapper = new Boolean(true);
lines.push("empty: " + ask(wrapper, 5));
wrapper.first = 1;
lines.push("one: " + ask(wrapper, 5));
wrapper[fresh(1)] = 2;
lines.push("two: " + ask(wrapper, 5));
Object.defineProperty(wrapper, "third", { get() { return "got"; }, configurable: true });
lines.push("a getter: " + ask(wrapper, 5));
delete wrapper.third;
delete wrapper.first;
lines.push("less: " + ask(wrapper, 5));
const parent = { third: "above" };
Object.setPrototypeOf(wrapper, parent);
lines.push("another parent: " + ask(wrapper, 5));
parent[fresh(3)] = "now spelled";
lines.push("the fourth: " + ask(wrapper, 5));
delete parent[names[3]];
lines.push("gone: " + ask(wrapper, 5));
const twin = new Boolean(false);
lines.push("a twin: " + ask(twin, 4) + typeof twin[["value", "Of"].join("")]);
for (let i = 0; i < 100; i++) twin["p" + i] = i;
lines.push("with a hundred: " + ask(twin, 4) + twin["p" + 99]);
twin[names[0]] = "late";
lines.push("and one: " + ask(twin, 4));
for (const [what, object] of [["Math", Math], ["JSON", JSON], ["a date", new Date(0)], ["an error", new Error("x")], ["a map", new Map()], ["a number", new Number(1)], ["a text", new String("ab")], ["a regular expression", /x/], ["a promise", Promise.resolve()], ["a proxy", new Proxy({}, { get(target, name) { return name === "second" ? "trapped" : undefined; } })]])
    lines.push(what + ": " + ask(object, 3));
lines.push("their own: " + Math[["ma", "x"].join("")](1, 2) + " " + typeof JSON[["par", "se"].join("")] + " " + new String("ab")[["len", "gth"].join("")] + " " + new Error("x")[["mess", "age"].join("")]);
console.log(lines.join("\n"));
