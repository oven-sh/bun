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

type Either = { a: number } | { b: string };

function read(x: Either): string {
  return "a" in x ? x.a.toFixed(1) : x.b.toUpperCase();
}

function plus(x: Either): number {
  if ("a" in x) return x.a + 1;
  return x.b.length;
}

function other(x: Either): string {
  if ("b" in x) return "b " + x.b.length;
  return "a " + (x.a + 1);
}

class HasA {
  a = 5;
}

class InheritsA extends HasA {
  extra = 1;
}

class AccessorA {
  get a(): number {
    log.push("get-a");
    return 6;
  }
}

function forgetA(v: { b: string }): Either {
  return v;
}

function forgetB(v: { a: number }): Either {
  return v;
}

const honest: Either[] = [{ a: 1 }, { b: "bee" }, new HasA(), new InheritsA(), new AccessorA()];
for (let i = 0; i < honest.length; i++) attempt("honest " + i, () => [read(honest[i]), plus(honest[i]), other(honest[i])]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plus(honest[i % 2]) + read(honest[i % 2]).length + other(honest[i % 2]).length;
console.log("2000 honest rounds", warm);

function everything(label: string, make: () => Either): void {
  attempt(label + ": read", () => read(make()));
  attempt(label + ": plus", () => plus(make()));
  attempt(label + ": other", () => other(make()));
}

everything("b with an a that is a string", () => {
  const v = { b: "s", a: "no number" };
  return forgetA(v);
});
everything("b with an a that is undefined", () => {
  const v = { b: "s", a: undefined };
  return forgetA(v);
});
everything("b with an a that is null", () => {
  const v = { b: "s", a: null };
  return forgetA(v);
});
everything("b with an a that is an object", () => {
  const v = { b: "s", a: { toFixed: () => "own toFixed" } };
  return forgetA(v);
});
everything("a with a b that is a number", () => {
  const v = { a: 1, b: 2 };
  return forgetB(v);
});
everything("a with a b that is undefined", () => {
  const v = { a: 1, b: undefined };
  return forgetB(v);
});
everything("b whose prototype has an a", () => {
  class Odd {
    b = "s";
  }
  class Odder extends Odd {
    a = "inherited text";
  }
  const v: Odd = new Odder();
  return forgetA(v);
});
everything("an array where b is expected has neither", () => {
  const v: { a: number } | { b: string } = Object.assign([1, 2], { b: "list" });
  return v;
});
everything("a function with a b", () => Object.assign(() => 1, { b: "callable" }));

attempt("in a field", () => {
  class Holder {
    x: Either;
    constructor(x: Either) {
      this.x = x;
    }
    read(): number {
      return "a" in this.x ? this.x.a + 1 : this.x.b.length;
    }
  }
  const v = { b: "s", a: "text" };
  return [new Holder({ a: 1 }).read(), new Holder(forgetA(v)).read()];
});
attempt("in elements", () => {
  const v = { b: "s", a: "text" };
  const list: Either[] = [{ a: 1 }, forgetA(v), { b: "bee" }];
  return list.map(plus);
});
attempt("the name is deleted after the test", () => {
  const v: { a?: number; b: string } = { a: 1, b: "s" };
  const drop = () => {
    delete v.a;
  };
  if ("a" in v && v.a !== undefined) {
    drop();
    return v.a + 1;
  }
  return -1;
});
for (let i = 0; i < honest.length; i++) attempt("honest again " + i, () => [read(honest[i]), plus(honest[i]), other(honest[i])]);
