// The test fails inside try. What is thrown behind it, by a getter or by the language, is caught where the source says, and finally runs once.
type Entry = { key: string; size: number };
const log: string[] = [];
function measure(entry: Entry, limit: number): number {
    let result = -1;
    try {
        log.push("try");
        const size = entry.size;
        if (size > limit) throw new RangeError("too large: " + entry.key);
        result = size + entry.key.length;
    } catch (error) {
        // The engine's own messages quote the source, which an executable need not hold.
        log.push("caught " + (error as Error).constructor.name + " " + (error as Error).message.replace(/ \(evaluating .*$/, ""));
        result = -2;
    } finally {
        log.push("finally " + result);
    }
    return result;
}
function nested(entry: Entry): string {
    try {
        try {
            return "inner " + measure(entry, 10) + " " + entry.key.toUpperCase();
        } finally {
            log.push("inner finally");
        }
    } catch (error) {
        return "outer caught " + (error as Error).constructor.name;
    }
}
const lines: string[] = [];
for (let round = 0; round < 400; round++) nested({ key: "k", size: round % 10 });
log.length = 0;
for (const entry of [
    { key: "plain", size: 3 }, { size: 3, key: "swapped" }, { key: "large", size: 30 }, { size: 30, key: "large swapped" },
    { key: "throws", get size(): number { throw new TypeError("no size"); } },
    { get key(): string { throw new SyntaxError("no key"); }, size: 1 },
    { key: 5, size: 1 }, { key: null, size: 1 }, null, undefined, 7,
]) lines.push(nested(entry as Entry));
console.log(lines.join("\n"));
console.log(log.join(" | "));
