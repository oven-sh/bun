// A read beyond the end of a `string[]`, or of a key that a dictionary lacks, is `undefined`, and `undefined + 1` is NaN although the type of the sum is `string`.
function show(value: unknown): string { return typeof value + " " + String(value); }
function attempt(label: string, ...runs: (() => unknown)[]): void {
  console.log(label + ": " + runs.map(run => { try { return show(run()); } catch (error) { return "threw " + (error as Error).name; } }).join(" | "));
}
const words: string[] = [];
const filled: string[] = ["a"];
const table: Record<string, string> = { here: "h" };
const text: string = "abc";
const sum = words[0] + 1;
console.log(sum, typeof sum);
attempt("missing + number", () => words[0] + 1, () => 1 + words[0], () => words[3] + 0.5, () => filled[1] + 1);
attempt("present + number", () => filled[0] + 1, () => 1 + filled[0]);
attempt("missing + missing", () => words[0] + words[1], () => filled[0] + filled[1], () => filled[1] + filled[0]);
attempt("missing + string", () => words[0] + "x", () => "x" + words[0], () => words[0] + text);
attempt("a dictionary", () => table["absent"] + 1, () => table.absent + 1, () => table["here"] + 1, () => table.absent + table.here);
attempt("a character", () => text[5] + 1, () => text[0] + 1, () => text[5] + text[6]);
attempt("boolean", () => words[0] + true, () => true + words[0], () => filled[0] + true, () => filled[1] + false);
attempt("in a template", () => `${words[0] + 1}`, () => `<${filled[0] + 1}>`);
attempt("passed on", () => String(words[0] + 1), () => JSON.stringify([words[0] + 1]), () => [words[0] + 1].length);
attempt("compared", () => words[0] + 1 === "x", () => filled[0] + 1 === "a1");
attempt("a local", () => { const held = words[0] + 1; return held; }, () => { const held = filled[0] + 1; return held; });
attempt("appended", () => { let all = "s"; all += words[0]; return all; }, () => { let all = "s"; for (let i = 0; i < 2; i++) all += filled[i]; return all; });
attempt("a chain", () => words[0] + 1 + 2, () => words[0] + 1 + "x", () => filled[0] + 1 + 2);
attempt("by a function", () => ((list: string[], at: number) => list[at] + 1)(words, 0), () => ((list: string[], at: number) => list[at] + 1)(filled, 0));
