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

function claims(v: number | string): v is number {
  return true;
}

function make(): number | string {
  return "text";
}

const v = make();
if (claims(v)) {
  say("v", v);
  say("v + 1", v + 1);
  say("v * 2", v * 2);
  say("-v", -v);
  say("v > 3", v > 3);
}
