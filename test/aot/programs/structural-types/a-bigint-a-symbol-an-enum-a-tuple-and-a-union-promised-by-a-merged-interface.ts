function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

enum Color {
  Red,
  Green,
}

interface Chest {
  big: bigint;
  mark: symbol;
  color: Color;
  pair: [number, string];
  id: number | string;
  when: Date;
}
class Chest {
  own: number = 1;
}

function describe(id: number | string): string {
  return typeof id === "number" ? "number " + (id + 1) : "string of " + id.length;
}

const chest = new Chest();
show("the bigint: read", () => chest.big);
show("the bigint: typeof", () => typeof chest.big);
show("the bigint: plus one", () => chest.big + 1n);
show("the bigint: equals zero", () => chest.big === 0n);
show("the bigint: less than one", () => chest.big < 1n);
show("the bigint: toString", () => chest.big.toString());
show("the bigint: BigInt.asIntN", () => BigInt.asIntN(8, chest.big));
show("the symbol: read", () => chest.mark);
show("the symbol: description", () => chest.mark.description);
show("the symbol: as a key", () => Object.keys({ [chest.mark]: 1 }));
show("the enum: read", () => chest.color);
show("the enum: is it the first member", () => chest.color === Color.Red);
show("the enum: its name", () => Color[chest.color]);
show("the enum: plus one", () => chest.color + 1);
show("the enum: in a switch", () => {
  switch (chest.color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    default:
      return "neither";
  }
});
show("the tuple: read", () => chest.pair);
show("the tuple: first", () => chest.pair[0]);
show("the tuple: taken apart", () => {
  const [n, s] = chest.pair;
  return [n, s];
});
show("the union: read", () => chest.id);
show("the union: told apart by typeof", () => describe(chest.id));
show("the union: honest callers", () => [describe(1), describe("ab")]);
show("the date: read", () => chest.when);
show("the date: getTime", () => chest.when.getTime());
show("keys", () => Object.keys(chest));
show("JSON", () => JSON.stringify(chest));
