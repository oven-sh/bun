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

function claims(v: [number] | [number, number]): v is [number, number] {
  return true;
}

function make(): [number] | [number, number] {
  return [9];
}

const v = make();
if (claims(v)) {
  say("v.length", v.length);
  say("v[0]", v[0]);
  say("v[1]", v[1]);
  say("v[1] * 2", v[1] * 2);
}
