// Results of slice, substring, substr, charAt, at and [] that are only inspected answer like results that are also stored.
const narrow = "0123456789abcdefghijklmnopqrstuvwxyzé-42.5e1 ÿ0x1F";
const wide = "0123456789abcdefghijklmnopqrstuvwxyzā😀\ud83d-42.5e1 日本0x1F";
const raised = Array.from(narrow, unit => String.fromCharCode(unit.charCodeAt(0) + 0x100)).join("");
const nothing: any = undefined;

function copy(text: string): string {
    return text.split("").join("");
}

const bases: [string, () => string][] = [
    ["8-bit", () => copy(narrow)],
    ["16-bit", () => copy(wide)],
    ["8-bit rope", () => copy(narrow.slice(0, 20)) + copy(narrow.slice(20))],
    ["16-bit rope", () => copy(wide.slice(0, 38)) + copy(wide.slice(38))],
    ["8-bit substring", () => ("##" + copy(narrow) + "##").slice(2, -2)],
    ["16-bit substring", () => ("##" + copy(wide) + "##").slice(2, -2)],
    ["8-bit text in 16-bit storage", () => ("ā" + copy(narrow) + "ā").slice(1, -1)],
    ["every unit 0x100 higher", () => copy(raised)],
    ["one unit", () => copy("7")],
    ["empty", () => copy("")],
];

function flags(...answers: boolean[]): string {
    let text = "";
    for (const answer of answers) text += answer ? "1" : "0";
    return text;
}

function inspectSlice(x: string, a: number, b: number): string {
    const s = x.slice(a, b);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectStoredSlice(x: string, a: number, b: number, stored: (string | undefined)[]): string {
    const s = x.slice(a, b);
    stored.push(s);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectSubstring(x: string, a: number, b: number): string {
    const s = x.substring(a, b);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectStoredSubstring(x: string, a: number, b: number, stored: (string | undefined)[]): string {
    const s = x.substring(a, b);
    stored.push(s);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectSubstr(x: string, a: number, b: number): string {
    const s = x.substr(a, b);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectStoredSubstr(x: string, a: number, b: number, stored: (string | undefined)[]): string {
    const s = x.substr(a, b);
    stored.push(s);
    return `${flags(s === "", s === "345", s === "é-", s === "ā\ud83d", s === "ā😀", s === "0123456789abcdefghijklmnopqrstuvwxyz", s === "0123456789abcdefghijklmnopqrstuvwxyzā")} ${s.length}`
        + ` ${s.charCodeAt(0)} ${s.charCodeAt(1.5)} ${s.charCodeAt(-1)} ${s.charCodeAt(NaN)} ${s.charCodeAt(s.length - 1)} ${s.charCodeAt(s.length)}`
        + ` ${s.codePointAt(0)} ${s.codePointAt(1)} ${s.codePointAt(s.length - 1)} ${s.codePointAt(s.length)} ${Number(s)} ${parseInt(s)}`
        + ` ${s.slice(1, 3) === "45"} ${s.slice(-2).length} ${s.substring(2, 1).charCodeAt(0)} ${s.substr(1, 2).codePointAt(1)} ${s.charAt(1) === "4"} ${s.at(-1) === "5"} ${s[0] === "3"}`;
}

function inspectCharAt(x: string, i: number): string {
    const c = x.charAt(i);
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c > "2", c >= "é", "z" < c)} ${c.length} ${c.charCodeAt(0)} ${c.codePointAt(0)} ${Number(c)} ${parseInt(c)} ${c.slice(0, 1) === "3"}`;
}

function inspectStoredCharAt(x: string, i: number, stored: (string | undefined)[]): string {
    const c = x.charAt(i);
    stored.push(c);
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c > "2", c >= "é", "z" < c)} ${c.length} ${c.charCodeAt(0)} ${c.codePointAt(0)} ${Number(c)} ${parseInt(c)} ${c.slice(0, 1) === "3"}`;
}

function inspectAt(x: string, i: number): string {
    const c = x.at(i);
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c! > "2", c! >= "é", "z" < c!)} ${parseInt(c!)}`;
}

function inspectStoredAt(x: string, i: number, stored: (string | undefined)[]): string {
    const c = x.at(i);
    stored.push(c);
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c! > "2", c! >= "é", "z" < c!)} ${parseInt(c!)}`;
}

function inspectElement(x: string, i: number): string {
    const c = x[i];
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c > "2", c >= "é", "z" < c)} ${parseInt(c)}`;
}

function inspectStoredElement(x: string, i: number, stored: (string | undefined)[]): string {
    const c = x[i];
    stored.push(c);
    return `${flags(c === "", c === "3", c === "é", c === "ā", c === "\ud83d", c === "345", c > "2", c >= "é", "z" < c)} ${parseInt(c)}`;
}

function inspectUndefinedArguments(x: string, a: number): string {
    return `${x.slice(undefined, a).length} ${x.slice(a, undefined).length} ${x.slice(undefined, undefined).length} ${x.slice(undefined).charCodeAt(0)} ${x.slice(undefined, a) === "012"}`
        + ` ${x.substring(a, undefined).length} ${x.substring(nothing, a).length} ${x.substr(a, undefined).length} ${x.substr(nothing, a).length}`
        + ` ${x.charAt(nothing) === "0"} ${x.at(nothing) === "0"} ${x[nothing] === "0"}`;
}

function matchWideLiterals(x: string): string {
    return flags(
        x.slice(36, 37) === "ā", x.slice(36, 38) === "ā\ud83d", x.slice(36, 39) === "ā😀", x.slice(36, 40) === "ā😀\ud83d", x.slice(36, 41) === "ā😀\ud83d-",
        x.slice(36, 42) === "ā😀\ud83d-4", x.slice(36, 43) === "ā😀\ud83d-42", x.slice(36, 44) === "ā😀\ud83d-42.", x.slice(36, 45) === "ā😀\ud83d-42.5",
        x.slice(36, 45) === "ā😀\ud83d-42.6", x.slice(36, 45) === "Ā😀\ud83d-42.5", x.slice(36, 43) === "ā😀\ud83c-42", x.slice(35, 37) === "zā", x.slice(35, 37) === "zé",
    );
}

function scan(x: string): string {
    const answers: (number | boolean | undefined)[] = [];
    for (let i = 0; i <= x.length + 1; i++) {
        const s = x.slice(i, i + 3);
        const t = x.substring(i + 2.5, i);
        const u = x.substr(-i, 2);
        const c = x.charAt(i);
        const d = x.at(-i);
        const e = x[i];
        answers.push(s === "345", s === "ā😀", s.length, s.charCodeAt(2), Number(s), s.slice(1) === "45", t === "é-", t.codePointAt(1), u === "1F", parseInt(u), c === "ÿ", c.length, d === "F", e === "日");
    }
    return answers.join(" ");
}

function scanAndStore(x: string, stored: (string | undefined)[]): string {
    const answers: (number | boolean | undefined)[] = [];
    for (let i = 0; i <= x.length + 1; i++) {
        const s = x.slice(i, i + 3);
        const t = x.substring(i + 2.5, i);
        const u = x.substr(-i, 2);
        const c = x.charAt(i);
        const d = x.at(-i);
        const e = x[i];
        stored.push(s, t, u, c, d, e);
        answers.push(s === "345", s === "ā😀", s.length, s.charCodeAt(2), Number(s), s.slice(1) === "45", t === "é-", t.codePointAt(1), u === "1F", parseInt(u), c === "ÿ", c.length, d === "F", e === "日");
    }
    return answers.join(" ");
}

let digest = 0;
let mismatches = 0;

function mix(text: string): void {
    for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
}

function compare(label: string, a: number, b: number, inspected: string, stored: string): void {
    mix(inspected);
    if (inspected === stored) return;
    mismatches++;
    console.log("mismatch:", label, a, b, "inspected:", inspected, "stored:", stored);
}

for (const [name, create] of bases) {
    const length = create().length;
    const positions = [NaN, -1, 0, 1.5, 3, 6, 36, 37, 38, 39, 40, 44, 47, length, length + 1, Infinity, -Infinity];
    const stored: (string | undefined)[] = [];
    digest = 0;
    for (const a of positions) {
        for (const b of positions) {
            compare(name + " slice", a, b, inspectSlice(create(), a, b), inspectStoredSlice(create(), a, b, stored));
            compare(name + " substring", a, b, inspectSubstring(create(), a, b), inspectStoredSubstring(create(), a, b, stored));
            compare(name + " substr", a, b, inspectSubstr(create(), a, b), inspectStoredSubstr(create(), a, b, stored));
        }
        compare(name + " charAt", a, a, inspectCharAt(create(), a), inspectStoredCharAt(create(), a, stored));
        compare(name + " at", a, a, inspectAt(create(), a), inspectStoredAt(create(), a, stored));
        compare(name + " []", a, a, inspectElement(create(), a), inspectStoredElement(create(), a, stored));
        mix(inspectUndefinedArguments(create(), a));
    }
    compare(name + " loop", 0, length + 1, scan(create()), scanAndStore(create(), stored));
    mix(JSON.stringify(stored));
    console.log(name, length, digest);
    console.log("  slice(3, 6)", inspectSlice(create(), 3, 6));
    console.log("  slice(36, 38)", inspectSlice(create(), 36, 38));
    console.log("  slice(38, 40)", inspectSlice(create(), 38, 40));
    console.log("  slice(-4, Infinity)", inspectSlice(create(), -4, Infinity));
    console.log("  substring(39, 36)", inspectSubstring(create(), 39, 36));
    console.log("  substring(NaN, 36)", inspectSubstring(create(), NaN, 36));
    console.log("  substr(-13, 7.9)", inspectSubstr(create(), -13, 7.9));
    console.log("  charAt(36)", inspectCharAt(create(), 36), "| at(-1)", inspectAt(create(), -1), "| [37]", inspectElement(create(), 37), "| [1.5]", inspectElement(create(), 1.5));
    console.log("  undefined", inspectUndefinedArguments(create(), 3));
    console.log("  wide literals", matchWideLiterals(create()));
}
console.log("mismatches", mismatches);
export {};
