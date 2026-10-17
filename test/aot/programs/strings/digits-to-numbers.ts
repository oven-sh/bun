declare const console: { log(...values: unknown[]): void };
function show(v: number): string { return Object.is(v, -0) ? "-0" : String(v); }
function asNumber(s: string): number { return Number(s); }
function parsed(s: string): number { return parseInt(s); }
function parsedBy(s: string, radix: number): number { return parseInt(s, radix); }
function parsedByTen(s: string): number { return parseInt(s, 10); }
function sumOf(texts: string[]): number { let t = 0; for (let i = 0; i < texts.length; i++) t += Number(texts[i]); return t; }
function sumOfParsed(texts: string[]): number { let t = 0; for (let i = 0; i < texts.length; i++) t += parseInt(texts[i], 10); return t; }
const given: string[] = ["", "0", "7", "9", "10", "007", "000", "42", "123456", "999999", "2147483647", "2147483648", "4294967295", "4294967296", "99999999999999", "999999999999999", "1000000000000000", "9007199254740991", "9007199254740992", "9007199254740993",
    "12345678901234567890", "123456789012345678901234567890", " 1", "1 ", " 12 ", "\t3\n", "+5", "-5", "-0", "+0", "1.5", ".5", "5.", "1e3", "1E3", "1e-3", "0x10", "0X1f", "0b11", "0o17", "010", "08", "1_000", "1,000", "12a", "a12", "1a2", "/", ":", "0/", "0:", "9:", "Infinity", "-Infinity", "NaN", "null", "undefined",
    "١", "1١", "²", "1²", "１", "12１", " 1", "1 ", "﻿1"];
for (let turn = 0; turn < 2; turn++) {
    for (const s of given)
        console.log(JSON.stringify(s) + ": " + [asNumber(s), parsed(s), parsedByTen(s), parsedBy(s, 0), parsedBy(s, 10), parsedBy(s, 16), parsedBy(s, 8), parsedBy(s, 2), parsedBy(s, 36), parsedBy(s, 1), parsedBy(s, 37), parsedBy(s, -10), parsedBy(s, 10.9), parsedBy(s, 4294967306), parsedBy(s, NaN)].map(show).join(" "));
    const joined = given.filter(s => /^[0-9]+$/.test(s));
    for (const a of joined.slice(0, 8)) {
        for (const b of joined.slice(0, 8)) {
            const rope = a + b, cut = ("x" + a + b + "y").slice(1, -1), part = (a + b + "123").substring(0, a.length + b.length);
            console.log(rope + ": " + [asNumber(rope), parsed(rope), asNumber(cut), parsedByTen(cut), asNumber(part), parsed(part)].map(show).join(" "));
        }
    }
    const many: string[] = [];
    for (let i = 0; i < 300; i++) many.push(String((i * 7919) % 1000000));
    console.log(sumOf(many) + " " + sumOfParsed(many) + " " + sumOf(given) + " " + sumOfParsed(joined) + " " + sumOf([]));
    for (let digits = 1; digits <= 16; digits++) {
        const whole = "9182736450918273".slice(0, digits);
        let line = "";
        for (const other of ["/", ":", " ", "a", "-", ".", "\u0080", "\u00ff", "\u0000"]) {
            for (let at = 0; at < digits; at++) {
                const s = whole.slice(0, at) + other + whole.slice(at + 1);
                line += show(asNumber(s)) + "|" + show(parsed(s)) + "|" + show(parsedByTen(s)) + " ";
            }
        }
        console.log(digits + " with one that is no digit: " + line);
    }
    for (let digits = 1; digits <= 20; digits++) {
        const nines = "9".repeat(digits), one = "1" + "0".repeat(digits - 1), mixed = "1234567890123456789012".slice(0, digits);
        console.log(digits + ": " + [asNumber(nines), parsed(nines), asNumber(one), parsedByTen(one), asNumber(mixed), parsed(mixed)].map(show).join(" "));
    }
}
