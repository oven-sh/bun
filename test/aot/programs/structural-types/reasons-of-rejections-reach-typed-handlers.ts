class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super("http " + status);
    this.status = status;
  }
  retry(): boolean {
    return this.status >= 500;
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

async function attempt(label: string, run: () => unknown): Promise<void> {
  try {
    console.log(label + " -> " + show(await run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function statusPlusOne(e: HttpError): number {
  return e.status + 1;
}

function describe(e: HttpError): unknown {
  return [e.status, e.status + 1, e.message.length, e.retry()];
}

function messageSize(e: Error): number {
  return e.message.length;
}

function codePlusOne(code: number): number {
  return code + 1;
}

const reasons: [string, () => unknown][] = [
  ["honest", () => new HttpError(500)],
  ["a plain error", () => new Error("plain")],
  ["a literal", () => ({ status: "500", message: 7 })],
  ["a literal with a method", () => ({ status: 1, message: "m", retry: () => "own" })],
  ["created from the prototype", () => Object.create(HttpError.prototype)],
  ["a text", () => "text"],
  ["a number", () => 404],
  ["null", () => null],
  ["undefined", () => undefined],
  ["a promise", () => Promise.resolve(1)],
];

let warm = 0;
for (let i = 0; i < 500; i++) warm += await Promise.reject(new HttpError(i)).catch(statusPlusOne);
console.log("500 honest rounds: " + warm);

for (const [name, make] of reasons) {
  await attempt("catch, " + name, () => Promise.reject(make()).catch(statusPlusOne));
  await attempt("catch, every member, " + name, () => Promise.reject(make()).catch(describe));
  await attempt("the second operand of then, " + name, () => Promise.reject(make()).then(() => -1, messageSize));
  await attempt("an arrow with a typed parameter, " + name, () => Promise.reject(make()).catch((e: HttpError) => [e.status * 2, typeof e.status]));
  await attempt("reject of a new promise, " + name, () => new Promise<number>((resolve, reject) => reject(make())).catch(statusPlusOne));
  await attempt("thrown in an async function, " + name, () =>
    (async () => {
      throw make();
    })().catch(statusPlusOne),
  );
  await attempt("thrown in a handler, " + name, () =>
    Promise.resolve(1)
      .then(() => {
        throw make();
      })
      .catch(statusPlusOne),
  );
  await attempt("a number is expected, " + name, () => Promise.reject(make()).catch(codePlusOne));
  await attempt("all settled, " + name, async () => {
    const [result] = await Promise.allSettled([Promise.reject(make())]);
    if (result.status === "fulfilled") return "fulfilled";
    const e: HttpError = result.reason;
    return statusPlusOne(e);
  });
  await attempt("with resolvers, " + name, () => {
    const { promise, reject } = Promise.withResolvers<number>();
    reject(make());
    return promise.catch(statusPlusOne);
  });
}

await attempt("any: the errors of an aggregate error", async () => {
  try {
    return await Promise.any([Promise.reject("a"), Promise.reject(2)]);
  } catch (error) {
    if (!(error instanceof AggregateError)) return "another error";
    const [first, second]: HttpError[] = error.errors;
    return [typeof first, typeof second, first.status, statusPlusOne(second)];
  }
});

await attempt("honest again", () => Promise.reject(new HttpError(1)).catch(describe));

export {};
