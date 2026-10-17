// `const s = text.slice(a, b)` where s is only asked for its length, its characters, or whether it is a text: the part need not be made. Every kind of base, of bounds and of question; parts that are also kept; parts of nothing.
const out: string[] = [];
function lengthOf(x: string, a: number, b: number): number { return x.slice(a, b).length; }
function lengthOfRest(x: string, a: number): number { return x.slice(a).length; }
function lengthOfSubstring(x: string, a: number, b: number): number { return x.substring(a, b).length; }
function lengthOfSubstr(x: string, a: number, b: number): number { return x.substr(a, b).length; }
function unit(x: string, a: number, b: number, i: number): number { return x.slice(a, b).charCodeAt(i); }
function unitOfSubstring(x: string, a: number, b: number, i: number): number { return x.substring(a, b).charCodeAt(i); }
function unitOfSubstr(x: string, a: number, b: number, i: number): number { return x.substr(a, b).charCodeAt(i); }
function point(x: string, a: number, b: number, i: number): number | undefined { return x.slice(a, b).codePointAt(i); }
function letter(x: string, a: number, b: number, i: number): string { return x.slice(a, b).charAt(i); }
function at(x: string, a: number, b: number, i: number): string | undefined { return x.slice(a, b).at(i); }
function several(x: string, a: number, b: number): string { const s = x.slice(a, b); return s.length + ":" + s.charCodeAt(0) + ":" + s.charCodeAt(s.length - 1) + ":" + s.charCodeAt(s.length) + ":" + (s === "bcd") + ":" + (s !== "") + ":" + s.at(-1); }
function isDashes(x: string): boolean { return x.slice(0, 2) === "--"; }
function endsInSlash(x: string): number { if (x.slice(-1) === "/") return 1; return 2; }
function isNot(x: string, a: number): boolean { return x.substring(a, a + 3) !== "abc"; }
function isEmpty(x: string, a: number, b: number): boolean { return x.slice(a, b) === ""; }
function isLong(x: string, a: number): boolean { return "abcdefghijklmnopqrstuvwxyz" === x.substr(a, 26); }
function ladder(x: string): number { const s = x.slice(1, 4); if (s === "abc") return 1; if (s === "ab") return 2; if (s === "xyz") return 3; if (s === "") return 4; return 0; }
function byCase(x: string): number { switch (x.slice(0, 3)) { case "get": return 1; case "set": return 2; case "is": return 3; default: return 0; } }
function alsoKept(x: string, keep: string[]): number { const s = x.substring(1, 4); keep.push(s); return s.length * 1000 + s.charCodeAt(1); }
function keptInOneArm(x: string, keep: string[], which: boolean): number { const s = x.slice(2, 6); if (which) keep.push(s); return s.length + s.charCodeAt(0); }
function inLoop(x: string): number { let t = 0; for (let i = 0; i < x.length; i++) { const k = i & 15; const s = x.slice(k, k + 8); t = (t * 31 + s.charCodeAt(0) + s.length + s.charCodeAt(7)) | 0; } return t; }
function madeOutsideReadInside(x: string, a: number, b: number): number { const s = x.slice(a, b); let t = 0; for (let i = 0; i < s.length; i++) t = (t * 33 + s.charCodeAt(i)) | 0; return t; }
function tokens(x: string): string { const seen: number[] = []; let start = 0; for (let i = 0; i <= x.length; i++) { if (i === x.length || x.charCodeAt(i) === 32) { const word = x.slice(start, i); if (word === "let") seen.push(1); else if (word === "const") seen.push(2); else if (word.length) seen.push(word.charCodeAt(0)); start = i + 1; } } return seen.join(","); }
function ofPart(x: string): number { const s = x.slice(2, 10); const u = s.slice(1, 4); return u.length * 100000 + u.charCodeAt(0) * 100 + s.length; }
function ofNothing(x: string | undefined, a: number): number { return x!.slice(a).length; }
function order(x: string, log: string[]): number { return x.slice((log.push("a"), 1), (log.push("b"), 3)).charCodeAt((log.push("c"), 0)); }
function oddBounds(x: string, a: any, b: any): string { const s = x.slice(a, b); return s.length + "/" + s.charCodeAt(0); }
const flat = "abcdefghijklmnopqrstuvwxyz0123456789";
const bases: [string, string][] = [
    ["flat", flat], ["joined", flat.slice(0, 11).split("").join("") + flat.slice(11).split("").join("")], ["a part", ("##" + flat + "##").slice(2, -2)],
    ["16 bits", "abād😀gh😀\ud83dxyz一丁"], ["a part of 16 bits", ("āāabād😀gh😀\ud83dxyz一").slice(2)], ["short", "ab"], ["one", "a"], ["empty", ""],
];
const bounds = [0, 1, 2, 3, 5, 7, 8, 35, 36, 37, 1000, -1, -2, -5, -36, -37, -1000, 1.9, -1.9, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, -(2 ** 31)];
for (const [name, base] of bases) {
    let h = 0; const mix = (v: unknown) => { const t = String(v); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; };
    for (const a of bounds) {
        mix(lengthOfRest(base, a));
        for (const b of bounds) {
            mix(lengthOf(base, a, b)); mix(lengthOfSubstring(base, a, b)); mix(lengthOfSubstr(base, a, b)); mix(several(base, a, b)); mix(isEmpty(base, a, b)); mix(madeOutsideReadInside(base, a, b));
            for (const i of [0, 1, 2, 6, -1, 40, NaN, 1.5]) { mix(unit(base, a, b, i)); mix(unitOfSubstring(base, a, b, i)); mix(unitOfSubstr(base, a, b, i)); mix(point(base, a, b, i)); mix(letter(base, a, b, i)); mix(at(base, a, b, i)); }
        }
    }
    out.push(name + " " + h + " " + inLoop(base) + " " + ofPart(base));
}
out.push("pairs cut in two " + [point("a😀b", 0, 2, 1), point("a😀b", 0, 3, 1), point("a😀b", 2, 4, 0), point("a😀b", 1, 2, 0), point("😀", 0, 1, 0)].join(" "));
out.push([isDashes("--x"), isDashes("-x"), isDashes("--"), isDashes("-"), isDashes(""), isDashes("—-"), isDashes(("a--b").slice(1))].join(" "));
out.push([endsInSlash("a/"), endsInSlash("/"), endsInSlash(""), endsInSlash("a"), endsInSlash("a/" + "b".slice(1)), endsInSlash("ā/")].join(" "));
out.push([isNot("abc", 0), isNot("xabc", 1), isNot("xabd", 1), isNot("ab", 0), isNot("abc", -5), isNot("āabc", 1)].join(" "));
out.push([isLong(flat, 0), isLong(flat, 1), isLong("#" + flat, 1), isLong("abc", 0)].join(" "));
out.push(["xabcx", "xab", "xxyz", "x", "", "xabd", "āabc"].map(ladder).join(" ") + " | " + ["getX", "set", "is", "isX", "ge", "", "sets"].map(byCase).join(" "));
const keep: string[] = [];
out.push([alsoKept("abcdef", keep), alsoKept("a", keep), keptInOneArm("abcdefgh", keep, true), keptInOneArm("abcdefgh", keep, false), keptInOneArm("ab", keep, true)].join(" ") + " | " + JSON.stringify(keep));
out.push(tokens("let x const  y let") + " | " + tokens("") + " | " + tokens("const"));
for (const x of [undefined, null] as any[]) { try { out.push(String(ofNothing(x, 1))); } catch (e) { out.push((e as Error).constructor.name); } }
const log: string[] = []; out.push(order("xyz", log) + " " + log.join(""));
out.push([oddBounds(flat, "2", "5"), oddBounds(flat, undefined, undefined), oddBounds(flat, null, 3), oddBounds(flat, { valueOf() { return 4; } }, [6]), oddBounds(flat, true, "x"), oddBounds(flat, 1, undefined)].join(" "));
console.log(out.join("\n"));
