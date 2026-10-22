function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function* inner(label: string): Generator<number, string, number> {
  let sum = 0;
  for (let i = 1; i <= 2; i++) {
    const sent: number = yield i;
    console.log(label + " inner was sent " + text(sent));
    sum += sent;
    try {
      console.log(label + " inner toFixed " + sent.toFixed(1));
    } catch (error) {
      console.log(label + " inner toFixed " + failure(error));
    }
  }
  return "sum " + text(sum);
}

function* honestOuter(): Generator<number, string, number> {
  const result: string = yield* inner("honest");
  return "outer saw " + result;
}

function* textOuter(): Generator<number, string, string> {
  const hidden: Iterable<number> = inner("text");
  const result = yield* hidden;
  return "outer saw " + text(result);
}

function* flagOuter(): Generator<number, string, boolean> {
  const hidden: Iterable<number, string> = inner("flag");
  const result: string = yield* hidden;
  return "outer saw " + result + " of length " + result.length;
}

function* nothingOuter(): Generator<number, string, undefined> {
  const hidden: Iterable<number, string> = inner("nothing");
  const result: string = yield* hidden;
  return "outer saw " + result;
}

const honest = honestOuter();
console.log(text(honest.next(100)));
console.log(text(honest.next(1)));
console.log(text(honest.next(2)));
console.log(text(honest.next(3)));

const texts = textOuter();
console.log(text(texts.next("dropped")));
console.log(text(texts.next("one")));
console.log(text(texts.next("two")));

const flags = flagOuter();
console.log(text(flags.next(true)));
console.log(text(flags.next(true)));
console.log(text(flags.next(false)));

const nothing = nothingOuter();
console.log(text(nothing.next()));
console.log(text(nothing.next()));
console.log(text(nothing.next(undefined)));

console.log("spread of the outer one: " + text([...nothingOuter()]));

const honestAgain = honestOuter();
console.log(text(honestAgain.next()));
console.log(text(honestAgain.next(0.5)));
console.log(text(honestAgain.next(-0)));
