function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let bodies = 0;
let defaults = 0;

function cost(): number {
  defaults++;
  return 3;
}

function* counted(limit: number = cost()): Generator<number, string, void> {
  bodies++;
  try {
    for (let i = 0; i < limit; i++) yield i;
    return "ended at " + limit;
  } finally {
    console.log("counted: finally");
  }
}

const neverStarted = counted();
console.log("defaults run when the generator is made: " + defaults + ", bodies " + bodies);
attempt("return before the start", () => neverStarted.return("early"));
attempt("next after that", () => neverStarted.next());
console.log("bodies " + bodies);

const thrownAt = counted();
attempt("throw before the start", () => thrownAt.throw(new EvalError("early")));
attempt("next after that", () => thrownAt.next());
attempt("throw again", () => thrownAt.throw("again"));
console.log("bodies " + bodies);

const ended = counted(1);
attempt("first", () => ended.next());
attempt("second", () => ended.next());
attempt("third", () => ended.next());
attempt("return after the end", () => ended.return("late"));
attempt("throw after the end", () => ended.throw(new URIError("late")));
attempt("next after all that", () => ended.next());
console.log("bodies " + bodies + " defaults " + defaults);

function lengthOfTheEnd(generator: Generator<number, string, void>): number {
  let result = generator.next();
  while (!result.done) result = generator.next();
  const after = generator.next();
  if (after.done) return after.value.length;
  return -1;
}

attempt("the text after the end has a length", () => lengthOfTheEnd(counted(2)));

function endOf(generator: Generator<number, string, void>): string {
  let result = generator.next();
  while (!result.done) result = generator.next();
  return result.value;
}

attempt("the text at the end", () => endOf(counted(2)));
attempt("the text at the end of one that has ended", () => {
  const g = counted(0);
  endOf(g);
  const second: string = endOf(g);
  return [typeof second, second + "!", second === undefined];
});

function* failsInItsDefault(limit: number = missing()): Generator<number, void, void> {
  yield limit;
}
function missing(): number {
  throw new RangeError("no default");
}
attempt("a default that throws, throws at the call", () => {
  const g = failsInItsDefault();
  return "made " + typeof g;
});
