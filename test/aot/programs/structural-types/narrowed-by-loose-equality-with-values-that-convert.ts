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

class Amount {
  constructor(readonly cents: number) {}
  valueOf(): number {
    return this.cents;
  }
}

class Label {
  constructor(readonly words: string) {}
  toString(): string {
    return this.words;
  }
}

function zeroOrAmount(x: number | Amount): unknown {
  if (x == 0) return ["typed 0", typeof x, x + 1, x.toFixed(1)];
  return "not zero";
}

function zeroOrBigint(x: number | bigint): unknown {
  if (x == 0) return ["typed 0", typeof x, -x, x === 0];
  return "not zero";
}

function zeroOrBigintAdded(x: number | bigint): unknown {
  if (x == 0) return x + 1;
  return "not zero";
}

function wordOrLabel(x: string | Label): unknown {
  if (x == "word") return ["typed word", typeof x, x.length, x.toUpperCase()];
  return "another word";
}

function oneOfTwoWords(x: "on" | "off" | Label): unknown {
  if (x == "on") return ["typed on", typeof x, x === "on", x.length];
  return "not on";
}

function notEqual(x: number | Amount): unknown {
  if (x != 0) return "not zero";
  return ["typed 0", typeof x, x + 1];
}

function missing(x: Amount | null | undefined): unknown {
  if (x == null) return ["typed null or undefined", x === null, x === undefined];
  return x.cents;
}

attempt("zero", () => zeroOrAmount(0));
attempt("negative zero", () => zeroOrAmount(-0));
attempt("five", () => zeroOrAmount(5));
attempt("the word", () => wordOrLabel("word"));
for (let i = 0; i < 2000; i++) {
  zeroOrAmount(i % 2);
  zeroOrBigint(i % 2);
  wordOrLabel(i % 2 === 0 ? "word" : "other");
}
attempt("an amount of zero", () => zeroOrAmount(new Amount(0)));
attempt("an amount of five", () => zeroOrAmount(new Amount(5)));
attempt("an amount of zero, the other way round", () => notEqual(new Amount(0)));
attempt("a bigint zero", () => zeroOrBigint(0n));
attempt("a bigint zero, added to", () => zeroOrBigintAdded(0n));
attempt("a bigint five", () => zeroOrBigint(5n));
attempt("a label with the word", () => wordOrLabel(new Label("word")));
attempt("a label with another word", () => wordOrLabel(new Label("other")));
attempt("a label that says on", () => oneOfTwoWords(new Label("on")));
attempt("null, undefined and an amount", () => [missing(null), missing(undefined), missing(new Amount(3))]);
attempt("zero again", () => zeroOrAmount(0));
