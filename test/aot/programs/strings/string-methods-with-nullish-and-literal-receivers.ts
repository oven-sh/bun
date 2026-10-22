// The inline `String` methods on literal-typed and nullable receivers, with nullable counts, and their errors.
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    return JSON.stringify(x);
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}

type Count = number | undefined | null;
type Nullable = string | undefined;

const methods: [string, (s: Nullable) => unknown][] = [
    ["length", s => s!.length],
    ["at", s => s!.at(-1)],
    ["charAt", s => s!.charAt(1)],
    ["charCodeAt", s => s!.charCodeAt(0)],
    ["codePointAt", s => s!.codePointAt(0)],
    ["slice", s => s!.slice(1)],
    ["substring", s => s!.substring(0, 1)],
    ["substr", s => s!.substr(0, 1)],
    ["toLowerCase", s => s!.toLowerCase()],
    ["toUpperCase", s => s!.toUpperCase()],
    ["trim", s => s!.trim()],
    ["trimStart", s => s!.trimStart()],
    ["trimEnd", s => s!.trimEnd()],
    ["repeat", s => s!.repeat(2)],
    ["padStart", s => s!.padStart(4, "-")],
    ["padEnd", s => s!.padEnd(4)],
    ["localeCompare", s => s!.localeCompare("b")],
    ["isWellFormed", s => s!.isWellFormed()],
    ["toWellFormed", s => s!.toWellFormed()],
    ["normalize", s => s!.normalize()],
    ["concat", s => s!.concat("x", "y")],
];

function literalLength(s: "a" | "bc"): number { return s.length; }
function literalAt(s: "a" | "bc"): string | undefined { return s.at(-1); }
function literalCharAt(s: "a" | "bc"): string { return s.charAt(1); }
function literalCharCodeAt(s: "a" | "bc"): number { return s.charCodeAt(0); }
function literalCodePointAt(s: "a" | "bc"): number | undefined { return s.codePointAt(1); }
function literalSlice(s: "a" | "bc"): string { return s.slice(1); }
function literalSubstring(s: "a" | "bc"): string { return s.substring(0, 1); }
function literalSubstr(s: "a" | "bc"): string { return s.substr(1, 1); }
function literalLowerCase(s: "a" | "bc"): string { return s.toLowerCase(); }
function literalUpperCase(s: "a" | "bc"): string { return s.toUpperCase(); }
function literalTrim(s: "a" | "bc"): string { return s.trim(); }
function literalTrimStart(s: "a" | "bc"): string { return s.trimStart(); }
function literalTrimEnd(s: "a" | "bc"): string { return s.trimEnd(); }
function literalRepeat(s: "a" | "bc"): string { return s.repeat(3); }
function literalPadStart(s: "a" | "bc"): string { return s.padStart(3, "."); }
function literalPadEnd(s: "a" | "bc"): string { return s.padEnd(3, "."); }
function literalLocaleCompare(s: "a" | "bc"): number { return s.localeCompare("b"); }
function literalIsWellFormed(s: "a" | "bc"): boolean { return s.isWellFormed(); }
function literalToWellFormed(s: "a" | "bc"): string { return s.toWellFormed(); }
function literalNormalize(s: "a" | "bc"): string { return s.normalize(); }
function literalConcat(s: "a" | "bc"): string { return s.concat("!"); }

function repeated(s: string, n: Count): string { return s.repeat(n as number); }
function paddedAtStart(s: string, n: Count): string { return s.padStart(n as number, "*"); }
function paddedAtEnd(s: string, n: Count): string { return s.padEnd(n as number, "*"); }
function repeatedWithUndefinedCount(s: string): string { return s.repeat(undefined as any); }
function repeatedWithNullCount(s: string): string { return s.repeat(null as any); }
function paddedWithUndefinedLength(s: string): string { return s.padStart(undefined as any, "*"); }
function paddedWithNullLength(s: string): string { return s.padEnd(null as any); }
function sliced(s: string, from: number, to: number): string { return s.slice(from, to); }
function slicedWithUndefinedEnd(s: string): string { return s.slice(1, undefined); }
function substringWithUndefinedEnd(s: string): string { return s.substring(1, undefined); }
function substrWithUndefinedLength(s: string): string { return s.substr(1, undefined); }
function isBelowDigits(s: string, i: number): boolean { return s.charCodeAt(i) < 48; }
function stringOf(x: unknown): string { return String(x); }
function registeredSymbolText(): string { return String(Symbol.for("registered")); }
function utf8Length(s: string): number { return Buffer.byteLength(s, "utf8"); }
function latin1Length(s: string): number { return Buffer.byteLength(s, "latin1"); }
function lengthOfAnything(x: any): number { return Buffer.byteLength(x); }

for (const s of ["a", "bc"] as const) {
    const literals = [
        literalLength, literalAt, literalCharAt, literalCharCodeAt, literalCodePointAt, literalSlice, literalSubstring, literalSubstr,
        literalLowerCase, literalUpperCase, literalTrim, literalTrimStart, literalTrimEnd, literalRepeat, literalPadStart, literalPadEnd,
        literalLocaleCompare, literalIsWellFormed, literalToWellFormed, literalNormalize, literalConcat,
    ];
    print(s + ": " + literals.map(f => attempt(() => f(s))).join(" "));
}

for (const [name, method] of methods) {
    print(name + " of a string: " + attempt(() => method(" Ab ")));
    print(name + " of undefined: " + attempt(() => method(undefined)));
    print(name + " of null: " + attempt(() => method(null as unknown as undefined)));
}

for (const n of [2, undefined, null, 0, 1.5, NaN] as Count[]) {
    print("counts " + n + ": " + attempt(() => repeated("ab", n)) + " " + attempt(() => paddedAtStart("ab", n)) + " " + attempt(() => paddedAtEnd("ab", n)));
}

print(attempt(() => sliced("abcdef", 3, 1)));
print(attempt(() => sliced("abcdef", -1, -3)));
print(attempt(() => sliced("abcdef", 1, 3)));
print(attempt(() => slicedWithUndefinedEnd("abcdef")));
print(attempt(() => substringWithUndefinedEnd("abcdef")));
print(attempt(() => substrWithUndefinedLength("abcdef")));
print(attempt(() => repeatedWithUndefinedCount("ab")));
print(attempt(() => repeatedWithNullCount("ab")));
print(attempt(() => paddedWithUndefinedLength("ab")));
print(attempt(() => paddedWithNullLength("ab")));

for (const i of [0, 1, 2, -1, 3, 1.5, NaN])
    print("charCodeAt below 48 at " + i + ": " + isBelowDigits(" a", i));

print(attempt(() => repeated("ab", -1)));
print(attempt(() => repeated("ab", Infinity)));
print(attempt(() => paddedAtStart("ab", 1e10)));
print(attempt(() => stringOf(Symbol("s"))));
print(attempt(() => registeredSymbolText()));
print(String(Symbol("unique")));
print(attempt(() => stringOf(12)));
print(attempt(() => utf8Length("añb")));
print(attempt(() => latin1Length("añb")));
print(attempt(() => lengthOfAnything("añb")));
print(attempt(() => lengthOfAnything(new Uint8Array(3))));
