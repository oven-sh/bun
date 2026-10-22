// An object reaches a part of a union that its own type is not assignable to, by an `in` test on an added property or by a type guard that lies. The narrowing tests nothing. The method that really runs tests its parameters on entry and throws a TypeError; plain Bun goes on with the wrong method.
class Meters<Unit extends string> {
  kind = "meters";
  constructor(public amount: number, public unit: Unit) {}
  scale(by: number): number {
    return this.amount * by;
  }
  describe(prefix: string): string {
    return prefix + this.amount + this.unit;
  }
  again<Other extends string>(unit: Other): Meters<Unit | Other> {
    return new Meters<Unit | Other>(this.amount, unit);
  }
}
class Label<Tag> {
  kind = "label";
  extra = 1;
  constructor(public text: string, public tag: Tag) {}
  scale(by: string): number {
    return this.text.length + by.length;
  }
  describe(prefix: { text: string }): string {
    return prefix.text + this.text;
  }
  again<Other>(tag: Other): Label<Tag | Other> {
    return new Label<Tag | Other>(this.text, tag);
  }
}
interface Named<Extra> {
  name: string;
  extra: Extra;
  greet(other: Named<Extra>): string;
}
interface Counted<Extra> {
  count: number;
  marker: boolean;
  extra: Extra;
  greet(other: Counted<Extra>): string;
}

function attempt(what: string, run: () => unknown) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw", error instanceof TypeError ? "TypeError" : String(error));
  }
}
function scaleEither(value: Meters<"m"> | Label<number>): number {
  if ("extra" in value) return value.scale("abc");
  return value.scale(2);
}
function describeEither(value: Meters<"m"> | Label<number>): string {
  if ("extra" in value) return value.describe({ text: "label " });
  return value.describe("length ");
}
function isLabel(value: Meters<"m"> | Label<number>): value is Label<number> {
  return (value as { pretends?: boolean }).pretends === true || value.kind === "label";
}
function scaleByGuard(value: Meters<"m"> | Label<number>): number {
  return isLabel(value) ? value.scale("abcd") : value.scale(3);
}
function greetEither(value: Named<number> | Counted<number>, named: Named<number>, counted: Counted<number>): string {
  if ("marker" in value) return value.greet(counted);
  return value.greet(named);
}

const plain = new Meters(5, "m");
const label = new Label("wide", 1);
attempt("meters", () => scaleEither(plain));
attempt("label", () => scaleEither(label));
attempt("meters described", () => describeEither(plain));
attempt("label described", () => describeEither(label));

const disguised = new Meters(7, "m");
(disguised as unknown as Record<string, unknown>).extra = 1;
attempt("meters with an added property", () => scaleEither(disguised));
attempt("meters with an added property described", () => describeEither(disguised));

const pretending = new Meters(9, "m");
(pretending as unknown as Record<string, unknown>).pretends = true;
attempt("meters behind a guard", () => scaleByGuard(plain));
attempt("meters that fool the guard", () => scaleByGuard(pretending));

const named: Named<number> = { name: "n", extra: 1, greet(other) { return "hello " + other.name.toUpperCase(); } };
const counted: Counted<number> = { count: 2, marker: true, extra: 2, greet(other) { return "count " + (other.count + 1); } };
attempt("named", () => greetEither(named, named, counted));
attempt("counted", () => greetEither(counted, named, counted));
const marked: Named<number> = { name: "m", extra: 3, greet(other) { return "hi " + other.name.toUpperCase(); } };
(marked as unknown as Record<string, unknown>).marker = true;
attempt("named with an added property", () => greetEither(marked, named, counted));
export {};
