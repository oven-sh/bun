// A field whose type is a union of string literals, read into a place of a wider type (`string`, `unknown`, the result of `?.`) and then compared with a string.
// The functions are called through an array so that each is compiled by itself.
interface Entry { label: string; gender: "m" | "f" }
interface Holder { kind: "first" | "second" | "third"; other?: "first" | "second" }
const names: Record<string, Entry> = { array: { label: "array", gender: "m" }, map: { label: "map", gender: "f" }, set: { label: "set", gender: "f" } };
function entry(name?: string | null): Entry | undefined { return name ? names[name] : undefined; }

function toString(e: Entry): unknown { const g: string = e.gender; return g === "f"; }
function toStringReversed(e: Entry): unknown { const g: string = e.gender; return "f" === g; }
function toStringNot(e: Entry): unknown { const g: string = e.gender; return g !== "f"; }
function toStringLoose(e: Entry): unknown { const g: string = e.gender; return g == "f"; }
function toStringBranch(e: Entry): unknown { const g: string = e.gender; if (g === "f") return "she"; return "he"; }
function toStringOther(e: Entry): unknown { const g: string = e.gender; return g === "x"; }
function toStringTwice(e: Entry): unknown { const g: string = e.gender; return [g === "f", g === "m", g].join(); }
function toUnknown(e: Entry): unknown { const g: unknown = e.gender; return g === "f"; }
function toOptional(e: Entry): unknown { const g: string | undefined = e.gender; return g === "f"; }
function toVariable(e: Entry, wanted: string): unknown { const g: string = e.gender; return g === wanted; }
function twoWidened(e: Entry, other: Entry): unknown { const g: string = e.gender; const h: string = other.gender; return g === h; }
function oneWidened(e: Entry, other: Entry): unknown { const g: string = e.gender; return g === other.gender; }
function argument(e: Entry): unknown { return isF(e.gender); }
function isF(g: string): boolean { return g === "f"; }
function switched(e: Entry): unknown { const g: string = e.gender; switch (g) { case "f": return "she"; case "m": return "he"; default: return "it"; } }
function conditional(e: Entry): unknown { const g: string = e.gender; return `${e.label} ${g === "f" ? "she" : "he"}`; }
const onEntries: ((e: Entry, other: Entry) => unknown)[] = [toString, toStringReversed, toStringNot, toStringLoose, toStringBranch, toStringOther, toStringTwice, toUnknown, toOptional, e => toVariable(e, "f"), twoWidened, oneWidened, argument, switched, conditional];
for (const name of ["array", "map", "set"]) console.log(name, onEntries.map(f => String(f(names[name], names.map))).join(" "));

function chained(name: string): unknown { return entry(name)?.gender === "f"; }
function chainedBranch(name: string): unknown { return entry(name)?.gender === "f" ? "she" : "he"; }
function chainedStored(name: string): unknown { const verb = entry(name)?.gender === "f" ? "she" : "he"; return `${name} ${verb} is`.trim(); }
function defaulted(name: string): unknown { const g = entry(name)?.gender ?? "m"; return g === "f"; }
const onNames: ((name: string) => unknown)[] = [chained, chainedBranch, chainedStored, defaulted];
for (const name of ["array", "map", "set", "none"]) console.log(name, onNames.map(f => String(f(name))).join(" "));

function longer(h: Holder): unknown { const k: string = h.kind; return [k === "first", k === "second", k === "third", k === "fourth"].join(); }
function missing(h: Holder): unknown { const o: string | undefined = h.other; return [o === "first", o === undefined, o === "second"].join(); }
const onHolders: ((h: Holder) => unknown)[] = [longer, missing];
for (const h of [{ kind: "first" }, { kind: "second", other: "first" }, { kind: "third", other: "second" }] as Holder[]) console.log(h.kind, onHolders.map(f => String(f(h))).join(" "));
