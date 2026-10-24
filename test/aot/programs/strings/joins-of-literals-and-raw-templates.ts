// join on an array literal and String.raw on a template are concatenations, so a pattern made of them is known at build time. Every line prints what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
function opaque<T>(value: T): T { return [value][Number(String(0))]; }

function joined(a: string, b: string, separator: string): string { return [a, b, a].join(separator); }
function joinedWithComma(a: string, n: number): string { return [a, n, true, 10n].join(); }
function joinedWithUndefinedSeparator(a: string, b: string): string { return [a, b].join(undefined); }
function nullishElements(a: string): string { return [a, undefined, null, a].join("-"); }
function negativeZero(): string { return [-0, 0.5, NaN, Infinity, 1e21].join(" "); }
function one(n: number): string { return [n].join("+"); }
function none(separator: string): string { return ([] as string[]).join(separator); }
function maybeMissing(a: string, b?: string): string { return [a, b].join("/"); }
function objects(log: string[]): string {
    const first = { toString() { log.push("first"); return "1"; } };
    const second = { toString() { log.push("second"); return "2"; } };
    return [first, second].join({ toString() { log.push("separator"); return ":"; } } as any);
}
function symbolElement(): string {
    try { return [Symbol("s") as any, "x"].join(","); } catch (error) { return (error as Error).name; }
}
function holes(a: string): string { return [a, , a].join("|"); }
function usedTwice(a: string): string { const list = [a, a]; list.push("z"); return list.join("."); }

function raw(): string { return String.raw`\d+\n${1}A`; }
function rawWith(a: string, n: number, missing?: string): string { return String.raw`<${a}\t${n}\\${missing}>`; }
function rawObject(log: string[]): string {
    return String.raw`a${{ toString() { log.push("x"); return "X"; } }}b${{ toString() { log.push("y"); return "Y"; } }}c`;
}
function rawSymbol(): string {
    try { return String.raw`a${Symbol("s") as any}`; } catch (error) { return (error as Error).name; }
}
function rawCalled(): string { return String.raw({ raw: ["x", "y", "z"] }, 1, 2, 3); }

const alternatives = new RegExp(["ab+", "cd+", "e"].join("|"), "g");
const digits = new RegExp(String.raw`^\d+\.\d+$`);
const number = new RegExp(12 as any);
const nothing = new (RegExp as any)() as RegExp;
const undefinedPattern = new RegExp(undefined as any, "gi");
const nullPattern = new RegExp(null as any);
const truePattern = (RegExp as any)(true) as RegExp;

const log: string[] = [];
const out: unknown[] = [
    joined(opaque("a"), opaque("b"), opaque(", ")), joinedWithComma(opaque("a"), opaque(1.5)), joinedWithUndefinedSeparator(opaque("a"), opaque("b")),
    nullishElements(opaque("n")), negativeZero(), one(opaque(-0)), JSON.stringify(none(opaque("x"))), maybeMissing(opaque("a")), maybeMissing(opaque("a"), opaque("b")),
    objects(log), symbolElement(), holes(opaque("h")), usedTwice(opaque("u")),
    raw(), rawWith(opaque("s"), opaque(2)), rawWith(opaque("s"), opaque(2), opaque("m")), rawObject(log), rawSymbol(), rawCalled(), log.join(","),
];
for (const regExp of [alternatives, digits, number, nothing, undefinedPattern, nullPattern, truePattern])
    out.push(`${regExp.source} ${regExp.flags} ${String(regExp)} ${regExp.test(opaque("abb 12 1.5 null true"))} ${regExp.test(opaque("1.5"))}`);
out.push(opaque("xabbxcddxe").replace(alternatives, "_"), opaque("").match(nothing)?.length, opaque("ab").split(nothing).length);
console.log(out.map(String).join("\n"));
