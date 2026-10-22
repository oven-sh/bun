// lastIndexOf with a text of one character, a longer text and every kind of position, on 8-bit, 16-bit and concatenated strings. Every line prints what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
function opaque<T>(value: T): T { return [value][Number(String(0))]; }
function lastSlash(s: string): number { return s.lastIndexOf("/") + s.length * 100; }
function lastSlashFrom(s: string, from: number): number { return s.lastIndexOf("/", from) + s.length * 100; }
function lastPair(s: string, from: number): number { return s.lastIndexOf("::", from) + s.length * 100; }
function lastWide(s: string, from: number): number { return s.lastIndexOf("β", from) + s.length * 100; }
function extension(s: string): string { return s.slice(s.lastIndexOf(".") + 1) + s.charCodeAt(0); }

const out: unknown[] = [];
const subjects = ["", "/", "a", "a/b", "/a/b/", "a//b", "α/β/β", opaque("left/") + opaque("right/x"), "a::b:::c"];
for (const s of subjects) {
    out.push(lastSlash(opaque(s)), extension(opaque(s + ".ts")));
    for (const from of [-Infinity, -5, -1, 0, 1, 2, 3.7, 100, Infinity, NaN])
        out.push(lastSlashFrom(opaque(s), opaque(from)), lastPair(opaque(s), opaque(from)), lastWide(opaque(s), opaque(from)));
}
console.log(out.join(" "));
