// ===, !==, == and != in code without types, between values of every kind: integers, doubles, NaN, both zeros, undefined, null, booleans, symbols, big integers, objects, functions, and strings
// in every form they are kept in: written in the program, names of properties, cut out of others, put together and not yet flattened, of one-byte and of two-byte characters, empty, long,
// alike up to the last character, alike in length alone.
const lines = [];
function same(a, b) { return a === b; }
function differs(a, b) { return a !== b; }
function alike(a, b) { return a == b; }
function unlike(a, b) { return a != b; }
function cut(text) { return ("<" + text + ">").slice(1, -1); }
function joined(text) { const middle = text.length >> 1; return text.slice(0, middle) + text.slice(middle); }
function parsed(text) { return JSON.parse(JSON.stringify([text]))[0]; }
function named(text) { return Object.keys({ [text]: 1 })[0]; }
const long = "the quick brown fox jumps over the lazy dog and then does it again";
const texts = ["", "a", "b", "ab", "ba", "abc", "abd", "type", "kind", "children", "childrem", "12", "012", long, long.slice(0, -1) + "m", long + "!", "é", "é", "中文", "中斈", "a中", "aé"];
const forms = [text => text, cut, joined, parsed, named, text => joined(text) + "", text => String(new String(text))];
const object = { valueOf() { return 12; } };
const other = { toString() { return "ab"; } };
const symbol = Symbol("s");
const values = [
    undefined, null, true, false, 0, -0, 1, -1, 12, 12.5, 2147483647, -2147483648, 4294967296, 1e300, Infinity, -Infinity, NaN,
    0n, 1n, 12n, 12345678901234567890n, 12345678901234567890n + 0n, symbol, Symbol("s"), Symbol.iterator,
    object, other, {}, [], [12], ["ab"], same, differs, new String("ab"), new Number(12),
];
let count = 0;
function tally(a, b) {
    const bits = (same(a, b) ? 1 : 0) | (differs(a, b) ? 2 : 0) | (alike(a, b) ? 4 : 0) | (unlike(a, b) ? 8 : 0);
    count++;
    return "0123456789abcdef"[bits];
}
for (let round = 0; round < 2; round++) {
    const rows = [];
    for (const a of values) {
        let row = "";
        for (const b of values)
            row += tally(a, b);
        for (const text of ["", "0", "1", "12", "ab", "true", "null", "undefined", "NaN", "[object Object]"])
            row += tally(a, text) + tally(cut(text), a) + tally(a, joined(text));
        rows.push(row);
    }
    if (round)
        lines.push(...rows);
}
for (const first of forms) {
    for (const second of forms) {
        let row = "";
        for (const a of texts) {
            for (const b of texts)
                row += tally(first(a), second(b));
        }
        let sum = 0;
        for (let i = 0; i < row.length; i++)
            sum = (sum * 31 + row.charCodeAt(i)) | 0;
        lines.push(forms.indexOf(first) + " " + forms.indexOf(second) + " " + sum + " " + row.slice(0, 44));
    }
}
function kindOf(type) {
    if (type === "div") return 1;
    if (type === "span") return 2;
    if (type === "section") return 3;
    if (type === "children") return 4;
    if (type === "") return 5;
    if (type === undefined) return 6;
    if (type === null) return 7;
    if (type === 0) return 8;
    return 0;
}
lines.push(["div", "span", "section", "children", "", undefined, null, 0, -0, "di", "divv", cut("div"), joined("section"), named("children"), parsed("span"), 1, {}, "0"].map(kindOf).join(""));
lines.push("compared " + count);
console.log(lines.join("\n"));
