function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Cell {
  value: number | string = 1;
  count: number | bigint = 2;
}

function sameFunction(cell: Cell, alias: Cell): void {
  if (typeof cell.value === "number" && typeof cell.count === "number") {
    say("before", cell.value + cell.count);
    alias.value = "text";
    alias.count = 5n;
    say("value", cell.value);
    say("value plus one", cell.value + 1);
    say("count", cell.count);
    say("count negated", -cell.count);
    say("count compared", cell.count > 3);
  }
}

const one = new Cell();
sameFunction(one, one);
sameFunction(new Cell(), new Cell());

const local = new Cell();
const other = local;
if (typeof local.value === "number") {
  other.value = "text";
  say("local value", local.value);
  say("local value plus one", local.value + 1);
}
