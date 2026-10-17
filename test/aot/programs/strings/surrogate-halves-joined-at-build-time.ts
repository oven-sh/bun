// Two constants that are the halves of a surrogate pair, joined where the build can see both: the result is the pair, the same string as the character written out, for ===, switch, property keys, Map and Set.
const smile: string = "🙂";
function join(a: string, b: string): string { return a + b; }
function template(a: string, b: string): string { return `${a}${b}`; }
function viaConcat(a: string, b: string): string { return a.concat(b); }
const parts: string[] = ["\uD83D", "\uDE42"];
console.log(join("\uD83D", "\uDE42") === smile, template("\uD83D", "\uDE42") === smile, viaConcat("\uD83D", "\uDE42") === smile, parts.join("") === smile, join(parts[0]!, parts[1]!) === smile);
console.log("\uD83D" + "\uDE42" === smile, `\uD83D${"\uDE42"}` === smile, String.raw`${"\uD83D"}${"\uDE42"}` === smile, "a\uD83D" + "\uDE42b" === "a🙂b", "\uDE42" + "\uD83D" === smile, ("\uDE42" + "\uD83D").length);
const table: Record<string, number> = { "🙂": 1 };
console.log(table["\uD83D" + "\uDE42"], table[join("\uD83D", "\uDE42")], ("\uD83D" + "\uDE42") in table, new Set([smile]).has("\uD83D" + "\uDE42"), new Map([[smile, 2]]).get(join("\uD83D", "\uDE42")));
switch ("\uD83D" + "\uDE42") { case "🙂": console.log("switch: the pair"); break; default: console.log("switch: not the pair"); }
switch (join("\uD83D", "\uDE42")) { case "🙂": console.log("switch: the pair"); break; default: console.log("switch: not the pair"); }
const enum Half { High = "\uD83D", Low = "\uDE42" }
console.log(Half.High + Half.Low === smile, (Half.High + Half.Low).codePointAt(0), encodeURIComponent("\uD83D" + "\uDE42"), JSON.stringify("\uD83D" + "\uDE42"), JSON.stringify("\uD83D" + "x"), ("\uD83D" + "\uDE42").isWellFormed(), ("\uD83D" + "x").isWellFormed());
enum Joined { Pair = "\uD83D" + "\uDE42", Template = `\uD83D${"\uDE42"}`, Apart = "\uDE42" + "\uD83D" }
console.log(Joined.Pair === smile, Joined.Template === smile, (Joined.Apart as string) === smile, Joined.Pair.length, [...Joined.Pair].length, [...Joined.Apart].length);
const high: string = "\uD83D";
const low: string = "\uDE42";
console.log(high + low === smile, (high + low).length, (high + low).codePointAt(0)!.toString(16), `${high}${low}` === smile, [...(high + low)].length, high + low + high + low === smile + smile, high + high + low + low === high + smile + low);
