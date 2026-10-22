// A literal with required properties may be looked at as a dictionary, and a property of a dictionary may be deleted. Where the dictionary comes out of Object.values, Object.entries or another built-in function, the compiler knows nothing of the operand of `delete`, and the literal still has to have room for the absence. A property of the same name that is only deleted from an object without an index signature stays required elsewhere.
// IR+ ^layout L\d+ .*\{name="stays" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
type Words = Record<string, string>;
function row(name: string, run: () => unknown) { try { console.log(name + ": " + String(run())); } catch (error) { console.log(name + ": THROWS " + String(error).split(" (bun")[0]); } }
row("Object.values", () => { const made = { a: "x", b1: "y" }; const t: Record<string, Words> = { k: made }; delete Object.values(t)[0].b1; return Object.keys(made); });
row("Object.entries", () => { const made = { a: "x", b2: "y" }; const t: Record<string, Words> = { k: made }; delete Object.entries(t)[0][1].b2; return Object.keys(made); });
row("for of Object.values", () => { const made = { a: "x", b3: "y" }; const t: Record<string, Words> = { k: made }; for (const w of Object.values(t)) delete w.b3; return Object.keys(made); });
row("stored under a name, then Object.values", () => { const made = { a: "x", b4: "y" }; const t: Record<string, Words> = {}; t.k = made; delete Object.values(t)[0].b4; return Object.keys(made); });
row("Array.from", () => { const made = { a: "x", b5: "y" }; const all: Words[] = [made]; delete Array.from(all)[0].b5; return Object.keys(made); });
row("the values of a Map", () => { const made = { a: "x", b6: "y" }; const m = new Map<string, Words>([["k", made]]); for (const w of m.values()) delete w.b6; return Object.keys(made); });
row("the values of a Map, spread", () => { const made = { a: "x", b7: "y" }; const m = new Map<string, Words>([["k", made]]); delete [...m.values()][0].b7; return Object.keys(made); });
row("slice, filter, find, at, pop, concat", () => {
  const made = { a: "x", c1: "1", c2: "2", c3: "3", c4: "4", c5: "5", c6: "6" };
  const all: Words[] = [made];
  delete all.slice()[0].c1; delete all.filter(() => true)[0].c2; delete all.find(() => true)!.c3; delete all.at(0)!.c4; delete all.concat([])[0].c5; delete all.pop()!.c6;
  return Object.keys(made);
});
row("read again after the delete", () => { const made = { a: "x", b8: "y" }; const t: Record<string, Words> = { k: made }; delete Object.values(t)[0].b8; return String((made as Words).b8) + " " + ("b8" in made) + " " + JSON.stringify(made); });
class Kept { stays: unknown; constructor() { this.stays = 1; } }
const other: { stays?: number } = JSON.parse('{"stays":2}');
delete other.stays;
console.log("a class with a field of the same name:", new Kept().stays, "stays" in other);
