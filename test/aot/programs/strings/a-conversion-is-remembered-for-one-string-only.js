// What the conversion of a string gave is remembered by the string itself. A string that dies leaves its place to another string, which has another text: the answer for the first says nothing about the second.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const collect = typeof Bun === "object" ? () => Bun.gc(true) : () => {};
const hide = (0, eval)("(value) => value");

const heads = ["Content", "ACCEPT", "x", "Set", "IF", "Last", "www", "Transfer", "ETag", "Üb"];
const tails = ["Type", "ENCODING", "powered-by", "Cookie", "None-Match", "Modified", "Authenticate", "Encoding", "", "er"];
function make(round, index) {
    // A flat string of its own each time.
    return hide((heads[(index + round) % heads.length] + "-" + tails[(index * 3 + round) % tails.length] + (round % 7)).split("").join(""));
}
function slowly(text, isLower) {
    let result = "";
    for (const letter of text) {
        const unit = letter.charCodeAt(0);
        if (isLower && unit >= 65 && unit <= 90)
            result += String.fromCharCode(unit + 32);
        else if (!isLower && unit >= 97 && unit <= 122)
            result += String.fromCharCode(unit - 32);
        else if (unit === 0xdc && isLower)
            result += "ü";
        else
            result += letter;
    }
    return result;
}

let wrong = 0;
let sum = 0;
for (let round = 0; round < 400; round++) {
    const kept = [];
    for (let index = 0; index < 300; index++) {
        const text = make(round, index);
        // The same string twice, both ways, so that the second question finds what the first left.
        const lower = text.toLowerCase();
        const upper = text.toUpperCase();
        if (lower !== text.toLowerCase() || upper !== text.toUpperCase() || lower !== slowly(text, true) || (text.charCodeAt(0) < 128 && upper !== slowly(text, false)))
            wrong++;
        sum += lower.length + upper.charCodeAt(0);
        if (index % 50 === 0)
            kept.push(text, lower, upper);
    }
    if (round % 20 === 0) {
        collect();
        // What is kept answers as before.
        for (let index = 0; index < kept.length; index += 3) {
            if (kept[index].toLowerCase() !== kept[index + 1] || kept[index].toUpperCase() !== kept[index + 2])
                wrong++;
        }
    }
}
say("wrong", wrong, "sum", sum);

// One string, asked again and again, between collections.
const name = hide(["Content", "Length"].join("-"));
let same = 0;
for (let turn = 0; turn < 2000; turn++) {
    if (name.toLowerCase() === "content-length" && name.toUpperCase() === "CONTENT-LENGTH")
        same++;
    if (turn % 500 === 0)
        collect();
}
say("same", same);

// Ropes, wide strings, strings that stay as they are, the empty string, one letter.
for (const text of [hide("Ab") + hide("Cd"), hide("Ω") + "Mega", "already lower", "ALREADY UPPER", "", "Q", "q", "İstanbul", "ß"]) {
    for (let turn = 0; turn < 3; turn++)
        say(JSON.stringify(text), JSON.stringify(text.toLowerCase()), JSON.stringify(text.toUpperCase()));
}
console.log(lines.join("\n"));
