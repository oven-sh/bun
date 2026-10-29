function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

async function* guarded(): AsyncGenerator<number, string, void> {
  try {
    yield 1;
    yield 2;
    return "ran out";
  } catch (error) {
    log.push("caught inside " + failure(error));
    yield -1;
    return "recovered";
  } finally {
    log.push("finally");
  }
}

async function* slowFinally(): AsyncGenerator<number, string, void> {
  try {
    yield 1;
    return "ran out";
  } finally {
    log.push("finally begins");
    await null;
    yield 100;
    log.push("finally ends");
  }
}

async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
  log = [];
  let outcome: string;
  try {
    outcome = text(await run());
  } catch (error) {
    outcome = failure(error);
  }
  console.log(label + ": " + outcome + " [" + log.join(", ") + "]");
}

await attempt("return(text) before the start", () => guarded().return("early"));
await attempt("return(promise) before the start", () => guarded().return(Promise.resolve("early promise")));
await attempt("return(rejection) before the start", () => guarded().return(Promise.reject(new RangeError("early"))));
await attempt("throw before the start", () => guarded().throw(new TypeError("early")));

await attempt("return(text) at a yield", async () => {
  const g = guarded();
  await g.next();
  return [await g.return("asked"), await g.next()];
});
await attempt("return(promise) at a yield", async () => {
  const g = guarded();
  await g.next();
  return [await g.return(Promise.resolve("asked with a promise")), await g.next()];
});
await attempt("return(rejection) at a yield", async () => {
  const g = guarded();
  await g.next();
  return [await g.return(Promise.reject(new RangeError("asked"))), await g.next(), await g.next()];
});
await attempt("throw at a yield", async () => {
  const g = guarded();
  await g.next();
  return [await g.throw(new SyntaxError("thrown in")), await g.next(), await g.next()];
});
await attempt("throw(promise) at a yield is not awaited", async () => {
  const g = guarded();
  await g.next();
  const given = Promise.resolve("a promise as the reason");
  const result = await g.throw(given);
  return result;
});
await attempt("return after the end", async () => {
  const g = guarded();
  while (!(await g.next()).done);
  return [await g.return("late"), await g.return(Promise.resolve("late promise"))];
});
await attempt("return(rejection) after the end", async () => {
  const g = guarded();
  while (!(await g.next()).done);
  return g.return(Promise.reject(new EvalError("late")));
});

await attempt("a finally that awaits and yields", async () => {
  const g = slowFinally();
  return [await g.next(), await g.return("asked"), await g.next(), await g.next()];
});
await attempt("left by a break", async () => {
  const g = slowFinally();
  for await (const n of g) {
    log.push("body " + n);
    break;
  }
  return [await g.next(), await g.next()];
});

function lengthOf(result: IteratorResult<number, string>): number {
  return result.done ? result.value.length : -1;
}
await attempt("the returned text has a length", async () => lengthOf(await guarded().return(Promise.resolve("four"))));

export {};
