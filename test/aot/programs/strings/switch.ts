// A `switch` on character codes whose cases test the value again. With fewer than 128 cases it compiles to compares and no jump table.
// CALLS+ kindPlain tables 0
// CALLS+ kind tables 0
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
function isWhiteSpaceSingleLine(ch: number): boolean { return ch === 32 || ch === 9 || ch === 11 || ch === 12 || ch === 160 || ch === 133 || ch === 5760 || ch >= 8192 && ch <= 8203 || ch === 8239 || ch === 8287 || ch === 12288 || ch === 65279; }
function isLineBreak(ch: number): boolean { return ch === 10 || ch === 13 || ch === 8232 || ch === 8233; }
export function kindPlain(s: string, i: number): number {
    const ch = s.codePointAt(i) as number;
    switch (ch) {
        case 10: case 13: return 1;
        case 9: case 11: case 12: case 32: case 160: case 5760: case 8192: case 8193: case 8194: case 8195: case 8196: case 8197: case 8198: case 8199: case 8200: case 8201: case 8202: case 8203: case 8239: case 8287: case 12288: case 65279: return 2;
        case 33: return 3; case 34: case 39: return 4; case 96: return 5; case 37: return 6; case 38: return 7; case 40: return 8; case 41: return 9; case 42: return 10; case 43: return 11; case 44: return 12; case 45: return 13; case 46: return 14; case 47: return 15;
        case 48: return 16; case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: return 17; case 58: return 18; case 59: return 19; case 60: return 20; case 61: return 21; case 62: return 22; case 63: return 23; case 91: return 24; case 93: return 25;
        case 94: return 26; case 123: return 27; case 124: return 28; case 125: return 29; case 126: return 30; case 64: return 31; case 92: return 32; case 35: return 33;
        default: return 0;
    }
}
export function kind(s: string, i: number): number {
    const ch = s.codePointAt(i) as number;
    switch (ch) {
        case 10: case 13: return 1;
        case 9: case 11: case 12: case 32: case 160: case 5760: case 8192: case 8193: case 8194: case 8195: case 8196: case 8197: case 8198: case 8199: case 8200: case 8201: case 8202: case 8203: case 8239: case 8287: case 12288: case 65279: return 2;
        case 33: return 3; case 34: case 39: return 4; case 96: return 5; case 37: return 6; case 38: return 7; case 40: return 8; case 41: return 9; case 42: return 10; case 43: return 11; case 44: return 12; case 45: return 13; case 46: return 14; case 47: return 15;
        case 48: return 16; case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: return 17; case 58: return 18; case 59: return 19; case 60: return 20; case 61: return 21; case 62: return 22; case 63: return 23; case 91: return 24; case 93: return 25;
        case 94: return 26; case 123: return 27; case 124: return 28; case 125: return 29; case 126: return 30; case 64: return 31; case 92: return 32; case 35: return 33;
        default:
            if (isWhiteSpaceSingleLine(ch)) return 40;
            if (isLineBreak(ch)) return 41;
            return ch >= 65 ? 42 : 0;
    }
}
// The branches test it again too, and one test comes before the switch.
export function kindOfUnit(s: string, i: number): number {
    const ch = s.charCodeAt(i), again: number = ch;
    if (ch === 12) return -1;
    switch (ch) {
        case 10: case 13: return again === 13 ? 1 : 2;
        case 9: case 11: case 12: case 32: case 160: return again === 32 ? 3 : again === 12 ? 4 : isLineBreak(again) ? 5 : 6;
        case 33: case 34: case 35: case 36: case 37: case 38: case 39: case 40: case 41: case 42: return again === 10 ? 7 : again;
        default: return again === 9 || again === 32 || again === 10 ? 8 : again === 133 ? 9 : 0;
    }
}
// Another value is tested in between: no part of the switch.
export function twoSubjects(s: string, i: number, j: number): number {
    const a = s.charCodeAt(i), b = s.charCodeAt(j);
    const a2: number = a, b2: number = b;
    if (a === 10) return 1; if (b === 10) return 2; if (a === 13) return 3; if (b === 13) return 4; if (a === 32) return 5; if (a2 === 10) return 6; if (b === 32) return 7; if (a === 9) return 8; if (a === 11) return 9; if (a === 12) return 10;
    return a2 === 32 || b2 === 10 ? 11 : 0;
}
let all = "";
for (let c = 0; c < 140; c++) all += String.fromCharCode(c);
for (const c of [160, 161, 5760, 5761, 8191, 8192, 8197, 8203, 8204, 8232, 8233, 8234, 8239, 8287, 12288, 65279, 65280, 0xd83d, 0xde00, 0xffff]) all += String.fromCharCode(c);
all.charCodeAt(0);
let line = "";
for (let i = -1; i <= all.length; i++) {
    line += kindPlain(all, i) + "," + kind(all, i) + "," + kindOfUnit(all, i) + "," + twoSubjects(all, i, all.length - i) + " ";
    if (line.length > 150) { print(line); line = ""; }
}
print(line);
// The functions the expectations name stay functions: one that is copied into all its callers has no code of its own.
(globalThis as any).kept = [kindPlain, kind, kindOfUnit]; console.log("number");
