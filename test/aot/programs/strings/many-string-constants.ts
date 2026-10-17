type Row = { a: string; b: string; c: string; d: string; e: string; f: string; n: number };

function join6(a: string, b: string, c: string, d: string, e: string, f: string): string {
    return a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + f;
}

function row(n: number, lead: string): Row {
    return { a: lead, b: "beta-constant", c: "gamma-constant", d: "delta-constant", e: "epsilon-constant", f: "zeta-constant", n };
}

function sixConstants(): string {
    return join6("first-text", "second-text", "third-text", "fourth-text", "fifth-text", "sixth-text");
}

function valuesBetweenConstants(x: string, y: string, z: number): string {
    return join6(x, "between-one", y, "between-two", String(z), "between-three");
}

function constantsInBranches(kind: number, x: string): string {
    switch (kind) {
        case 0: return join6(x, "zero-a", "zero-b", x, "zero-c", "zero-d");
        case 1: return join6("one-a", x, "one-b", "one-c", x, "one-d");
        case 2: return join6("two-a", "two-b", x, "two-c", "two-d", x);
        default: return join6(x, x, "other-a", "other-b", "other-c", x);
    }
}

function inALoop(count: number): string {
    let out = "";
    for (let i = 0; i < count; i++)
        out += (i % 3 === 0 ? "loop-fizz" : i % 3 === 1 ? "loop-buzz" : "loop-none") + i + "loop-tail";
    return out;
}

const makers: Array<() => string> = [];
function closuresAndConstants(prefix: string): string {
    makers.push(() => prefix + "closure-one");
    makers.push(() => "closure-two" + prefix);
    makers.push(() => join6(prefix, "closure-three", prefix, "closure-four", prefix, "closure-five"));
    return makers.map(make => make()).join(",");
}

function manyDistinct(): string[] {
    return [
        "text-00", "text-01", "text-02", "text-03", "text-04", "text-05", "text-06", "text-07", "text-08", "text-09",
        "text-10", "text-11", "text-12", "text-13", "text-14", "text-15", "text-16", "text-17", "text-18", "text-19",
        "text-20", "text-21", "text-22", "text-23", "text-24", "text-25", "text-26", "text-27", "text-28", "text-29",
        "text-30", "text-31", "text-32", "text-33", "text-34", "text-35", "text-36", "text-37", "text-38", "text-39",
        "text-40", "text-41", "text-42", "text-43", "text-44", "text-45", "text-46", "text-47", "text-48", "text-49",
        "text-50", "text-51", "text-52", "text-53", "text-54", "text-55", "text-56", "text-57", "text-58", "text-59",
        "text-60", "text-61", "text-62", "text-63", "text-64", "text-65", "text-66", "text-67", "text-68", "text-69",
    ];
}

function sameCellEachTime(): boolean {
    const first = manyDistinct();
    const second = manyDistinct();
    const seen = new Map<string, number>();
    for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i])
            return false;
        seen.set(first[i], i);
    }
    return seen.size === first.length && seen.get("text-42") === 42;
}

console.log(sixConstants());
console.log(valuesBetweenConstants("x-value", "y-value", 17));
for (let kind = 0; kind < 4; kind++)
    console.log(constantsInBranches(kind, "given"));
const made = row(3, "alpha-given");
console.log(made.a, made.b, made.c, made.d, made.e, made.f, made.n);
console.log(inALoop(7));
console.log(closuresAndConstants("p-"));
console.log(manyDistinct().join("").length, sameCellEachTime(), sixConstants() === sixConstants());
console.log(Math.max(1, 2), [3, 1, 2].sort().join(), JSON.stringify({ k: "json-constant" }), Object.keys(made).join());
