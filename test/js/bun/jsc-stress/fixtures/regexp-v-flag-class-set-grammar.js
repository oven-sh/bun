// @bun
// The contents of a character class of a pattern with the v flag are a ClassSetExpression:
//
//   ClassSetExpression :: ClassUnion | ClassIntersection | ClassSubtraction
//   ClassUnion         :: (ClassSetRange | ClassSetOperand)+
//   ClassIntersection  :: ClassSetOperand (&& ClassSetOperand)+
//   ClassSubtraction   :: ClassSetOperand (-- ClassSetOperand)+
//   ClassSetRange      :: ClassSetCharacter - ClassSetCharacter
//   ClassSetOperand    :: NestedClass | ClassStringDisjunction | ClassSetCharacter
//   NestedClass        :: [ ClassContents ] | [^ ClassContents ] | \ CharacterClassEscape
//
// A class is one of the three, never a mix: operands with nothing between them are a ClassUnion, and the grammar has
// no && or -- after one. A nested class is a class of its own, whatever is before it in the class around it.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(`${what}: expected ${expected} but got ${actual}`);
}

function errorOf(callback) {
    try {
        callback();
    } catch (error) {
        return error;
    }
    return null;
}

// Each set is tried alone and in a pattern that is long enough for lazy pattern construction, which only runs the
// syntax check when the RegExp is created.
const filler = "(?:" + "z".repeat(70) + ")?";
const forms = [set => set, set => set + filler];

function isRefused(set) {
    let refused;
    for (const form of forms) {
        const error = errorOf(() => new RegExp(form(set), "v"));
        if (error && !(error instanceof SyntaxError))
            throw error;
        if (refused !== undefined)
            shouldBe(!!error, refused, `/${set}/v in a long pattern is refused`);
        refused = !!error;
    }
    return refused;
}

function shouldBeRefused(set) {
    shouldBe(isRefused(set), true, `/${set}/v is refused`);

    // The same early error for a literal, in code that never runs.
    const error = errorOf(() => new Function(`if (false) return /${set}/v;`));
    shouldBe(error instanceof SyntaxError, true, `a literal /${set}/v is an early error`);
}

function shouldMatch(set, matching, nonMatching, flags = "v", triedForms = forms) {
    // The early error check of a literal, in code that never runs, accepts it as well.
    new Function(`if (false) return /^(?:${set})$/${flags};`);

    for (const form of triedForms) {
        const regExp = new RegExp("^(?:" + form(set) + ")$", flags);
        for (const string of matching)
            shouldBe(regExp.test(string), true, `/${set}/${flags} matches ${JSON.stringify(string)}`);
        for (const string of nonMatching)
            shouldBe(regExp.test(string), false, `/${set}/${flags} matches ${JSON.stringify(string)}`);
    }
}

for (const set of [
    // Operands with nothing between them are a ClassUnion. No operator comes after one.
    "[ab&&c]",
    "[a\\x62&&c]",
    "[a\\d&&c]",
    "[\\d\\w&&a]",
    "[\\p{L}\\p{N}--\\p{Lu}]",
    "[a\\q{ab}&&b]",
    "[\\q{ab}\\q{cd}--a]",
    "[a[b]&&c]",
    "[[a][b]--c]",
    "[^a\\q{ab}&&\\d]",
    "[^a\\q{ab}&&b]",
    "[\\d[b]--c]",
    "[\\q{ab}\\d&&a]",
    // Neither does one after a range, which only a ClassUnion has.
    "[a-c&&b]",
    "[a-c--b]",
    "[a&&b-c]",
    // An operand of && or -- is one operand.
    "[a&&bc]",
    "[a&&b\\d]",
    "[a&&\\da]",
    "[a&&\\d\\w]",
    "[a--\\q{ab}b]",
    "[a--a[]]",
    "[a&&[b][c]]",
    // A class has one operator.
    "[a&&b--c]",
    "[a--b&&c]",
    "[[a&&b]--c&&d]",
    // An operator has an operand on both sides, in a nested class as well.
    "[&&a]",
    "[--a]",
    "[a&&]",
    "[a--]",
    "[[&&a]]",
    "[[--a]]",
    "[[a&&]]",
    "[[a--]]",
    "[\\d[&&]]",
    "[\\d[--b]]",
    "[\\q{ab}[--b]]",
    "[a-c[&&b]]",
    "[a&&[b--]]",
    "[a&&&b]",
    "[a&&&]",
    "[a&&--b]",
    "[a--&&b]",
    // A hyphen that is not between the two characters of a range.
    "[-a]",
    "[a-]",
    "[\\d-a]",
    "[\\d-]",
    "[a-\\d]",
    "[\\0-\\d]",
    "[\\0-\\P{L}]",
    "[\\0-\\q{a}]",
    "[a-c-e]",
    "[[a]-c]",
    "[a[]-b]",
    "[&[]-a]",
    "[a-[c]]",
    "[\\q{ab}-c]",
    "[a&&-]",
    "[a&&b-]",
    // The same with a nested class that is negated, and with a character that takes two code units.
    "[a[^b]&&c]",
    "[\\d[^--b]]",
    "[[^a--]]",
    "[a&&b[^c]]",
    "[\u{1F600}\\d&&a]",
    "[a&&\\d\u{1F600}]",
    "[\\d[--\u{1F600}]]",
    "[[\u{1F600}&&]]",
    // One operator for a class, however long the class is.
    "[a--a--a&&a]",
    "[a&&a&&a--a]",
    "[a&&a&&aa]",
    // A range that is out of order.
    "[c-a]",
    "[\\x63-a]",
    // A negated class that may contain strings, with the operands the grammar has.
    "[^\\q{ab}a]",
    "[^\\q{}.]",
    "[^a\\q{ab}]",
    "[^[\\q{ab}]\\d]",
]) {
    shouldBeRefused(set);
}

// A class that the pattern ends in. The filler is before the class here: after it, it would be in the class.
for (const set of ["[", "[^", "[a", "[\\d", "[a-", "[a-b", "[a&&", "[a--", "[a&&b", "[&&", "[--", "[-", "[&", "[a[", "[a[^", "[a&&[", "[\\d--[^", "[a&&-", "[[a]-", "[a-&", "[a&&[]", "[[]", "[\\d[a&&b]"]) {
    for (const source of [set, filler + set]) {
        const error = errorOf(() => new RegExp(source, "v"));
        shouldBe(error instanceof SyntaxError, true, `new RegExp of /${source}/v throws a SyntaxError`);
    }
}

for (const [set, matching, nonMatching] of [
    // A nested class is a class of its own: what is before it in the class around it does not matter.
    ["[\\q{ab}[a&&b]]", ["ab"], ["a", "b"]],
    ["[\\d[a&&a]]", ["1", "a"], ["b"]],
    ["[\\d[a&&b]]", ["1"], ["a", "b"]],
    ["[\\d[a--b]]", ["1", "a"], ["b"]],
    ["[\\q{ab}[a&&a]]", ["ab", "a"], ["b"]],
    ["[\\q{ab}[\\x61--b]]", ["ab", "a"], ["b"]],
    ["[a-c[x&&x]]", ["a", "b", "c", "x"], ["d"]],
    ["[[a][b&&b]]", ["a", "b"], ["c"]],
    ["[\\d[a&&a][b--b]]", ["1", "a"], ["b"]],
    ["[a-z[\\p{Lu}--[A-Z]]]", ["a", "z", "\u00c9"], ["A", "Z", "1"]],
    ["[\\w--[a-z[\\d&&5]]]", ["A", "_", "4"], ["a", "5"]],
    ["[\\d&&[\\d[5&&5]]]", ["5", "4"], ["a"]],
    ["[^\\d[a&&a]]", ["b"], ["1", "a"]],
    ["[a[]]", ["a"], ["b"]],
    ["[[]a]", ["a"], ["b"]],
    ["[[]&&a]", [], ["a"]],
    ["[a--[]]", ["a"], ["b"]],
    // Each of the three kinds, at two levels.
    ["[ab\\d\\q{cd}[e-g]]", ["a", "b", "1", "cd", "f"], ["c", "d", "h"]],
    ["[\\w&&[a-f]&&[d-z]]", ["d", "e", "f"], ["c", "g", "1"]],
    ["[\\w--\\d--[a-f]]", ["g", "_"], ["1", "a", "f"]],
    ["[[a-f]&&[d-z]]", ["d", "f"], ["a", "g"]],
    ["[[\\w--\\d]&&[a-c1]]", ["a", "c"], ["1", "d"]],
    ["[[a&&a]--[b&&b]]", ["a"], ["b"]],
    ["[a--a--a]", [], ["a"]],
    ["[a&&a&&a&&a]", ["a"], ["b"]],
    // A character that takes two code units, where the parser reads 16-bit code units.
    ["[\u{1F600}-\u{1F602}]", ["\u{1F601}"], ["\u{1F603}", "\ud83d"]],
    ["[\uffff-\u{1F600}]", ["\u{10000}"], ["\u{1F601}"]],
    ["[\\d[\u{1F600}&&\u{1F600}]]", ["1", "\u{1F600}"], ["a"]],
    ["[\u{1F600}[a--b]]", ["a", "\u{1F600}"], ["b"]],
    // What oniguruma-to-es writes for a class with a nested intersection.
    ["[0-9[\\p{L}&&\\p{ASCII}]]", ["5", "a"], ["\u00e9", "-"]],
    // A single & or an escaped - is a character.
    ["[a&b]", ["a", "&", "b"], ["c"]],
    ["[a\\-c]", ["a", "-", "c"], ["b"]],
    ["[a&&\\&]", [], ["a", "&"]],
    ["[\\--\\-]", ["-"], ["a"]],
    ["[\\---\\-]", [], ["-"]],
]) {
    shouldMatch(set, matching, nonMatching);
}

// A thousand classes deep. After a nested class, each class is the intersection or the union it was before.
shouldMatch("[a&&[ab".repeat(500) + "c]&&a]".repeat(500), ["a"], ["b", "c"]);

// A negated class in a class. The pattern builder takes long to complement one, so these are tried alone only.
for (const [set, matching, nonMatching] of [
    ["[\\d[^a&&a]]", ["1", "b"], ["a"]],
    ["[a[^b[c]]]", ["a", "d"], ["b", "c"]],
    ["[^a[b[^c]]]", ["c"], ["a", "b", "d"]],
    // What oniguruma-to-es writes for [a-z[:graph:]].
    ["[a-z[\\P{space}&&\\P{Cc}&&\\P{Cn}&&\\P{Cs}]]", ["a", "A", "1"], [" ", "\n"]],
    ["[a-f[\\p{L}&&[^m]]]", ["a", "z"], ["m", "1"]],
]) {
    shouldMatch(set, matching, nonMatching, "v", forms.slice(0, 1));
}

// The members of a ClassUnion in every order of their kinds, without and with case folding: the class is the same
// whichever member the parser knew it to be a union at.
for (const [set, matching, nonMatching, matchingIgnoreCase, nonMatchingIgnoreCase] of [
    ["[a\\x62]", ["a", "b"], ["c", "A"], ["a", "b", "A"], ["c"]],
    ["[a\\d]", ["a", "1"], ["b", "A"], ["a", "A", "1"], ["b"]],
    ["[\\da]", ["a", "1"], ["b", "A"], ["a", "A", "1"], ["b"]],
    ["[\\d\\w]", ["a", "1", "_"], ["-"], ["a", "A", "1", "_"], ["-"]],
    ["[\\s\\S]", ["a", " ", "\u{1F600}"], [], ["a", " ", "\u{1F600}"], []],
    ["[\\d\\D]", ["a", "1", "\u{1F600}"], [], ["a", "1", "\u{1F600}"], []],
    ["[a-z\\p{L}]", ["a", "z", "A", "\u00c9"], ["1", "_"], ["a", "z", "A", "\u00c9"], ["1", "_"]],
    ["[ab\\P{L}]", ["a", "b", "1", "_"], ["c", "A", "\u00e9"], ["a", "A", "1"], ["c", "\u00e9"]],
    ["[\\p{L}_\\p{N}]", ["a", "\u00c9", "1", "_"], ["-", " "], ["a", "\u00c9", "1", "_"], ["-", " "]],
    ["[k-m\\p{Lu}\\s]", ["l", "A", " "], ["a", "1"], ["l", "K", "a", " "], ["1"]],
    ["[a-c\\P{Lu}\\d]", ["a", "d", "1", "_"], ["A", "K"], ["a", "A", "1", "_"], ["d", "K"]],
    ["[a\\q{bc}]", ["a", "bc"], ["b", "BC"], ["a", "A", "bc", "BC"], ["b"]],
    ["[\\q{bc}\\d]", ["1", "bc"], ["b"], ["1", "bc", "BC"], ["b"]],
    ["[a[b]]", ["a", "b"], ["c", "A"], ["a", "b", "A"], ["c"]],
    ["[\\d[b]]", ["b", "1"], ["a"], ["b", "B", "1"], ["a"]],
    ["[[a][b]]", ["a", "b"], ["c"], ["a", "B"], ["c"]],
    ["[a-c[d]]", ["a", "c", "d"], ["e", "A"], ["a", "A", "D"], ["e"]],
]) {
    shouldMatch(set, matching, nonMatching);
    shouldMatch(set, matchingIgnoreCase, nonMatchingIgnoreCase, "iv");
}

// The grammar above, for a class made of the tokens below. The engine has to accept exactly the sets this accepts.
const characterValue = { "a": 0x61, "\\-": 0x2d };
const isCharacter = token => token in characterValue;
const isClassStart = token => token === "[" || token === "[^";

// The index after the ClassSetOperand that starts at tokens[i], or -1.
function operandEnd(tokens, i) {
    if (isClassStart(tokens[i]))
        return classEnd(tokens, i);
    return isCharacter(tokens[i]) || tokens[i] === "\\d" || tokens[i] === "\\q{a|b}" ? i + 1 : -1;
}

// The index after the ] of the class that starts at tokens[i], or -1 when its contents are not a ClassSetExpression.
function classEnd(tokens, i) {
    ++i;
    if (tokens[i] === "]")
        return i + 1;

    let next = operandEnd(tokens, i);
    const operator = tokens[next];
    if (next >= 0 && (operator === "&&" || operator === "--")) {
        // ClassIntersection or ClassSubtraction: operands with that one operator between them.
        while (tokens[next] === operator) {
            next = operandEnd(tokens, next + 1);
            if (next < 0)
                return -1;
        }
        return tokens[next] === "]" ? next + 1 : -1;
    }

    // ClassUnion: ranges and operands with nothing between them.
    while (tokens[i] !== "]") {
        if (isCharacter(tokens[i]) && tokens[i + 1] === "-") {
            if (!isCharacter(tokens[i + 2]) || characterValue[tokens[i + 2]] < characterValue[tokens[i]])
                return -1;
            i += 3;
            continue;
        }
        i = operandEnd(tokens, i);
        if (i < 0)
            return -1;
    }
    return i + 1;
}

const classTokens = ["a", "\\-", "\\d", "\\q{a|b}", "[", "]", "&&", "--", "-"];
let inGrammarCount = 0;
let notInGrammarCount = 0;

function check(inside) {
    for (const start of ["[", "[^"]) {
        const tokens = [start, ...inside, "]"];
        const inGrammar = classEnd(tokens, 0) === tokens.length;
        shouldBe(isRefused(tokens.join("")), !inGrammar, `/${tokens.join("")}/v is refused`);
        if (inGrammar)
            ++inGrammarCount;
        else
            ++notInGrammarCount;
    }
}

// False when the tokens do not nest, or when two of them would read as another token.
function canFollow(inside, depth, token) {
    if (token === "]" && !depth)
        return false;
    const last = inside[inside.length - 1];
    return !((token === "-" || token === "--") && (last === "-" || last === "--"));
}

// Every class of up to four tokens, or three where testLoopCount is lowered for a slow build.
const enumeratedLength = testLoopCount >= 10000 ? 4 : 3;
function enumerate(inside, depth) {
    if (!depth)
        check(inside);
    if (inside.length === enumeratedLength)
        return;
    for (const token of classTokens) {
        if (!canFollow(inside, depth, token))
            continue;
        inside.push(token);
        enumerate(inside, depth + isClassStart(token) - (token === "]"));
        inside.pop();
    }
}
enumerate([], 0);

// Longer ones from a fixed seed, fewer for a slow build.
let seed = 0x5eed;
function random() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

for (let i = 0; i < testLoopCount / 10; ++i) {
    const inside = [];
    let depth = 0;
    const length = 4 + Math.floor(random() * 6);
    while (inside.length < length) {
        const token = classTokens[Math.floor(random() * classTokens.length)];
        if (!canFollow(inside, depth, token))
            continue;
        inside.push(token);
        depth += isClassStart(token) - (token === "]");
    }
    while (depth--)
        inside.push("]");
    check(inside);
}

if (inGrammarCount < 100 || notInGrammarCount < 100)
    throw new Error(`the enumeration is off: ${inGrammarCount} sets in the grammar, ${notInGrammarCount} not`);
