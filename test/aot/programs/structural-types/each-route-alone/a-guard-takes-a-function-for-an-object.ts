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

function claims(v: (() => number) | Task): v is Task {
  return true;
}

function make(): (() => number) | Task {
  return () => 1;
}

const v = make();
if (claims(v)) {
  say("typeof v", typeof v);
  say("v.cost", v.cost);
  say("v.cost * 2", v.cost * 2);
}
