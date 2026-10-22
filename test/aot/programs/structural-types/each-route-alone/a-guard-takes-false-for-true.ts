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

function claims(v: boolean): v is true {
  return true;
}

function make(): boolean {
  return false;
}

const v = make();
if (claims(v)) {
  say("v", v);
  say(`v ? "yes" : "no"`, v ? "yes" : "no");
  say("!v", !v);
  say("v === true", v === true);
}
