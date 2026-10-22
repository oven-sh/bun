// Strings that are built and consumed within one function.
// REMARK+ keyOfIdsLoop (Add|Strcat): stack
// REMARK- keyOfIdsLoop rejected
// REMARK+ keyDashLoop (Add|Strcat): stack
// REMARK- keyDashLoop rejected
// REMARK+ acrossBranches (Add|Strcat): stack
// REMARK- acrossBranches rejected
// REMARK+ lengthsInBetween (Add|Strcat): stack
// REMARK+ startedAgain (Add|Strcat): stack
// REMARK+ nested (Add|Strcat): stack
// REMARK- nested rejected
// REMARK+ numbersInLoop (Add|Strcat): stack
// REMARK+ numbersMayBeNil (Add|Strcat): stack
// REMARK+ wordsAndNumbers (Add|Strcat): stack
// REMARK+ startsWithText (Add|Strcat): stack
// REMARK+ startsFromString (Add|Strcat): stack
// REMARK+ readAfterLoop (Add|Strcat): stack
// REMARK+ nearTheLimit (Add|Strcat): stack
// REMARK- nearTheLimit rejected
// REMARK+ withNilOperands (Add|Strcat): stack
// REMARK+ readsBetween (Add|Strcat): stack
// REMARK- readsBetween rejected
// REMARK- nilPlusNumber stack
// REMARK- wordsNotAKey stack
// IRT= 1 wordsNotAKey  = StringBuilderFinish 
// REMARK- readByIndex stack
// REMARK+ readByIndex rejected: intermediate value escapes
// REMARK- compared stack
// REMARK- passedOn stack
// REMARK- reinitialized stack
// REMARK- onlyStrings stack
// IRT= 1 onlyStrings  = StringBuilderFinish 
// REMARK- withHandler stack
// REMARK- putInFront stack
// REMARK- addedToTwice stack
// REMARK- mayStartWithNil stack
// REMARK+ mayStartWithNil rejected: initial value may not be a string
// REMARK- oneNumber stack
// REMARK- withObject stack
// CALLS+ keyOfIdsLoop StringBuilderFinish
// CALLS- keyOfIdsLoop operationAOTConcat\b|IntToString
// CALLS+ keyDashLoop StringBuilder(Finish|Flush)
// CALLS- keyDashLoop operationAOTConcat\b|IntToString
// CALLS+ lookUp ConcatenateWithIntegers|StringBuilderFinish
// CALLS- notAKey ConcatenateWithIntegers|StringBuilder
// CALLS- readByIndex StringBuilder
// CALLS- onlyStrings StringBuilder
// CALLS- wordsNotAKey StringBuilder

interface T { id: number }
interface R { target: T; args: T[] }
interface N { id: number; inner: N[] }

const outside = new Function("f", "return (...a) => f(...a)") as <F>(f: F) => F;

function keyOfIdsLoop(types: readonly T[] | undefined) {
    let result = "";
    if (types) {
        const length = types.length;
        let i = 0;
        while (i < length) {
            const startId = types[i].id;
            let count = 1;
            while (i + count < length && types[i + count].id === startId + count) {
                count++;
            }
            if (result.length) {
                result += ",";
            }
            result += startId;
            if (count > 1) {
                result += ":" + count;
            }
            i += count;
        }
    }
    return result;
}

function keyTemplate3(a: T, b: T, postFix: string): string {
    while (a.id > b.id) {
        const c = a;
        a = b;
        b = c;
    }
    return `${a.id},${b.id}${postFix}`;
}

function lookUp(m: Map<string, number>, a: T, b: T, postFix: string) {
    return m.get(keyTemplate3(a, b, postFix));
}

function notAKey(a: T, b: T, postFix: string): string {
    while (a.id > b.id) {
        const c = a;
        a = b;
        b = c;
    }
    return `${a.id},${b.id}${postFix}`;
}

function keyDashLoop(type: R) {
    let result = "" + type.target.id;
    for (const t of type.args) {
        result += "-" + t.id;
    }
    return result;
}

function acrossBranches(set: Set<string>, n: number, flag: boolean) {
    let s = "k" + n;
    if (flag) s += ":" + n;
    else s += "!";
    const key = s + ";" + n;
    set.add(key);
    return key;
}

function notAKeyAcrossBranches(n: number, flag: boolean) {
    let s = "k" + n;
    if (flag) s += ":" + n;
    else s += "!";
    return s + ";" + n;
}

function numberBetween(set: Set<string>, x: number) {
    const key = "<" + x + ">";
    set.add(key);
    return key;
}

function wordsAndNumbers(set: Set<string>, words: string[]) {
    let s = "";
    for (const word of words) {
        s += word;
        s += word.length;
        s += ",";
    }
    set.add(s);
    return s;
}

function wordsNotAKey(words: string[]) {
    let s = "";
    for (const word of words) {
        s += word;
        s += word.length;
        s += ",";
    }
    return s;
}

function numbersInLoop(xs: T[]) {
    let s = "";
    for (const o of xs) {
        s += o.id;
        s += "|";
    }
    return s;
}

function numbersMayBeNil(xs: (number | undefined | null)[]) {
    let s = "";
    for (const x of xs) {
        s += x;
        s += "|";
    }
    return s;
}

function readAfterLoop(ids: T[]) {
    let s = "";
    for (const t of ids) {
        s += t.id;
        s += ".";
    }
    return s.charCodeAt(0) + ":" + s.length + ":" + s.slice(1) + (s === "7.8." ? "!" : "?");
}

function mayStartWithNil(start: string | undefined, ids: T[]) {
    let s = start;
    for (const t of ids) {
        s += "," + t.id;
    }
    return s;
}

function startsFromString(set: Set<string>, start: string, ids: T[]) {
    let s = `${start}`;
    for (const t of ids) {
        s += t.id;
        s += ",";
    }
    set.add(s);
    return s;
}

function withNilOperands(set: Set<string>, words: (string | undefined | null)[], ids: T[]) {
    let s = "";
    for (let i = 0; i < ids.length; i++) {
        s += "<" + words[i] + ">" + ids[i].id;
        s += `${words[i]}`;
    }
    set.add(s);
    return s;
}

function readsBetween(firsts: T[], seconds: T[]) {
    let s = "";
    for (let i = 0; i < firsts.length; i++) s += "<" + firsts[i].id + ">" + seconds[i].id + ";";
    return s;
}

function nilPlusNumber(words: (string | undefined)[], ids: T[]) {
    let s = "";
    for (let i = 0; i < ids.length; i++) {
        s += (words[i] as any) + ids[i].id;
        s += ",";
    }
    return s;
}

function nearTheLimit(set: Set<string>, words: string[], steps: { n: number }) {
    let s = "";
    for (const word of words) {
        s += word;
        steps.n++;
        s += word.length;
        steps.n++;
        s += "..";
        steps.n++;
    }
    if (steps.n < 0) set.add(s);
    return s.length;
}

function lengthsInBetween(count: number) {
    let s = "";
    for (let i = 0; i < count; i++) {
        s += s.length;
        s += "|";
    }
    return s;
}

function startedAgain(rows: T[][]) {
    const all: string[] = [];
    for (const row of rows) {
        let s = "";
        for (const t of row) {
            s += t.id;
            s += ";";
        }
        all.push(s);
    }
    return all;
}

function nested(n: N, depth: number): string {
    let result = "" + n.id;
    for (const inner of n.inner) {
        if (depth < 4 && inner.inner.length) {
            result += "<" + nested(inner, depth + 1) + ">";
            continue;
        }
        result += "-" + inner.id;
    }
    return result;
}

function nestedIsKnown(set: Set<string>, n: N) {
    return set.has(nested(n, 0));
}

function startsWithText(ids: T[]) {
    let s = "ids:";
    for (const t of ids) {
        s += t.id;
        s += " ";
    }
    return s;
}

function readByIndex(ids: T[]) {
    let s = "";
    let ones = 0;
    for (const t of ids) {
        s += t.id;
        if (s[0] === "1") ones++;
        s += ",";
    }
    return s + ones;
}

function compared(ids: T[]) {
    let s = "";
    let same = 0;
    for (const t of ids) {
        s += t.id;
        if (s === "12") same++;
        s += ",";
    }
    return s + same;
}

const seen: string[] = [];
function keep(s: string) { seen.push(s); }
const keepOutside = outside(keep);
function passedOn(ids: T[]) {
    let s = "";
    for (const t of ids) {
        s += t.id;
        keepOutside(s);
        s += ",";
    }
    return s;
}

function reinitialized(ids: T[], others: string[]) {
    let s = "";
    for (let i = 0; i < ids.length; i++) {
        s += ids[i].id;
        if (ids[i].id > 5) s = `${others[i]}`;
    }
    return s;
}

function onlyStrings(words: string[]) {
    let s = "";
    for (const word of words) {
        s += word;
        s += " ";
    }
    return s;
}

function withHandler(ids: T[]) {
    let s = "";
    try {
        for (const t of ids) {
            s += t.id;
            s += ",";
            if (t.id < 0) throw new Error("negative after " + s);
        }
    } catch (e) {
        return s + (e as Error).message;
    }
    return s;
}

function putInFront(ids: T[]) {
    let s = "";
    for (const t of ids) {
        s = t.id + "," + s;
    }
    return s;
}

function addedToTwice(n: number) {
    const s = "a" + n;
    const t = s + 1;
    const u = s + 2;
    return t + u;
}

function oneNumber(n: number) {
    return "" + n;
}

let order = "";
const talks = { toString() { order += "t"; return "obj"; } };
function withObject(ids: T[], o: { toString(): string }) {
    let s = "";
    for (const t of ids) {
        s += t.id;
        order += "1";
        s += o;
        order += "2";
    }
    return s;
}

function show(name: string, value: string) {
    console.log(name, JSON.stringify(value), value.length);
}

const t = (id: number): T => ({ id });
const set = new Set<string>();
const lists: (T[] | undefined)[] = [undefined, [], [t(7)], [t(1), t(2), t(3)], [t(5), t(9)], [t(100000), t(100001), t(7), t(99999999), t(100000000), t(2147483647)], [t(0), t(0), t(1)], [t(-1), t(-2)], [t(1.5), t(2.5)]];
const f1 = outside(keyOfIdsLoop);
for (const list of lists) show("keyOfIdsLoop", f1(list));
const many: T[] = [];
for (let i = 0; i < 300; i++) many.push(t(i * 7919 % 100003));
show("keyOfIdsLoop many", f1(many));
console.log("as a key", new Map([["123456,123458", 1]]).get(f1([t(123456), t(123458)])));

const f2 = outside(keyTemplate3);
for (const post of ["", ":1", ":12345678", "é", "→", "x".repeat(200), "ab".repeat(30) + "→"]) show("keyTemplate3", f2(t(123457), t(123456), post));
show("keyTemplate3 rope", f2(t(1), t(2), "left".repeat(3) + many.length + "right"));
show("keyTemplate3 part", f2(t(1), t(2), "0123456789abcdefghij".slice(many.length - 297, 15)));
console.log("lookUp", outside(lookUp)(new Map([["1,2:3", 4]]), t(1), t(2), ":3"), outside(lookUp)(new Map([["1,2:3", 4]]), t(1), t(2), ":4"));
show("notAKey", outside(notAKey)(t(2), t(1), ":3"));

const f3 = outside(keyDashLoop);
show("keyDashLoop", f3({ target: t(111), args: [] }));
show("keyDashLoop", f3({ target: t(111), args: [t(0), t(12), t(1)] }));
show("keyDashLoop", f3({ target: t(111), args: many }));

const f4 = outside(acrossBranches);
show("acrossBranches", f4(set, 5, true));
show("acrossBranches", f4(set, 5, false));
show("acrossBranches", f4(set, -0, true));
show("notAKeyAcrossBranches", outside(notAKeyAcrossBranches)(5, true));
show("notAKeyAcrossBranches", outside(notAKeyAcrossBranches)(5, false));

const numbers = [0, -0, 1, 9, 10, 99, 100, 12345678, 99999999, 100000000, 123456789, 2147483647, 2147483648, 4294967295, 4294967296, -1, -2147483648, 1.5, -1.5, 1e21, 1e-7, 123456789012345680000, NaN, Infinity, -Infinity, 0.1 + 0.2, 2 ** 53, 5e-324];
for (const x of numbers) show("numberBetween", outside(numberBetween)(set, x));
show("numbersInLoop", outside(numbersInLoop)(numbers.map(t)));
for (const x of numbers) show("numbersInLoop", outside(numbersInLoop)([t(x)]));
show("numbersMayBeNil", outside(numbersMayBeNil)([1, undefined, 22, null, 1.5, -0, NaN, 123456789, undefined]));
show("numbersMayBeNil", outside(numbersMayBeNil)(numbers));
show("readAfterLoop", outside(readAfterLoop)([t(7), t(8)]));
show("readAfterLoop", outside(readAfterLoop)(many));
show("mayStartWithNil", String(outside(mayStartWithNil)(undefined, [t(1)])));
show("mayStartWithNil", String(outside(mayStartWithNil)("a", [t(1), t(2)])));
for (const start of ["", "s:", "→", "x".repeat(127), "x".repeat(200), "left" + many.length + "right"]) show("startsFromString", outside(startsFromString)(set, start, [t(1), t(22)]));
show("withNilOperands", outside(withNilOperands)(set, ["a", undefined, null, "", "→", "x".repeat(140)], [t(1), t(2), t(3), t(4), t(5), t(6), t(7)]));
show("readsBetween", outside(readsBetween)([t(1), t(22), t(333)], [t(4), t(55), t(666)]));
show("readsBetween", outside(readsBetween)(many, many));
try { show("readsBetween", outside(readsBetween)([t(1), t(2)], [t(3)])); } catch (e) { show("readsBetween throws", (e as Error).constructor.name); }
show("nilPlusNumber", outside(nilPlusNumber)(["a", undefined], [t(1), t(2)]));

const f6 = outside(lengthsInBetween);
for (const count of [0, 1, 5, 40, 90]) show("lengthsInBetween", f6(count));
console.log("startedAgain", JSON.stringify(outside(startedAgain)([[], [t(1)], [t(2), t(3)], many.slice(0, 40), []])));

const leaf = (id: number): N => ({ id, inner: [] });
const tree: N = { id: 1, inner: [leaf(2), { id: 3, inner: [leaf(4), { id: 5, inner: [leaf(6)] }] }, leaf(7)] };
show("nested", outside(nested)(tree, 0));
console.log("nestedIsKnown", outside(nestedIsKnown)(new Set(["1-2<3-4<5-6>>-7"]), tree), outside(nestedIsKnown)(new Set(["1-2"]), tree));

const f8 = outside(wordsAndNumbers);
const source = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(8);
const kinds: string[][] = [[], [""], ["", ""], ["a"], ["→"], ["é"], ["ab", "→", "cd"], ["x".repeat(127)], ["x".repeat(128)], ["x".repeat(129)], ["x".repeat(120), "y".repeat(8)], ["x".repeat(120), "y".repeat(5)],
    ["x".repeat(300), "a", "y".repeat(300), "b"], [source.slice(many.length - 297, 20), source.slice(many.length - 299, 200)], ["left" + many.length + "right".repeat(many.length - 298), "z"], ["→".repeat(70), "a".repeat(70), "→"]];
for (const words of kinds) show("wordsAndNumbers", f8(set, words));
for (let n = 0; n < 40; n++) show("wordsAndNumbers", f8(set, [source.slice(0, n), source.slice(n, 2 * n + 1), source.slice(0, 3 * n)]));
show("wordsNotAKey", outside(wordsNotAKey)(["ab", "cde", "x".repeat(200)]));

show("startsWithText", outside(startsWithText)([]));
show("startsWithText", outside(startsWithText)([t(1), t(22), t(333)]));
show("readByIndex", outside(readByIndex)([t(1), t(2), t(3)]));
show("compared", outside(compared)([t(12), t(2), t(3)]));
show("passedOn", outside(passedOn)([t(1), t(2), t(3)]));
console.log("seen", JSON.stringify(seen));
show("reinitialized", outside(reinitialized)([t(1), t(7), t(2), t(3)], ["a", "b", "c", "d"]));
show("onlyStrings", outside(onlyStrings)(["a", "bc", ""]));
show("withHandler", outside(withHandler)([t(1), t(2), t(3)]));
show("withHandler", outside(withHandler)([t(1), t(-2), t(3)]));
show("putInFront", outside(putInFront)([t(1), t(2), t(3)]));
show("addedToTwice", outside(addedToTwice)(5));
show("oneNumber", outside(oneNumber)(42));
show("withObject", outside(withObject)([t(1), t(2)], talks));
console.log("order", order);
console.log("set", set.size, [...set].join(" ").length, set.has("k5:5;5"), set.has("<1e+21>"), set.has("ab2,cde3,"));

const powers: string[] = ["x"];
for (let k = 1; k < 31; k++) powers.push(powers[k - 1] + powers[k - 1]);
function ropeOfLength(length: number) {
    let rope = "";
    for (let k = 0; k < 31; k++) {
        if (length & (1 << k)) rope = rope + powers[k];
    }
    return rope;
}
const f9 = outside(nearTheLimit);
function atTheLimit(short: number, words: string[]) {
    const steps = { n: 0 };
    let outcome: string;
    try {
        outcome = String(f9(set, [ropeOfLength(2 ** 31 - 1 - short), ...words], steps));
    } catch (e) {
        outcome = (e as Error).name + ": " + (e as Error).message;
    }
    console.log("nearTheLimit", short, steps.n, outcome);
}
for (let short = 0; short < 40; short++) atTheLimit(short, ["", "ab", "cdefgh"]);
for (const short of [120, 127, 128, 129, 130, 140, 200, 300]) atTheLimit(short, ["a".repeat(50), "b".repeat(60), "c".repeat(70), "d".repeat(130)]);
