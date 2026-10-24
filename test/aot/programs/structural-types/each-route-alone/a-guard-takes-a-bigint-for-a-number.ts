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

function claims(v: number | bigint): v is number {
  return true;
}

function make(): number | bigint {
  return 5n;
}

const v = make();
if (claims(v)) {
  say("v", v);
  say("-v", -v);
  say("v > 3", v > 3);
  say("v === 5", v === 5);
}
