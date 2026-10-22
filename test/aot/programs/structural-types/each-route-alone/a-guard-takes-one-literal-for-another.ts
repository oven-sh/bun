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

function claims(v: "on" | "off"): v is "on" {
  return true;
}

function make(): "on" | "off" {
  return "off";
}

const v = make();
if (claims(v)) {
  say("v", v);
  say(`v === "on"`, v === "on");
  say("v.length", v.length);
  say("costs[v]", costs[v]);
}
