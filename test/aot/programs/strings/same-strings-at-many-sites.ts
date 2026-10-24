// The same string constants written at many places of a program: in functions that run once and often, in loops and outside them, first asked for by one road and then by
// another, as keys, as parts of other strings, across collections. One text is one value wherever it is written.
const lines: string[] = [];
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function all0(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all1(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all2(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all3(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all4(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all5(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all6(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all7(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function all8(): string[] { return ["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"]; }
function pick0(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick1(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick2(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick3(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick4(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick5(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick6(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick7(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function pick8(i: number): string { switch (i & 7) { case 0: return "north-west"; case 1: return "south-east"; case 2: return "a longer piece of text that is no name"; case 3: return "käse"; case 4: return "日本語の文字列"; case 5: return "x1"; case 6: return "with \"quotes\" inside"; default: return "tab\tand\nnewline"; } }
function inLoop(n: number): number { let total = 0; const seen = new Map<string, number>(); for (let i = 0; i < n; i++) { const key = i & 1 ? "north-west" : "south-east"; seen.set(key, (seen.get(key) ?? 0) + 1); total += key.length + "a longer piece of text that is no name".length; } return total + seen.size; }
const everyAll = [all0, all1, all2, all3, all4, all5, all6, all7, all8];
const everyPick = [pick0, pick1, pick2, pick3, pick4, pick5, pick6, pick7, pick8];
lines.push("in a loop first " + inLoop(1000));
const first = all0();
for (const all of everyAll) { const made = all(); lines.push(made.map((text, k) => (text === first[k] && Object.is(text, first[k]) ? "same" : "OTHER") + ":" + text.length).join(" ")); }
let joined = ""; for (let round = 0; round < 3; round++) for (const pick of everyPick) for (let i = 0; i < 8; i++) joined += pick(i).charCodeAt(0).toString(36);
lines.push(joined.length + " " + joined.slice(0, 48));
const record: Record<string, number> = {}; for (const all of everyAll) for (const text of all()) record[text] = (record[text] ?? 0) + 1;
lines.push(Object.keys(record).map(key => JSON.stringify(key) + "=" + record[key]).join(" "));
const garbage: unknown[] = []; for (let i = 0; i < 200000; i++) { garbage[i & 1023] = { i, text: "g" + i }; }
collect();
for (const all of everyAll) { const made = all(); lines.push("after a collection " + made.every((text, k) => text === first[k]) + " " + made.join("|").length); }
lines.push("in a loop again " + inLoop(1000) + " " + garbage.length);
const set = new Set<string>(); for (const pick of everyPick) for (let i = 0; i < 8; i++) set.add(pick(i)); lines.push("distinct " + set.size);
lines.push(["north-west", "south-east", "a longer piece of text that is no name", "käse", "日本語の文字列", "x1", "with \"quotes\" inside", "tab\tand\nnewline"].map(text => text + "!").join(","));
console.log(lines.join("\n"));
