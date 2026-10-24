class Dog {
  legs = 4;
  bark(): string {
    return "woof";
  }
}

class Bird {
  wings = 2;
  sing(): string {
    return "tweet";
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const things = new Map<string, unknown>([
  ["a text", "ab"],
  ["a number", 3],
  ["true", true],
  ["a bigint", 3n],
  ["null", null],
  ["undefined", undefined],
  ["a list", [1, 2]],
  ["a list of texts", ["a"]],
  ["a dog", new Dog()],
  ["a bird", new Bird()],
  ["a literal with legs", { legs: "four" }],
  ["a literal with both", { wings: 1, legs: 1 }],
  ["an empty literal", {}],
  ["a function", () => 1],
  ["a boxed text", new String("ab")],
]);
const lookUp: Function = (name: string) => things.get(name);

function textOrNumber(name: string): unknown {
  const v: string | number = lookUp(name);
  if (typeof v === "string") return ["text", v.length, v + "!"];
  return ["number", v + 1, v * 2, typeof v];
}

function numberOrNothing(name: string): unknown {
  const v: number | undefined = lookUp(name);
  if (v === undefined) return "nothing";
  return [v + 1, typeof v];
}

function numberOrList(name: string): unknown {
  const v: number | number[] = lookUp(name);
  if (Array.isArray(v)) {
    let total = 0;
    for (const n of v) total += n;
    return ["list", total];
  }
  return ["number", v + 1];
}

function dogOrBird(name: string): unknown {
  const v: Dog | Bird = lookUp(name);
  if (v instanceof Dog) return ["dog", v.legs + 1, v.bark()];
  return ["bird", v.wings + 1, v.sing()];
}

function dogOrBirdByMember(name: string): unknown {
  const v: Dog | Bird = lookUp(name);
  if ("legs" in v) return ["dog", v.legs + 1, v.bark()];
  return ["bird", v.wings + 1, v.sing()];
}

function dogOrText(name: string): unknown {
  const v: Dog | string = lookUp(name);
  if (typeof v === "object") return ["dog", v.legs + 1, v.bark()];
  return ["text", v.length, v.toUpperCase()];
}

function functionOrNumber(name: string): unknown {
  const v: (() => number) | number = lookUp(name);
  if (typeof v === "function") return ["function", v() + 1];
  return ["number", v + 1];
}

function truthOrNumber(name: string): unknown {
  const v: boolean | number = lookUp(name);
  if (v === true) return "yes";
  if (v === false) return "no";
  return ["number", v + 1];
}

class Holder {
  v: string | number;
  constructor(name: string) {
    this.v = lookUp(name);
  }
  describe(): unknown {
    return typeof this.v === "string" ? ["text", this.v.length] : ["number", this.v + 1];
  }
}

const cases: [string, string, (name: string) => unknown][] = [
  ["text or number", "a number", textOrNumber],
  ["number or nothing", "a number", numberOrNothing],
  ["number or list", "a list", numberOrList],
  ["dog or bird", "a bird", dogOrBird],
  ["dog or bird by a member", "a dog", dogOrBirdByMember],
  ["dog or text", "a dog", dogOrText],
  ["function or number", "a function", functionOrNumber],
  ["truth or number", "true", truthOrNumber],
  ["a field", "a text", name => new Holder(name).describe()],
];

for (const [label, honest, run] of cases) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run(honest);
    rounds++;
  }
  console.log(label + ": " + rounds + " honest rounds");
  for (const name of things.keys()) attempt(label + " gets " + name, () => run(name));
}

export {};
