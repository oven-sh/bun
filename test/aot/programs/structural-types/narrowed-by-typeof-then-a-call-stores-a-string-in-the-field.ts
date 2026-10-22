function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Cell {
  value: number | string = 1;
}

function spoil(c: Cell): void {
  c.value = "text";
}

const cell = new Cell();
if (typeof cell.value === "number") {
  say("before", cell.value + 1);
  spoil(cell);
  say("after", cell.value);
  say("after plus one", cell.value + 1);
  say("after doubled", cell.value * 2);
  const kept: number = cell.value;
  say("kept", kept);
  say("kept halved", kept / 2);
}
