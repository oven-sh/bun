function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): string {
  let result: string;
  try {
    result = text(run());
  } catch (error) {
    result = "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  log.push(label + ": " + result);
  return "key" + log.length;
}

class Plain {}

function childName(): string {
  return Child.name;
}

function parentOf(): typeof Plain {
  attempt("in the extends clause", childName);
  return Plain;
}

class Child extends parentOf() {
  [attempt("in a computed method name", childName)](): void {}
  static [attempt("in a computed static method name", childName)](): void {}
  static first: string = attempt("in a static initializer", () => Child.name);
  static {
    attempt("in a static block", () => Child.name);
    attempt("an instance made in a static block", () => new Child().field);
    attempt("a later static read in a static block", () => Child.last);
  }
  field: string = attempt("in a field initializer", () => Child.last);
  static last: number = 9;
}

new Child();
for (const entry of log.splice(0)) console.log(entry);
show("names on the prototype", () => Object.getOwnPropertyNames(Child.prototype).join());
show("static keys", () => Object.keys(Child).join());

const Expression = class Inner {
  static self: string = attempt("the inner name in a static initializer", () => Inner.name);
  static outer: string = attempt("the outer name in a static initializer", () => Expression.name);
};
for (const entry of log.splice(0)) console.log(entry);
show("afterwards", () => Expression.name);

function makeEarly(): string {
  return attempt("a class declared later in the same block", () => new Later().n);
}
makeEarly();
class Later {
  n: number = 1;
}
makeEarly();
for (const entry of log.splice(0)) console.log(entry);

function perCall(n: number): number {
  class Local {
    static base: number = n;
    value: number = Local.base * 2;
  }
  return new Local().value;
}
show("a class made on every call", () => [perCall(1), perCall(2), perCall(3)].join());
