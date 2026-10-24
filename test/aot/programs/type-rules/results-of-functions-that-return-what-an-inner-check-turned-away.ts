// A function whose parameter is tested at its head and whose body tests something else too: what a call answers. Where the second test fails, the function goes on with the value as it is
// and returns it, so its callers may not take the declared result for proven. The first three are cut from programs that did not build; the last two do return what their types deny.
declare const console: { log(...values: unknown[]): void };

const LINE_SCRUB = /[\x00-\x1f]+/gu;
const SHORT_LINE_LENGTH = 12;
const ELLIPSIS = "...";

function head(text: string, count: number): string {
    let result = "";
    let taken = 0;
    for (const point of text) {
        if (taken++ >= count)
            break;
        result += point;
    }
    return result;
}

function shortLine(text: string): string {
    const line = (text.split(/\r?\n/u)[0] ?? "").replace(LINE_SCRUB, " ").trim();
    return line.length <= SHORT_LINE_LENGTH ? line : head(line, SHORT_LINE_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

function truncate(text: string, width: number): string {
    const flat = text.replace(/\s+/g, " ");
    return flat.length <= width ? flat : head(flat, width - 1) + "…";
}

function hasMark(text: string): boolean {
    return text.split(";").some(part => part.startsWith("<") && part.endsWith("M"));
}

const answers: unknown[] = ["text", 7, null, { length: 3 }, undefined, "longer than twelve characters"];
function pick(index: number): string {
    return answers[index % answers.length] as string;
}

function picked(prefix: string, index: number): string {
    const value = pick(index);
    return prefix.length > 100 ? prefix : value;
}

function pickedOrShort(prefix: string, index: number): string {
    const value = pick(index);
    return value != null && value.length <= SHORT_LINE_LENGTH ? value : prefix + ELLIPSIS;
}

function describe(value: string): string {
    return typeof value + ":" + (typeof value === "object" && value !== null ? "length " + (value as { length: number }).length : String(value));
}

function report(lines: string[]): string[] {
    return lines.map(line => JSON.stringify(shortLine(line)) + " " + JSON.stringify(truncate(line, 10)) + " " + hasMark(line));
}

const given: string[] = JSON.parse(JSON.stringify(["one\ntwo", "x".repeat(20), "<12M;a", "  a\tb  ", "\u{1f600}".repeat(14)]));
for (const line of report(given))
    console.log(line);
let total = 0;
for (let i = 0; i < 1000; i++)
    total += shortLine(given[i % given.length]).length + truncate(given[i % given.length], 10).length;
console.log(total);
for (let round = 0; round < 3; round++) {
    for (let index = 0; index < answers.length; index++)
        console.log(describe(picked(given[index % given.length], index)), describe(pickedOrShort(given[index % given.length], index)));
}
