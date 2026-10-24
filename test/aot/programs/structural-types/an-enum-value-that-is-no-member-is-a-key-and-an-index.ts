function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Slot {
  A,
  B,
  C,
}

interface Item {
  weight: number;
}

const weights: Record<Slot, number> = { [Slot.A]: 10, [Slot.B]: 20, [Slot.C]: 30 };
const items: Record<Slot, Item> = { [Slot.A]: { weight: 1 }, [Slot.B]: { weight: 2 }, [Slot.C]: { weight: 3 } };
const row: [string, string, string] = ["a", "b", "c"];
const list: number[] = [0.5, 1.5, 2.5];
const whole: number[] = [5, 6, 7];
const byMap = new Map<Slot, string>([[Slot.A, "a"], [Slot.B, "b"], [Slot.C, "c"]]);
const bySet = new Set<Slot>([Slot.A, Slot.C]);

function weightOf(slot: Slot): number {
  return weights[slot];
}
function itemWeight(slot: Slot): number {
  return items[slot].weight;
}
function letter(slot: Slot): string {
  return row[slot];
}
function fraction(slot: Slot): number {
  return list[slot] * 2;
}
function integer(slot: Slot): number {
  return whole[slot] + 1;
}
function store(target: number[], slot: Slot, value: number): number[] {
  target[slot] = value;
  return target;
}
function fill(target: Record<Slot, number>, slot: Slot): string {
  target[slot] = 99;
  return JSON.stringify(target) + " " + Object.keys(target).join();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const slot: Slot = i % 3;
  warm += weightOf(slot) + itemWeight(slot) + letter(slot).length + fraction(slot) + integer(slot);
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, -1, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53, 1e21];
for (const n of numbers) {
  const slot: Slot = n;
  const label = show(n);
  attempt(label + " weight", () => [weightOf(slot), weightOf(slot) + 1, typeof weightOf(slot)]);
  attempt(label + " weight of the item", () => itemWeight(slot));
  attempt(label + " letter", () => letter(slot));
  attempt(label + " letter is used", () => letter(slot).toUpperCase());
  attempt(label + " fraction", () => fraction(slot));
  attempt(label + " integer", () => integer(slot));
  attempt(label + " in", () => [slot in weights, slot in row, Object.hasOwn(weights, slot), Object.hasOwn(list, slot)]);
  attempt(label + " map and set", () => [byMap.get(slot), byMap.has(slot), bySet.has(slot)]);
  attempt(label + " filled", () => fill({ [Slot.A]: 1, [Slot.B]: 2, [Slot.C]: 3 }, slot));
  if (!(n >= 100)) attempt(label + " stored", () => { const target = store([1, 2, 3], slot, 9); return [target, target.length, Object.keys(target).join()]; });
  else attempt(label + " stored", () => { const target = store([1, 2, 3], slot, 9); return [target.length, Object.keys(target).join()]; });
}
attempt("a key is taken away", () => {
  const table: Record<Slot, number> = { [Slot.A]: 1, [Slot.B]: 2, [Slot.C]: 3 };
  const gone = Reflect.deleteProperty(table, Slot.B);
  const read = (slot: Slot): number => table[slot];
  return [gone, read(Slot.B), read(Slot.B) + 1, Object.keys(table).join(), read(Slot.C)];
});
attempt("honest again", () => [weightOf(Slot.C), itemWeight(Slot.B), letter(Slot.A), fraction(Slot.C), integer(Slot.A)]);
