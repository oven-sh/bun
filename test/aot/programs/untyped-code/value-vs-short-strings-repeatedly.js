// switch (x) { case "a": .. case "bc": .. } and if (x === "a") .. else if (x === "bc") ..: one value against many short texts. The value: strings of every length from none to nine, flat,
// ropes, parts of longer strings at every place in memory, of 16 bits with the same characters, with a NUL at the end, Latin-1; and what is no string at all.
const lines = [];
function bySwitch(x) {
    switch (x) {
    case "": return "empty";
    case "$": return "dollar";
    case "L": return "L";
    case "@": return "at";
    case "u": return "u";
    case "ab": return "ab";
    case "abc": return "abc";
    case "GET": return "GET";
    case "POST": return "POST";
    case "abcde": return "abcde";
    case "delete": return "delete";
    case "options": return "options";
    case "function": return "function";
    case "undefined": return "the text undefined";
    case "é": return "e acute";
    case "a\0": return "a and NUL";
    case "a": return "a";
    case 1: return "one";
    case null: return "null";
    case undefined: return "undefined";
    default: return "other";
    }
}
function byChain(x) {
    if (x === "a") return 1;
    else if ("b" === x) return 2;
    else if (x === "ab") return 3;
    else if (x === "abcdefg") return 4;
    else if (x === "abcdefgh") return 5;
    if (x !== "no" && x !== "off" && x !== "") return 6;
    return 7;
}
function inArms(x, y) {
    let found = "";
    if (y) {
        if (x === "one") found += "1";
        if (x === "two") found += "2";
    } else if (x === "one") found += "first";
    if (x === "two" || x === "one" || x === "six") found += "!";
    return found;
}
function glue(a, b) { return a + b; }
const wide = "abcdefghijĀ";
const values = [
    "", "$", "L", "@", "u", "a", "b", "ab", "abc", "GET", "POST", "abcde", "delete", "options", "function", "undefined", "abcdefg", "abcdefgh", "abcdefghi", "no", "off", "one", "two", "six",
    "é", "éé", "a\0", "\0", "\0a", "a\0\0", "A", "get", "Post", "$$", "u ", " u", "Ā", "aĀ",
    glue("a", "b"), glue("ab", "c"), glue("PO", "ST"), glue("opt", "ions"), glue("func", "tion"), glue("", "u"), glue("abcd", "efg"), glue("abcd", "efgh"), glue(glue("d", "el"), glue("et", "e")),
    wide.slice(0, 1), wide.slice(0, 2), wide.slice(0, 3), wide.slice(0, 5), wide.slice(0, 7), wide.slice(0, 8), wide.slice(1, 2), wide.slice(10), wide.slice(9),
    0, 1, -0, 1.5, NaN, null, undefined, true, false, 10n, Symbol.iterator, {}, [], ["a"], new String("a"), { toString() { return "a"; } }, function () {}, /a/,
];
lines.push(values.map(bySwitch).join());
lines.push(values.map(byChain).join(""));
lines.push(values.map(x => inArms(x, true) + "|" + inArms(x, false)).join());
lines.push(bySwitch("u"), bySwitch(glue("P", "OST")), bySwitch(7), String(byChain("ab")), String(byChain(undefined)), inArms("one", 1), inArms("two", 0));
function calledInStraightLines(x) {
    switch (x) {
    case "": return "empty";
    case "$": return "dollar";
    case "L": return "L";
    case "@": return "at";
    case "u": return "u";
    case "ab": return "ab";
    case "abc": return "abc";
    case "POST": return "POST";
    case "abcde": return "abcde";
    case "delete": return "delete";
    case "options": return "options";
    case "function": return "function";
    case "a\0": return "a and NUL";
    case "a": return "a";
    default: return x === "no" || x === "off" || x === "six" ? "refusal" : "other";
    }
}
const straight = [];
straight.push(calledInStraightLines(values[0]));
straight.push(calledInStraightLines(values[1]));
straight.push(calledInStraightLines(values[2]));
straight.push(calledInStraightLines(values[3]));
straight.push(calledInStraightLines(values[4]));
straight.push(calledInStraightLines(values[5]));
straight.push(calledInStraightLines(values[6]));
straight.push(calledInStraightLines(values[7]));
straight.push(calledInStraightLines(values[8]));
straight.push(calledInStraightLines(values[9]));
straight.push(calledInStraightLines(values[10]));
straight.push(calledInStraightLines(values[11]));
straight.push(calledInStraightLines(values[12]));
straight.push(calledInStraightLines(values[13]));
straight.push(calledInStraightLines(values[14]));
straight.push(calledInStraightLines(values[15]));
straight.push(calledInStraightLines(values[16]));
straight.push(calledInStraightLines(values[17]));
straight.push(calledInStraightLines(values[18]));
straight.push(calledInStraightLines(values[19]));
straight.push(calledInStraightLines(values[20]));
straight.push(calledInStraightLines(values[21]));
straight.push(calledInStraightLines(values[22]));
straight.push(calledInStraightLines(values[23]));
straight.push(calledInStraightLines(values[24]));
straight.push(calledInStraightLines(values[25]));
straight.push(calledInStraightLines(values[26]));
straight.push(calledInStraightLines(values[27]));
straight.push(calledInStraightLines(values[28]));
straight.push(calledInStraightLines(values[29]));
straight.push(calledInStraightLines(values[30]));
straight.push(calledInStraightLines(values[31]));
straight.push(calledInStraightLines(values[32]));
straight.push(calledInStraightLines(values[33]));
straight.push(calledInStraightLines(values[34]));
straight.push(calledInStraightLines(values[35]));
straight.push(calledInStraightLines(values[36]));
straight.push(calledInStraightLines(values[37]));
straight.push(calledInStraightLines(values[38]));
straight.push(calledInStraightLines(values[39]));
straight.push(calledInStraightLines(values[40]));
straight.push(calledInStraightLines(values[41]));
straight.push(calledInStraightLines(values[42]));
straight.push(calledInStraightLines(values[43]));
straight.push(calledInStraightLines(values[44]));
straight.push(calledInStraightLines(values[45]));
straight.push(calledInStraightLines(values[46]));
straight.push(calledInStraightLines(values[47]));
straight.push(calledInStraightLines(values[48]));
straight.push(calledInStraightLines(values[49]));
straight.push(calledInStraightLines(values[50]));
straight.push(calledInStraightLines(values[51]));
straight.push(calledInStraightLines(values[52]));
straight.push(calledInStraightLines(values[53]));
straight.push(calledInStraightLines(values[54]));
straight.push(calledInStraightLines(values[55]));
straight.push(calledInStraightLines(values[56]));
straight.push(calledInStraightLines(values[57]));
straight.push(calledInStraightLines(values[58]));
straight.push(calledInStraightLines(values[59]));
straight.push(calledInStraightLines(values[60]));
straight.push(calledInStraightLines(values[61]));
straight.push(calledInStraightLines(values[62]));
straight.push(calledInStraightLines(values[63]));
straight.push(calledInStraightLines(values[64]));
straight.push(calledInStraightLines(values[65]));
straight.push(calledInStraightLines(values[66]));
straight.push(calledInStraightLines(values[67]));
straight.push(calledInStraightLines(values[68]));
straight.push(calledInStraightLines(values[69]));
straight.push(calledInStraightLines(values[70]));
straight.push(calledInStraightLines(values[71]));
straight.push(calledInStraightLines(values[72]));
straight.push(calledInStraightLines(values[73]));
lines.push(straight.join());
const long = "GETPOSTabcdeleteoptionsu$L@".repeat(400);
const seen = new Map;
const counts = {};
const others = {};
const reachedThroughAnArray = [calledInStraightLines, bySwitch][Number(lines.length > 1000)];
for (let length = 1; length <= 8; length++) {
    for (let at = 0; at + length <= long.length; at += 1) {
        const part = long.slice(at, at + length);
        if (at % 3 === 0) seen.set(part, at);
        const answer = bySwitch(part);
        counts[answer] = (counts[answer] || 0) + 1;
        counts.chain = (counts.chain || 0) + byChain(part);
        const other = reachedThroughAnArray(part);
        others[other] = (others[other] || 0) + 1;
    }
}
lines.push(JSON.stringify(counts), JSON.stringify(others), String(seen.size));
console.log(lines.join("\n"));
