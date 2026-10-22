// `x!` tests nothing, and undefined and null pass every place written `number`: operators, built-ins, parameters, results, fields and typed arrays get them as they are.
function say(label: string, make: () => unknown): void {
  try { console.log(label, String(make())); } catch (error) { console.log(label, "THROWS", (error as Error).constructor.name); }
}
let maybe: number | undefined;
let nothing: number | null = null;
const ints = new Int32Array(2);
const floats = new Float64Array(2);
const list: number[] = [1, 2, 3];
const holder: { size: number; count: number } = { size: 1, count: 2 };
class Counter { total = 0; add(n: number): number { this.total += n; return this.total; } }
function plusOne(n: number): number { return n + 1; }
function given(): number { return maybe!; }
function which(n: number): string { switch (n) { case 3: return "three"; case 0: return "zero"; default: return "other"; } }
function loop(limit: number): number { let turns = 0; for (let i = 0; i < limit; i++) turns++; return turns; }

say("remainder", () => maybe! % 2);
say("divided", () => maybe! / 2);
say("to a power", () => maybe! ** 2);
say("unary plus", () => +maybe!);
say("bitwise not", () => ~maybe!);
say("and", () => maybe! & 7);
say("unsigned shift", () => maybe! >>> 0);
say("strictly equal", () => maybe! === 3);
say("loosely equal to null", () => maybe! == null);
say("at least", () => maybe! >= 0);
say("switch, in place", () => { switch (maybe!) { case 3: return "three"; case 0: return "zero"; default: return "other"; } });
say("switch, in a function", () => which(maybe!));
say("Math.max", () => Math.max(maybe!, 1));
say("Math.floor", () => Math.floor(maybe!));
say("Math.abs", () => Math.abs(maybe!));
say("isNaN", () => isNaN(maybe!));
say("Number.isInteger", () => Number.isInteger(maybe!));
say("String", () => String(maybe!));
say("a method of it", () => maybe!.toFixed(1));
say("passed to a parameter, added there", () => plusOne(maybe!));
say("returned, then added", () => given() + 1);
say("added to a field", () => new Counter().add(maybe!));
say("stored to a number field", () => { holder.size = maybe!; return holder.size + 1; });
say("compound store to a field", () => { holder.count += maybe!; return holder.count; });
say("stored to an Int32Array", () => { ints[0] = maybe!; return ints[0]; });
say("stored to a Float64Array", () => { floats[0] = maybe!; return floats[0]; });
say("pushed to a number array", () => { list.push(maybe!); return list[3] + "," + (list[3]! + 1); });
say("as a limit of a loop", () => loop(maybe!));
say("as a length", () => "ab".slice(0, maybe!));
say("as a count", () => "ab".repeat(nothing!));
say("a conditional", () => (maybe! ? 1 : 2) + 1);
say("or a default", () => (maybe! || 7) + 1);
say("nullish default", () => (maybe! ?? 7) + 1);
say("null, remainder", () => nothing! % 2);
say("null, negated", () => -nothing!);
say("null, strictly equal to zero", () => nothing! === 0);
say("null, switch", () => which(nothing!));
maybe = 3;
nothing = 0;
say("set: remainder", () => maybe! % 2);
say("set: switch", () => which(maybe!));
say("set: returned, then added", () => given() + 1);
say("set: null, switch", () => which(nothing!));
