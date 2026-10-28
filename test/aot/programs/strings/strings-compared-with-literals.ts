// `x === "text"` for literals of every length, values of every kind and operands of every type, away from loops and in them, alone, in pairs, in ladders and in switches.
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }
function s1(x: string): boolean { return x === "a"; }
function s2(x: string): boolean { return x === "ab"; }
function s3(x: string): boolean { return x === "abc"; }
function s4(x: string): boolean { return x === "abcd"; }
function s5(x: string): boolean { return x === "abcde"; }
function s6(x: string): boolean { return x === "abcdef"; }
function s7(x: string): boolean { return x === "abcdefg"; }
function s8(x: string): boolean { return x === "abcdefgh"; }
function s9(x: string): boolean { return x === "abcdefghi"; }
function s12(x: string): boolean { return x === "abcdefghijkl"; }
function s16(x: string): boolean { return x === "abcdefghijklmnop"; }
function s32(x: string): boolean { return x === "abcdefghijklmnopqrstuvwxyz012345"; }
function s33(x: string): boolean { return x === "abcdefghijklmnopqrstuvwxyz0123456"; }
function b1(x: string): number { if (x === "a") return 1; return 0; }
function b2(x: string): number { if (x === "ab") return 1; return 0; }
function b3(x: string): number { if (x === "abc") return 1; return 0; }
function b4(x: string): number { if (x === "abcd") return 1; return 0; }
function b5(x: string): number { if (x === "abcde") return 1; return 0; }
function b6(x: string): number { if (x === "abcdef") return 1; return 0; }
function b7(x: string): number { if (x === "abcdefg") return 1; return 0; }
function b8(x: string): number { if (x === "abcdefgh") return 1; return 0; }
function b9(x: string): number { if (x === "abcdefghi") return 1; return 0; }
function b12(x: string): number { if (x === "abcdefghijkl") return 1; return 0; }
function o1(x?: string | null): number { if (x === "a") return 1; return 0; }
function o3(x?: string | null): number { if (x === "abc") return 1; return 0; }
function o4(x?: string | null): number { if (x === "abcd") return 1; return 0; }
function o7(x?: string | null): number { if (x === "abcdefg") return 1; return 0; }
function o8(x?: string | null): number { if (x === "abcdefgh") return 1; return 0; }
function o12(x?: string | null): number { if (x === "abcdefghijkl") return 1; return 0; }
function a1(x: any): number { if (x === "a") return 1; return 0; }
function a2(x: any): number { if (x === "ab") return 1; return 0; }
function a3(x: any): number { if (x === "abc") return 1; return 0; }
function a4(x: any): number { if (x === "abcd") return 1; return 0; }
function a5(x: any): number { if (x === "abcde") return 1; return 0; }
function a6(x: any): number { if (x === "abcdef") return 1; return 0; }
function a7(x: any): number { if (x === "abcdefg") return 1; return 0; }
function a8(x: any): number { if (x === "abcdefgh") return 1; return 0; }
function a9(x: any): number { if (x === "abcdefghi") return 1; return 0; }
function a12(x: any): number { if (x === "abcdefghijkl") return 1; return 0; }
function u4(x: unknown): number { if (x === "abcd") return 1; return 0; }
function n4(x: any): number { if (x !== "abcd") return 1; return 0; }
function n12(x: any): number { if ("abcdefghijkl" !== x) return 1; return 0; }
function r4(x: string): number { if ("abcd" === x) return 1; return 0; }
function v4(x: any): boolean { return x === "abcd"; }
function nv4(x: any): boolean { return x !== "abcd"; }
function pair(x: any): number { if (x === "abcd" || x === "abcdefg") return 1; return 0; }
function pairOfStrings(x: string): number { if (x === "ab") return 1; else if (x === "abcdefghi") return 2; return 0; }
function both(x: any, y: any): number { if (x === "abc" && y === "abcde") return 1; return 0; }
function ladder(x: any): number { if (x === "a") return 1; if (x === "ab") return 2; if (x === "abc") return 3; if (x === "abcd") return 4; if (x === "abcdefgh") return 8; return 0; }
function byCase(x: string): number { switch (x) { case "a": return 1; case "abc": return 3; case "abcde": return 5; case "abcdefg": return 7; case "abcdefghi": return 9; default: return 0; } }
function twoCases(x: any): number { switch (x) { case "abcd": return 4; case "abcdef": return 6; } return 0; }
function field(o: { kind: string }): number { if (o.kind === "abcd") return 1; return 0; }
function fieldOfAny(o: any): number { if (o.kind === "abcd") return 1; return 0; }
function kept(x: any): string { const same = x === "abcdef"; const other = x === "abc"; return String(same) + String(other) + String(x === "abcdef"); }
function inLoop(all: any[]): number { let t = 0; for (const x of all) { if (x === "abcd") t += 1; if (x === "abcdefghijkl") t += 100; } return t; }
function near(x: any): number { return (x === "abcD" ? 1 : 0) + (x === "Abcd" ? 2 : 0) + (x === "abed" ? 4 : 0) + (x === "abc" ? 8 : 0) + (x === "abcde" ? 16 : 0) + (x === "abcdefG" ? 32 : 0) + (x === "abcDefg" ? 64 : 0) + (x === "abcdeFgh" ? 128 : 0); }
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const strings = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s12, s16, s32, s33];
const branches = [b1, b2, b3, b4, b5, b6, b7, b8, b9, b12, r4, pairOfStrings, byCase];
const optionals = [o1, o3, o4, o7, o8, o12];
const anys = [a1, a2, a3, a4, a5, a6, a7, a8, a9, a12, u4, n4, n12, pair, ladder, twoCases, near];
const ways: [string, (s: string) => string][] = [
    ["as it is", s => s],
    ["a part", s => ("#" + s + "#").slice(1, -1)],
    ["a part of a part", s => ("##" + s + "##").slice(1, -1).slice(1, -1)],
    ["joined", s => s.slice(0, s.length >> 1) + s.slice(s.length >> 1)],
    ["joined of three", s => s.slice(0, 1) + s.slice(1, 2) + s.slice(2)],
    ["flat", s => s.split("").join("")],
    ["16 bits", s => (s + "ā").split("").slice(0, -1).join("")],
    ["a part of 16 bits", s => ("ā" + s + "ā").slice(1, -1)],
    ["joined with 16 bits", s => (s.slice(0, 1) + ("ā" + s.slice(1)).slice(1))],
    ["parsed", s => JSON.parse(JSON.stringify(s)) as string],
];
for (const [name, make] of ways) {
    let line = "";
    for (let length = 0; length <= 34; length++) {
        const text = alphabet.slice(0, length);
        let bits = 0;
        for (const f of strings) bits = bits * 2 + (f(make(text)) ? 1 : 0);
        for (const f of branches) bits = (bits * 3 + f(make(text))) % 1000003;
        for (const f of optionals) bits = (bits * 3 + f(make(text))) % 1000003;
        for (const f of anys) bits = (bits * 11 + f(make(text))) % 1000003;
        bits = (bits * 2 + (v4(make(text)) ? 1 : 0)) * 2 + (nv4(make(text)) ? 1 : 0);
        bits = (bits * 2 + field({ kind: make(text) })) * 2 + fieldOfAny({ kind: make(text) });
        line += bits.toString(36) + " ";
    }
    say(name, line);
}
for (const changed of ["Abcd", "aBcd", "abCd", "abcD", "abce", "bbcd", "abcdefG", "abcDefg", "Abcdefg", "abcdefgH", "abcdEfgh", "Abcdefgh", "abcdE", "abCde", "abcdeF", "aB", "Ab", "abC", "aBc", "Abc", "A", "abcdefghI", "Abcdefghi", "abcdefghijkL", "ábcd", "abcā", "ab\u0000d", "abcd\u0000"]) {
    let t = "";
    for (const f of strings) t += f(changed) ? 1 : 0;
    for (const f of anys) t += f(changed.split("").join("")).toString(36);
    say("changed " + JSON.stringify(changed), t);
}
const others: any[] = [undefined, null, 0, 1, -0, NaN, 1.5, true, false, {}, [], ["abcd"], { toString() { return "abcd"; } }, new String("abcd"), Symbol("abcd"), 10n, () => "abcd", /abcd/, new Date(0)];
{
    let t = "";
    for (const x of others) { for (const f of anys) t += f(x).toString(36); t += (v4(x) ? 1 : 0) + "" + (nv4(x) ? 1 : 0) + fieldOfAny({ kind: x }) + " "; }
    say("what is no string", t);
    say("nil", optionals.map(f => "" + f(undefined) + f(null) + f()).join(" "));
    say("both", both("abc", "abcde"), both("abc", "abcd"), both("ab", "abcde"), both(undefined, "abcde"), both("abc", 5));
    say("kept", kept("abcdef"), kept("abc"), kept(7), kept(("x" + "abcdef").slice(1)));
    say("in a loop", inLoop(["abcd", "abc", 4, undefined, ("abcd" + "efghijkl"), ("#abcd").slice(1), "abcdefghijkl", null, {}]));
}
console.log(out.join("\n"));
