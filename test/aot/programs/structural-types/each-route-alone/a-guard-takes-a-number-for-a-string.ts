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

function claims(v: number | string): v is string {
  return true;
}

function make(): number | string {
  return 7;
}

const v = make();
if (claims(v)) {
  say("v", v);
  say(`v + "!"`, v + "!");
  say("v.length", v.length);
  say("v[0]", v[0]);
}
