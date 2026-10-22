// A literal type (`"a" | "b"`, `1 | 2`, `true`, `keyof X`, a template literal type, an enum) tests the kind of the primitive and never the value, wherever it is written: in a cast, a parameter, a variable, a result, a field, an element. A string outside the list goes through, and so does a number: nothing throws that `bun run` does not throw, and the code that has the type is left for the code that does not.
declare const console: { log(...values: unknown[]): void };
interface Specs { "reference": number; "amd-module": number }
const table: Specs = { "reference": 1, "amd-module": 2 };
enum Color { Red = "red", Blue = "blue" }
enum Level { Low = 1, High = 2 }
type Size = `${number}px`;
const hide = (value: unknown): unknown => value;
function attempt(label: string, action: () => unknown): void {
    try { console.log(label, String(action())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}

function find(text: string): number | undefined {
    const name = text.toLowerCase() as keyof Specs;
    return table[name];
}
attempt("keyof, a key", () => find("REFERENCE"));
attempt("keyof, no key", () => find("nothing"));
attempt("keyof typeof", () => table["other" + "" as keyof typeof table]);

attempt("strings, listed", () => hide("a") as "a" | "b");
attempt("strings, not listed", () => hide("c") as "a" | "b");
attempt("strings, a number", () => hide(1) as "a" | "b");
attempt("strings, an object", () => hide({}) as "a" | "b");
attempt("strings, undefined", () => hide(undefined) as "a" | "b");
attempt("numbers, listed", () => hide(2) as 1 | 2 | 3);
attempt("numbers, not listed", () => hide(7.5) as 1 | 2 | 3);
attempt("numbers, a string", () => hide("2") as 1 | 2 | 3);
attempt("true, false", () => hide(false) as true);
attempt("true, a number", () => hide(1) as true);
attempt("bigint, not listed", () => hide(5n) as 1n | 2n);
attempt("bigint, a number", () => hide(5) as 1n | 2n);
attempt("template, fits", () => hide("4px") as Size);
attempt("template, does not fit", () => hide("wide") as Size);
attempt("template, a number", () => hide(4) as Size);
attempt("string enum, a member", () => hide("red") as Color);
attempt("string enum, no member", () => hide("green") as Color);
attempt("string enum, a number", () => hide(1) as Color);
attempt("numeric enum, no member", () => hide(9) as Level);
attempt("numeric enum, a string", () => hide("Low") as Level);
attempt("mixed, not listed", () => hide("z") as "a" | 1 | Specs);
attempt("mixed, a boolean", () => hide(true) as "a" | 1 | Specs);

const wide = hide({ a: 1, b: 2, c: 3 }) as { a: number; b: number };
attempt("an array of keys, one not listed", () => { let all = ""; for (const key of Object.keys(wide) as (keyof typeof wide)[]) all += key; return all; });
attempt("an array, not listed", () => (hide(["c"]) as ("a" | "b")[])[0]);
attempt("an array, a number", () => (hide([1]) as ("a" | "b")[])[0]);
attempt("a set, not listed", () => { let all = ""; for (const name of hide(new Set(["c"])) as Set<"a" | "b">) all += name; return all; });
attempt("a map, not listed", () => (hide(new Map([["c", 7]])) as Map<"a" | "b", 1 | 2>).get("c" as "a"));

function switched(text: string): string {
    switch (text as "a" | "b") {
        case "a": return "first";
        case "b": return "second";
    }
    return "neither";
}
attempt("a switch over the cast", () => switched("a") + " " + switched("b") + " " + switched("c"));
function compared(text: string): boolean { const name = text as "a" | "b"; return name === "a" || name === "b"; }
attempt("compared with every literal", () => compared("a") + " " + compared("c"));

function takes(name: "a" | "b"): string { return name; }
function gives(value: unknown): keyof Specs { return value as any; }
class Holder { name: "a" | "b" = "a"; level: 1 | 2 = 1; on: true = true; color: Color = Color.Red; }
interface Update { destination: "session" | "argument"; }
const widen = (value: unknown): any => value;
attempt("a parameter, listed", () => takes(widen("b")));
attempt("a parameter, not listed", () => takes(widen("c")));
attempt("a parameter, a number", () => takes(widen(1)));
attempt("a variable, not listed", () => { const name: "a" | "b" = widen("c"); return name; });
attempt("a variable, a number", () => { const name: "a" | "b" = widen(1); return name; });
attempt("a result, not listed", () => gives("nothing"));
attempt("a result, a number", () => gives(1));
attempt("a field, not listed", () => { const holder = new Holder(); holder.name = widen("c"); return holder.name; });
attempt("a field, a number", () => { const holder = new Holder(); holder.name = widen(1); return holder.name; });
attempt("a number field, not listed", () => { const holder = new Holder(); holder.level = widen(7.5); return holder.level; });
attempt("a number field, a string", () => { const holder = new Holder(); holder.level = widen("1"); return holder.level; });
attempt("a true field, false", () => { const holder = new Holder(); holder.on = widen(false); return holder.on; });
attempt("a true field, a number", () => { const holder = new Holder(); holder.on = widen(1); return holder.on; });
attempt("an enum field, no member", () => { const holder = new Holder(); holder.color = widen("green"); return holder.color; });
attempt("an enum field, a number", () => { const holder = new Holder(); holder.color = widen(1); return holder.color; });
attempt("a cast into a property, not listed", () => { const source: "session" | "argument" | "flag" = widen("flag"); const update: Update = { destination: source as Update["destination"] }; return update.destination; });
attempt("a property, a number", () => { const update: Update = { destination: widen(1) }; return update.destination; });
attempt("an element, not listed", () => { const names: ("a" | "b")[] = []; names.push(widen("c")); return names[0]; });
attempt("an element, a number", () => { const names: ("a" | "b")[] = widen([1]); return names[0]; });

function exhaustive(name: "a" | "b"): string {
    switch (name) {
        case "a": return "first";
        case "b": return "second";
    }
}
attempt("a switch that lists every literal", () => exhaustive(widen("a")) + " " + exhaustive(widen("c")));
function outside(name: "a" | "b"): boolean { return (name as string) === "c"; }
attempt("compared with a literal outside the list", () => outside(widen("c")) + " " + outside(widen("a")));
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function measure(shape: Shape): unknown { return shape.kind === "circle" ? shape.radius : shape.side; }
attempt("a discriminant outside the list", () => measure(widen({ kind: "line", radius: 1, side: 2 })));
