function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Dog {
  name = "rex";
  legs = 4;
  speak(): string {
    return this.name + " barks";
  }
}

type Puppet = { name: string; strings: number; speak(): string };

function lookAlike(): Dog {
  return {
    name: "toy",
    legs: 0,
    speak() {
      return this.name + " squeaks";
    },
  };
}

function puppet(): Puppet {
  return { name: "punch", strings: 9, speak: () => "punch talks" };
}

function dogWithStrings(): Dog {
  return Object.assign(new Dog(), { strings: "attached" });
}

function byInstanceof(x: Dog | Puppet): unknown {
  if (x instanceof Dog) return ["a dog", x.legs, x.legs * 2, x.speak()];
  return ["a puppet", x.strings, x.strings * 2, x.speak()];
}

function byIn(x: Dog | Puppet): unknown {
  if ("strings" in x) return ["a puppet", x.strings, x.strings * 2, x.speak()];
  return ["a dog", x.legs, x.legs * 2, x.speak()];
}

function onlyDogs(x: Dog): unknown {
  if (x instanceof Dog) return ["a dog", x.legs, x.speak()];
  return ["typed never", typeof x];
}

function byConstructor(x: Dog | Puppet): unknown {
  if (x.constructor === Dog) return ["a dog", x.legs, x.speak()];
  return ["something else", x.name, x.speak()];
}

const values: [string, () => Dog | Puppet][] = [
  ["a dog", () => new Dog()],
  ["a puppet", puppet],
  ["a literal typed as a dog", lookAlike],
  ["a dog with strings attached", dogWithStrings],
];

for (let i = 0; i < 2000; i++) {
  byInstanceof(i % 2 === 0 ? new Dog() : puppet());
  byIn(i % 2 === 0 ? new Dog() : puppet());
  onlyDogs(new Dog());
}
for (const [name, make] of values) {
  attempt(name + " by instanceof", () => byInstanceof(make()));
  attempt(name + " by in", () => byIn(make()));
  attempt(name + " by its constructor", () => byConstructor(make()));
}
attempt("a dog where only dogs are allowed", () => onlyDogs(new Dog()));
attempt("a literal where only dogs are allowed", () => onlyDogs(lookAlike()));
attempt("in one array", () => [new Dog(), lookAlike(), puppet(), dogWithStrings()].map(byInstanceof));
