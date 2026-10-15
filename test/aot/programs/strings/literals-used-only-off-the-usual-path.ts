// A string literal that is only wanted where something goes wrong: the message of an assertion, the default of a lookup, the text of an error. The literal must be there in every arm that uses it, whichever is taken first.
const out: string[] = [];
namespace Debug {
    export let failures = 0;
    export function fail(message?: string): never { failures++; throw new Error(message ? "Debug Failure. " + message : "Debug Failure."); }
    export function assert(expression: unknown, message?: string, verbose?: string | (() => string)): asserts expression {
        if (!expression) {
            message = message ? "False expression: " + message : "False expression.";
            if (verbose) message += "\r\nVerbose Debug Information: " + (typeof verbose === "string" ? verbose : verbose());
            fail(message);
        }
    }
}
let assertOfTheDay: (expression: unknown, message?: string) => void = Debug.assert;
function token(kind: number): number {
    Debug.assert(kind >= 0 && kind <= 166, "Invalid token");
    Debug.assert(kind <= 15 || kind >= 18, "Invalid token. Use 'createTemplateLiteralLikeNode' to create template literals.");
    Debug.assert(kind <= 9 || kind >= 15, "Invalid token. Use 'createLiteralLikeNode' to create literals.");
    Debug.assert(kind !== 80, "Invalid token. Use 'createIdentifier' to create identifiers");
    return kind * 2;
}
function throughVariable(kind: number): number {
    assertOfTheDay(kind !== 7, "seven is not wanted here");
    assertOfTheDay(kind !== 8, "nor is eight");
    return kind + 1;
}
function twoArms(kind: number, other: number): string {
    const message = "a text for two arms";
    if (kind === 1000) return message + "!";
    if (other === 1000) return "?" + message;
    return "";
}
function threeArms(kind: number): string {
    const message = "a text for three arms";
    if (kind === 1000) return message + "1";
    if (kind === 2000) return message + "2";
    if (kind === 3000) return message + "3";
    return "";
}
function alsoOnTheUsualPath(kind: number): number {
    const message = "a text that is always wanted";
    if (kind === 1000) return (message + "!").length;
    if (kind === 2000) return ("?" + message).length;
    return message.length + kind;
}
function inLoop(list: number[]): string {
    const message = "a text used in a loop's rare arm";
    let found = "";
    for (const x of list) { if (x === 1000) found += message; else if (x === 2000) found += message.length; }
    return found;
}
function sameCell(kind: number): boolean {
    const message = "one literal, one value";
    const a = kind === 1000 ? message : "x";
    const b = kind >= 1000 ? message : "y";
    return a === b;
}
function attempt(what: string, f: () => unknown): void { try { out.push(what + ": " + String(f())); } catch (e) { out.push(what + " threw: " + (e as Error).message); } }
let sum = 0;
for (let i = 0; i < 300; i++) { const kind = i % 167; if ((kind > 9 && kind < 18) || kind === 80) continue; sum += token(kind) + throughVariable(kind > 8 ? kind : 1) + twoArms(kind, i).length + threeArms(kind).length + alsoOnTheUsualPath(kind); }
out.push("sum " + sum);
for (const kind of [-1, 167, 16, 17, 10, 14, 80, 0, 166]) attempt("token " + kind, () => token(kind));
for (const kind of [7, 8, 9]) attempt("through a variable " + kind, () => throughVariable(kind));
assertOfTheDay = (expression, message) => { out.push("another assert: " + String(expression) + " " + message); };
for (const kind of [7, 8, 9]) attempt("through another " + kind, () => throughVariable(kind));
out.push([twoArms(1000, 0), twoArms(0, 1000), twoArms(1000, 1000), twoArms(0, 0)].join("|"));
out.push([threeArms(1000), threeArms(2000), threeArms(3000), threeArms(0)].join("|"));
out.push([alsoOnTheUsualPath(1000), alsoOnTheUsualPath(2000), alsoOnTheUsualPath(3)].join("|"));
out.push(inLoop([1, 1000, 2, 2000, 1000]) + "|" + inLoop([]) + "|" + inLoop([5]));
out.push([sameCell(1000), sameCell(1001), sameCell(1)].join("|"));
out.push("failures " + Debug.failures);
console.log(out.join("\n"));
