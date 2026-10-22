function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Task {
  cost = 3;
}

class Other {
  price = 4;
}

const costs = { on: 10, off: 20 };

function claims(v: Task | { price: number }): v is Task {
  return true;
}

function make(): Task | { price: number } {
  return { price: 4 };
}

const v = make();
if (claims(v)) {
  say("v.cost", v.cost);
  say("v.cost * 2", v.cost * 2);
  say("v instanceof Task", v instanceof Task);
}
