function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Leaf {
  weight = 7;
}

class Cell {
  value: number | string = 1;
  leaf: Leaf | null = new Leaf();
  other = 5;
}

function describe(c: Cell): string {
  const value = typeof c.value === "number" ? "number " + (c.value + 1) : "string " + c.value.length;
  const leaf = c.leaf === null ? "null" : "leaf " + c.leaf.weight;
  return value + ", " + leaf + ", " + c.other;
}

function change(c: Cell): void {
  ({ a: c.value, b: c.leaf } = { a: "text", b: null });
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Cell();
  if (typeof c.value === "number" && c.leaf !== null) sum += c.value + c.leaf.weight;
}
say("honest rounds", sum);
const cell = new Cell();
say("before", describe(cell));
if (typeof cell.value === "number" && cell.leaf !== null) {
  change(cell);
  say("value", cell.value);
  say("value plus one", cell.value + 1);
  say("value doubled", cell.value * 2);
  say("leaf", cell.leaf === null ? "null" : "a leaf");
}
say("after", describe(cell));
say("a fresh cell", describe(new Cell()));
