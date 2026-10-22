// `x!` tests nothing: arithmetic on the undefined or null behind it gives what JavaScript gives.
function say(label: string, make: () => unknown): void {
  try { console.log(label, String(make())); } catch (error) { console.log(label, "THROWS", (error as Error).constructor.name); }
}
let maybe: number | undefined;
let other: number | null = null;
const holder: { count?: number; size: number | null } = { size: null };
const small: number[] = [1, 2];
const byName = new Map<string, number>([["a", 3]]);
function pick(flag: boolean): number | undefined { return flag ? 3 : undefined; }

say("a variable, plus one", () => maybe! + 1);
say("a variable, times two", () => maybe! * 2);
say("a variable, minus", () => 10 - maybe!);
say("a variable, or zero", () => maybe! | 0);
say("a variable, negated", () => -maybe!);
say("a variable, compared", () => maybe! < 5);
say("a variable, incremented", () => { let n = maybe!; n++; return n; });
say("null, plus one", () => other! + 1);
say("null, times two", () => other! * 2);
say("a property, plus one", () => holder.count! + 1);
say("a null property, plus one", () => holder.size! + 1);
say("an element, plus one", () => small[7]! + 1);
say("an element, shifted", () => small[7]! << 1);
say("a Map entry, plus one", () => byName.get("b")! + 1);
say("a result, plus one", () => pick(false)! + 1);
say("a result that is there, plus one", () => pick(true)! + 1);
say("as an index", () => small[maybe!]);
say("in a template", () => `${maybe! + 1}`);
maybe = 3;
other = 4;
holder.count = 5;
holder.size = 6;
say("set: a variable, plus one", () => maybe! + 1);
say("set: null, plus one", () => other! + 1);
say("set: a property, plus one", () => holder.count! + 1);
say("set: a null property, plus one", () => holder.size! + 1);
