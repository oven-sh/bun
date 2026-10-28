// `trim()`, `trimStart()` and `trimEnd()` on 16-bit strings, with every kind of Unicode white space.
// CALLS+ both StringTrim\.Both\b
// CALLS+ start StringTrim\.Start\b
// CALLS- start StringTrim\.(End|Both)
// CALLS+ end StringTrim\.End\b
// CALLS- end StringTrim\.(Start|Both)
// CALLS- both CallHostFunction
// CALLS- start CallHostFunction
// CALLS- end CallHostFunction
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

export function both(s: string): string { return s.trim(); }
export function start(s: string): string { return s.trimStart(); }
export function end(s: string): string { return s.trimEnd(); }
export function lengths(s: string): string { return s.trim().length + "," + s.trimStart().length + "," + s.trimEnd().length; }
export function ofPieces(screen: string): string { let out = ""; for (const line of screen.split("\n")) out += "[" + line.trimEnd() + "]" + line.trim().length + ";"; return out; }
const codes = (s: string): string => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16)).join(".");
const of = (...units: number[]): string => String.fromCharCode(...units);
// Every code unit, alone between two letters' worth of 16 bits and at both ends: which are taken off.
{
    const taken: number[] = [], takenAtStart: number[] = [], takenAtEnd: number[] = [];
    for (let c = 0; c < 0x10000; c++) {
        const s = of(c, 0x2502, c);
        if (both(s).length === 1) taken.push(c);
        if (start(s).length === 2) takenAtStart.push(c);
        if (end(s).length === 2) takenAtEnd.push(c);
    }
    print(taken.length + ": " + taken.map(c => c.toString(16)).join() + " " + (taken.join() === takenAtStart.join()) + " " + (taken.join() === takenAtEnd.join()));
}
const box = of(0x2502), wide = of(0x3000), thin = of(0x2009), mark = of(0xfeff), line = of(0x2028), high = of(0xd83d), low = of(0xde00);
for (const s of [box, " " + box, box + " ", "  " + box + "  ", "\t\n" + box + "x" + box + "\r\n", wide + box + wide, thin + mark + line + box + line + mark + thin, box + " " + box, " a" + box + "b ", wide, wide + wide + thin, mark, " " + wide + " ",
    high + low, " " + high + low + " ", wide + high + wide, low + " ", " " + low, of(0x200b) + box + of(0x200b), of(0x180e) + box + of(0x180e), of(0x85) + box + of(0x85), of(0xa0) + box + of(0xa0), of(0x2060) + box, of(0x1680) + box + of(0x1680), of(0x202f, 0x205f) + box + of(0x205f, 0x202f)])
    print(codes(both(s)) + " | " + codes(start(s)) + " | " + codes(end(s)) + " | " + lengths(s));
// Where nothing is removed the result is the string itself; ropes; substrings of 16-bit strings; substrings of substrings.
print((both(box + "x") === box + "x") + " " + codes(both(cat("  " + box, box + "  "))) + " " + codes(end(cat(cat(" ", box), cat(" ", wide)))) + " " + codes(start(part("ab  " + box + "  cd", 2, 7))) + " " + codes(both(part(part("ab  " + box + "x  cd", 1, 9), 1, 7))));
print(ofPieces(box + " one  " + box + "  \n" + box + "   \n\n   \n" + wide + "two" + wide + "\nplain  \n" + box));
print(codes(both(" ".repeat(300) + box + " ".repeat(300))) + " " + both(wide.repeat(500)).length + " " + end(box.repeat(500) + wide.repeat(500)).length + " " + start(wide.repeat(500) + box.repeat(500)).length);
// 8 bits, as before.
for (const s of ["", " ", "a", " a ", "\t\n\v\f\r a b \t\n\v\f\r", "\xa0a\xa0", "\x85a\x85", "\x1fa\x1f", "a  ", "  a"]) print(codes(both(s)) + " | " + codes(start(s)) + " | " + codes(end(s)));
print(attempt(() => both(undefined as any)) + " " + attempt(() => end(null as any)) + " " + attempt(() => (start as any)(12)));
(globalThis as any).kept = [both, start, end, lengths, ofPieces]; console.log("number");
