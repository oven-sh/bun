function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

type Handler = (() => number) | Dog;

function use(h: Handler): number {
  return typeof h === "function" ? h() : h.bark();
}

function legs(h: Handler): number {
  if (typeof h === "object") return h.legs;
  return h() + 100;
}

function size(v: string | string[]): number {
  return typeof v === "string" ? v.length * 10 : v.length;
}

function head(v: string | string[]): string {
  if (typeof v === "string") return v.charAt(0);
  return v[0];
}

function number(v: number | { valueOf(): number }): number {
  return typeof v === "number" ? v + 1 : v.valueOf() + 2;
}

function text(v: string | { toString(): string }): string {
  return typeof v === "string" ? v + "!" : v.toString() + "?";
}

function orNull(v: Dog | null): string {
  return typeof v === "object" ? (v === null ? "null" : "dog " + v.legs) : "never";
}

attempt("honest use", () => [use(() => 1), use(new Dog())]);
attempt("honest legs", () => [legs(() => 1), legs(new Dog())]);
attempt("honest size", () => [size("ab"), size(["a", "b", "c"])]);
attempt("honest head", () => [head("ab"), head(["cd"])]);
attempt("honest number", () => [number(1), number({ valueOf: () => 1 })]);
attempt("honest text", () => [text("a"), text({ toString: () => "b" })]);
attempt("honest orNull", () => [orNull(null), orNull(new Dog())]);
let warm = 0;
const dog = new Dog();
const five = () => 5;
for (let i = 0; i < 2000; i++) warm += use(i & 1 ? dog : five) + legs(i & 1 ? dog : five) + size(i & 1 ? "ab" : ["a"]) + number(i) + text("a").length;
console.log("2000 honest rounds", warm);

attempt("a callable dog: use", () => {
  const both: Dog = Object.assign(() => 77, new Dog(), { bark: () => 88 });
  return use(both);
});
attempt("a callable dog: legs", () => {
  const both: Dog = Object.assign(() => 77, new Dog(), { bark: () => 88 });
  return legs(both);
});
attempt("a class is a function", () => {
  class Made {
    static legs = 3;
    static bark(): number {
      return 9;
    }
  }
  const d: Dog = Made;
  return [legs(d)];
});
attempt("a class is a function: use", () => {
  class Made {
    static legs = 3;
    static bark(): number {
      return 9;
    }
  }
  const d: Dog = Made;
  return use(d);
});
attempt("an array subclass under string[]", () => {
  class Words extends Array<string> {
    get first(): string {
      return this[0];
    }
  }
  const words = new Words();
  words.push("x", "y");
  return [size(words), head(words)];
});
attempt("the test kept in a variable", () => {
  const check = (v: number | string): number => {
    const isNumber = typeof v === "number";
    if (isNumber) return v + 1;
    return v.length;
  };
  return [check(1), check("abc")];
});
attempt("typeof in a switch", () => {
  const check = (v: number | string | boolean | undefined | bigint | symbol | null | (() => void) | Dog): string => {
    switch (typeof v) {
      case "number":
        return "number " + (v + 1);
      case "string":
        return "string " + v.length;
      case "boolean":
        return "boolean " + !v;
      case "undefined":
        return "undefined";
      case "bigint":
        return "bigint " + (v + 1n);
      case "symbol":
        return "symbol " + v.description;
      case "function":
        return "function " + v.length;
      case "object":
        return v === null ? "null" : "dog " + v.legs;
    }
  };
  return [check(1), check("a"), check(true), check(undefined), check(1n), check(Symbol("s")), check(() => {}), check(null), check(new Dog()), check(-0), check(NaN)];
});
attempt("honest again", () => [use(() => 1), use(new Dog()), legs(new Dog()), size("ab"), head(["cd"]), number(1), text("a"), orNull(null)]);
