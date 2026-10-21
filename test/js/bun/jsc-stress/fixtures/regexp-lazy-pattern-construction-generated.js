// @bun
// RegExp creation does not build a pattern of more than 64 characters (regexp-lazy-pattern-construction.js), and it
// still has to refuse what the build refuses. Each generated pattern is created twice: as it is, and followed by an
// empty group that is nested 65 deep, which makes creation build the pattern. Both are refused, or none is.
// A pattern that was created is then used once. That is where the build of a lazily created pattern happens, and
// where a build with assertions checks that it finds no error of its own.

let seed = 0x5eed;
function random() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick(list) { return list[Math.floor(random() * list.length)]; }
function chance(probability) { return random() < probability; }

// Counts on both sides of what YarrPatternConstructor::setupOffsets and the check at creation treat as large.
const largeCounts = ["16777100", "16777216", "1073741824", "1431655765", "1431655766", "2147483646", "2147483647", "2147483648", "4294967294", "4294967295", "4294967296", "99999999999", "18446744073709551615", "18446744073709551616"];
const smallCounts = ["0", "1", "2", "3", "7", "64", "1000"];
function count() { return chance(0.3) ? pick(largeCounts) : pick(smallCounts); }
function quantifier() {
    let choice = random();
    let result;
    if (choice < 0.15)
        result = "*";
    else if (choice < 0.3)
        result = "+";
    else if (choice < 0.4)
        result = "?";
    else if (choice < 0.62)
        result = `{${count()}}`;
    else if (choice < 0.8)
        result = `{${count()},}`;
    else
        result = `{${count()},${count()}}`;
    return result + (chance(0.15) ? "?" : "");
}

const characters = ["a", "b", "c", "x", "0", " ", "-", "_", "\u00e9", "\u{1F600}", "}", "]", "{", "{1", ","];
const escapes = ["\\d", "\\D", "\\w", "\\s", "\\b", "\\n", "\\0", "\\1", "\\2", "\\9", "\\k<n>", "\\cA", "\\x41", "\\u0041", "\\u{1F600}", "\\u{41}", "\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Emoji_Keycap_Sequence}", "\\P{Emoji_Keycap_Sequence}", "\\-", "\\/", "\\a", "\\8", "\\q{ab}"];
const classStrings = ["\\q{}", "\\q{a}", "\\q{ab}", "\\q{a|b}", "\\q{a|}", "\\q{|ab}", "\\q{abc|d|}", "\\q{\u{1F600}}", "\\q{a\u{1F600}}", "\\q{||}"];
const classEscapes = ["\\d", "\\w", "\\s", "\\p{L}", "\\P{L}", "\\p{Emoji_Keycap_Sequence}", "\\b", "\\-", "\\u{1F600}", "\\x41"];

function classItem(unicodeSets, depth) {
    let choice = random();
    if (choice < 0.3)
        return pick(["a", "b", "x", "0", "\u00e9", "\u{1F600}", "_"]);
    if (choice < 0.45)
        return pick(["a-z", "0-9", "z-a", "a-\\d", "\\d-a", "\\x61-c"]);
    if (choice < 0.65)
        return pick(classEscapes);
    if (choice < 0.8)
        return pick(classStrings);
    if (unicodeSets && depth < 3 && choice < 0.93)
        return characterClass(unicodeSets, depth + 1);
    return pick(["&&", "--", "&", "-", "^", "[", "|"]);
}
function characterClass(unicodeSets, depth) {
    let result = "[" + (chance(0.4) ? "^" : "");
    let items = 1 + Math.floor(random() * 3);
    // Mostly one operator for the whole class, as the grammar has it.
    let operator = chance(0.5) ? "" : pick(["&&", "--"]);
    for (let i = 0; i < items; ++i) {
        if (i && unicodeSets)
            result += chance(0.85) ? operator : pick(["", "&&", "--"]);
        result += classItem(unicodeSets, depth);
    }
    return result + (chance(0.97) ? "]" : "");
}
function atom(unicodeSets, depth) {
    let choice = random();
    if (choice < 0.3)
        return pick(characters);
    if (choice < 0.45)
        return pick(escapes);
    if (choice < 0.6)
        return characterClass(unicodeSets, 0);
    if (choice < 0.65)
        return ".";
    if (choice < 0.7)
        return pick(["^", "$"]);
    if (depth > 4)
        return pick(characters);
    let open = pick(["(", "(", "(?:", "(?:", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?i:", "(?-i:", "(?", "(?<"]);
    return open + alternatives(unicodeSets, depth + 1) + (chance(0.97) ? ")" : "");
}
function sequence(unicodeSets, depth) {
    let result = "";
    let atoms = 1 + Math.floor(random() * 4);
    for (let i = 0; i < atoms; ++i) {
        result += atom(unicodeSets, depth);
        if (chance(0.4))
            result += quantifier();
    }
    return result;
}
function alternatives(unicodeSets, depth) {
    let result = sequence(unicodeSets, depth);
    while (chance(0.2))
        result += "|" + sequence(unicodeSets, depth);
    return result;
}

const fillers = ["(?:" + "z".repeat(70) + ")?", "z".repeat(66), "(?:" + "zy".repeat(33) + ")*", "[zy]{0,3}" + "w".repeat(60), "(?:" + "z".repeat(33) + "|" + "y".repeat(33) + ")"];
const flagSets = ["", "", "i", "m", "y", "u", "u", "v", "v", "v", "iu", "iv"];
const builtAtCreation = "(?:".repeat(65) + ")".repeat(65);

function creationError(source, flags) {
    try {
        new RegExp(source, flags);
    } catch (error) {
        return error;
    }
    return null;
}

let refused = 0;
let created = 0;
function check(source, flags) {
    let error = creationError(source, flags);
    let errorWhenBuilt = creationError(source + builtAtCreation, flags);
    if (!error !== !errorWhenBuilt)
        throw new Error(`/${source}/${flags}: ${error ? "refused (" + error.message + ")" : "created"} when only the syntax is checked, ${errorWhenBuilt ? "refused (" + errorWhenBuilt.message + ")" : "created"} when the pattern is built`);
    if (error) {
        ++refused;
        return;
    }
    ++created;
    try {
        new RegExp(source, flags).test("ab");
    } catch {
        // The byte compiler has limits of its own, and reports them at the first match in both modes.
    }
}

// 3000 patterns and 1500 class sets, and fewer where testLoopCount is lowered for a slow build.
const patternCount = Math.floor(testLoopCount * 0.3);
const classSetCount = Math.floor(testLoopCount * 0.15);

for (let i = 0; i < patternCount; ++i) {
    let flags = pick(flagSets);
    let body = alternatives(flags.includes("v"), 0);
    let filler = pick(fillers);
    check(chance(0.5) ? filler + body : body + filler, flags);
}

// Class sets alone, where the grammar matters most.
for (let i = 0; i < classSetCount; ++i) {
    let set = characterClass(true, 0);
    check(set + fillers[0], "v");
}

if (refused < patternCount / 4 || created < patternCount / 4)
    throw new Error(`the generator is off: ${refused} patterns refused, ${created} created`);
