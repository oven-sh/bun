// A one-character string that was just read from a string, in a loop or where the read stands in place, is compared with a one-character literal or with another such string.
// CALLS+ slashAt ValueEqualsLiteralOfLength1
// CALLS+ slashCharAt tests for equality with [0-9 ]*\b47\b
// CALLS+ slashByAt tests for equality with [0-9 ]*\b47\b
// CALLS- kept StringHasAt|StringEqualsLiteral
// CALLS- keptInLoop StringHasAt|StringEqualsLiteral
// CALLS- samePlace StringEq|StringsAreEqual
// CALLS+ samePlaceHandled StringEq|StringsAreEqual
// CALLS+ slashHandled StringHasAt|StringEqualsLiteral
// CALLS+ twoCharacters ValueEqualsLiteralOfLength2
// CALLS+ notASCII StringEq|StringsAreEqual
// CALLS+ oneArmOnly StringHasAt|StringEqualsLiteral
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }
export function slashAt(s: string, i: number): boolean { return s[i] === "/"; }
export function slashCharAt(s: string, i: number): boolean { return s.charAt(i) === "/"; }
export function slashByAt(s: string, i: number): boolean { return s.at(i) === "/"; }
export function kept(s: string, i: number): string { const x = s[i]; return x === "/" ? "slash" : x + "!"; }
export function keptInLoop(s: string): string { let out = ""; for (let i = 0; i < s.length; i++) { const x = s[i]; out += x === "/" ? "slash" : x + "!"; } return out; }
export function samePlace(s: string, t: string, i: number): boolean { return s[i] === t[i]; }
function mayThrow(i: number): void { if (i === 7) throw new Error("seven"); }
export function samePlaceHandled(s: string, t: string, i: number): boolean { let a = "", b = ""; try { a = s[i]; b = t[i]; mayThrow(i); return a === b; } catch { return a === b; } }
export function slashHandled(s: string, i: number): boolean { let c = ""; try { c = s[i]; mayThrow(i); return c === "/"; } catch { return c === "/"; } }
export function twoCharacters(s: string, i: number): boolean { return s[i] === "//"; }
export function notASCII(s: string, i: number): boolean { return s[i] === "\u00e9"; }
export function oneArmOnly(s: string, flag: boolean, i: number): boolean { let x: string | undefined = "a"; if (flag) x = s[i]; return x === "/"; }
export function countByIndex(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === "/") n = (n + 1) | 0; return n; }
export function countByCharAt(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) if (s.charAt(i) === "/") n = (n + 1) | 0; return n; }
export function countByAt(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) if (s.at(i) === "/") n = (n + 1) | 0; return n; }
export function classify(s: string): string {
    let out = "";
    for (let i = 0; i <= s.length; i++) {
        switch (s[i]) {
            case "/": out += "S"; break;
            case " ": case "\t": out += "W"; break;
            case "a": case "b": out += "L"; break;
            case "\u00e9": out += "E"; break;
            case "\u65e5": out += "J"; break;
            case "": out += "?"; break;
            case "ab": out += "?"; break;
            case undefined: out += "U"; break;
            default: out += ".";
        }
    }
    return out;
}
function all(s: string, i: number): string {
    const x = s[i], c = s.charAt(i), a = s.at(i);
    let out = "";
    out += x === "/" ? "a" : "-"; out += x !== "/" ? "b" : "-"; out += x == "/" ? "c" : "-"; out += "/" === x ? "d" : "-"; out += x === "" ? "e" : "-"; out += x === undefined ? "f" : "-"; out += x == null ? "g" : "-"; out += x === "//" ? "h" : "-"; out += x === "\u00e9" ? "i" : "-"; out += x === "\u0000" ? "j" : "-"; out += x === "\u007f" ? "k" : "-";
    out += c === "/" ? "l" : "-"; out += c !== "/" ? "m" : "-"; out += c === "" ? "n" : "-"; out += "/" === c ? "o" : "-"; out += c === "\u65e5" ? "p" : "-";
    out += a === "/" ? "q" : "-"; out += a !== "/" ? "r" : "-"; out += a === undefined ? "s" : "-"; out += a === "" ? "t" : "-";
    out += x === c ? "u" : "-"; out += x === a ? "v" : "-"; out += c === a ? "w" : "-"; out += x !== c ? "x" : "-"; out += (c as string | undefined) === x ? "y" : "-"; out += x === x ? "z" : "-";
    out += (x ?? "") < "0" ? "A" : "-"; out += c > "/" ? "B" : "-"; out += x ? "C" : "-"; out += c ? "D" : "-"; out += typeof x; out += c.length; out += (x ?? "none") + "|" + c + "|" + (a ?? "none") + "|" + (x + c);
    return out;
}
function pairs(s: string, t: string, i: number, j: number): string { return [s[i] === t[j], s[i] !== t[j], s.charAt(i) === t.charAt(j), s[i] === t.charAt(j), s.at(i) === t[j], s.at(i) === t.charAt(j), s[i] === s[j], t.charAt(i) === t.charAt(j), s[i] == t[j]].map(b => b ? 1 : 0).join(""); }
function withHandler(s: string, i: number): string { try { const x = s[i]; if (x === "/") throw new Error("slash"); return (x === "a") + ":" + (s.charAt(i) === "a"); } catch (e) { return (e as Error).message + (s[i] === "/") + (s.charAt(i) === "/"); } }
function reassigned(s: string): string { let x = s[0]; let out = ""; for (let i = 1; i <= s.length; i++) { out += x === "/" ? "S" : x === undefined ? "U" : "."; x = s[i]; } return out + (x === undefined); }
function oneArm(s: string, flag: boolean, i: number): string { let x: string | undefined = "/"; if (flag) x = s[i]; return (x === "/") + ":" + (x === "a") + ":" + (x === undefined); }
function anything(s: any, i: any): string { return (s[i] === "/") + ":" + (s.charAt(i) === "/") + ":" + (s.at(i) === "/") + ":" + (s[i] === s.charAt(i)) + ":" + (s[i] === undefined); }
const strings = ["", "/", "a/b", "//", "\u0000/", "\u00e9/\u00e9", "\u65e5/\u672c", "\uff0f/", "\u012f/", cat("ro/", "pe/"), part("xx/yy/zz", 1, 6), "a b\tab/", "\ud83d\ude00/", "\u007f\u0080"];
for (const s of strings) {
    print(show(s) + " " + countByIndex(s) + countByCharAt(s) + countByAt(s) + " " + classify(s) + " " + reassigned(s));
    for (const i of [0, 1, 2, -1, s.length - 1, s.length, 100, 0.5, NaN, -0])
        print("  " + i + " " + show(all(s, i)) + " " + withHandler(s, i) + " " + oneArm(s, true, i) + " " + oneArm(s, false, i) + " " + anything(s, i));
    print("  " + [0, 1, 2, -1, 7, 0.5].map(i => [slashAt(s, i), slashCharAt(s, i), slashByAt(s, i), slashHandled(s, i), twoCharacters(s, i), notASCII(s, i), oneArmOnly(s, true, i), oneArmOnly(s, false, i), samePlace(s, "a/\u00e9", i), samePlaceHandled(s, "a/\u00e9", i)].map(b => b ? 1 : 0).join("") + show(kept(s, i))).join(" "));
    for (const t of ["", "/", "b/a", "\u65e5/"])
        print("  " + show(t) + " " + [[0, 0], [1, 1], [0, 1], [1, 0], [5, 5], [5, 0], [0, 5], [-1, -1], [2, 2]].map(([i, j]) => pairs(s, t, i!, j!)).join(" "));
}
print(attempt(() => anything(["/", "a"], 0)) + " " + attempt(() => anything({ 0: "/", charAt: () => "/", at: () => "x" }, 0)) + " " + attempt(() => anything(null, 0)) + " " + attempt(() => anything("a/", "1")) + " " + attempt(() => anything(new String("/"), 0)));
print(keptInLoop("a/b//c") + " " + show(keptInLoop("")));
let big = ""; for (let i = 0; i < 3000; i++) big += i % 7 === 0 ? "/" : String.fromCharCode(32 + i % 90); print(countByIndex(big) + " " + countByCharAt(big) + " " + countByAt(big) + " " + classify(big).length);
// The functions the expectations name stay functions: one that is copied into all its callers has no code of its own.
(globalThis as any).kept = [slashAt, slashCharAt, slashByAt, kept, keptInLoop, samePlace, samePlaceHandled, slashHandled, twoCharacters, notASCII, oneArmOnly]; console.log("number");
