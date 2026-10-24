function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Stamper {
  constructor(target: object) {
    return target;
  }
}

class Stamped extends Stamper {
  #mark = 7;
  #label = "marked";
  static read(value: Stamped): string {
    return value.#mark + " " + value.#label;
  }
  static has(value: object): boolean {
    return #mark in value;
  }
  static bump(value: Stamped): number {
    return ++value.#mark;
  }
}

const targets: [string, object][] = [
  ["a literal", { plain: true }],
  ["a list", [1, 2]],
  ["a function", () => 1],
  ["a map", new Map()],
  ["a date", new Date(0)],
  ["a frozen literal", Object.freeze({ cold: true })],
  ["a proxy", new Proxy({}, {})],
  ["an object without a prototype", Object.create(null)],
];

for (const [label, target] of targets) {
  const before = Stamped.has(target);
  const made = new Stamped(target);
  console.log(label + ": before " + before + " after " + Stamped.has(target) + " same " + Object.is(made, target) + " read " + Stamped.read(made) + " bump " + Stamped.bump(made) + " keys [" + Object.keys(target).join(" ") + "]");
}

try {
  const twice = {};
  new Stamped(twice);
  new Stamped(twice);
  console.log("stamped twice without an error");
} catch (error) {
  console.log("stamped twice: threw a TypeError: " + (error instanceof TypeError));
}
console.log("never stamped: " + Stamped.has({}));
