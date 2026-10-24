const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super("http");
    this.status = status;
    this.url = url;
  }
  retry(): boolean {
    return this.status >= 500;
  }
}

class Timeout extends HttpError {
  after = 30;
  retry(): boolean {
    return true;
  }
}

function describe(run: () => void): unknown {
  try {
    run();
    return "nothing was thrown";
  } catch (e) {
    if (e instanceof Timeout) return ["timeout", e.after, e.after + 1, e.status, e.retry()];
    if (e instanceof HttpError) return ["http", e.status, e.status + 1, typeof e.status, e.url, e.url + "!", e.retry(), Object.keys(e).join()];
    if (e instanceof Error) return ["error", e.message];
    return ["other", typeof e];
  }
}

function changed(change: (e: HttpError) => void): HttpError {
  const e = new HttpError(500, "/a");
  change(e);
  return e;
}

const thrown: [string, () => unknown][] = [
  ["honest", () => new HttpError(500, "/a")],
  ["a subclass", () => new Timeout(408, "/b")],
  ["created from the prototype", () => Object.create(HttpError.prototype)],
  ["created from the prototype of the subclass", () => Object.create(Timeout.prototype)],
  ["created from an instance", () => Object.create(new HttpError(404, "/c"))],
  ["a literal that got the prototype", () => Object.setPrototypeOf({ url: 5, status: "500" }, HttpError.prototype)],
  ["a list that got the prototype", () => Object.setPrototypeOf([1, 2], HttpError.prototype)],
  ["a function that got the prototype", () => Object.setPrototypeOf(() => 1, HttpError.prototype)],
  ["a plain error that got the prototype", () => Object.setPrototypeOf(new Error("plain"), HttpError.prototype)],
  ["an instance of the base that got the prototype of the subclass", () => Object.setPrototypeOf(new HttpError(1, "/d"), Timeout.prototype)],
  ["a field was deleted", () => changed(e => Reflect.deleteProperty(e, "status"))],
  ["a field holds a text", () => changed(e => Reflect.set(e, "status", "500"))],
  [
    "a field became an accessor",
    () =>
      changed(e =>
        Object.defineProperty(e, "status", {
          get() {
            log.push("status");
            return 503;
          },
        }),
      ),
  ],
  ["an own method", () => changed(e => Object.defineProperty(e, "retry", { value: () => "never" }))],
  [
    "a proxy",
    () =>
      new Proxy(new HttpError(502, "/e"), {
        getPrototypeOf(target) {
          log.push("getPrototypeOf");
          return Reflect.getPrototypeOf(target);
        },
        get(target, key, receiver) {
          log.push("get " + String(key));
          return Reflect.get(target, key, receiver);
        },
      }),
  ],
  ["a proxy of an empty object that names the prototype", () => new Proxy({}, { getPrototypeOf: () => HttpError.prototype })],
  ["the prototype itself", () => Timeout.prototype],
  ["a text", () => "text"],
  ["null", () => null],
];

let rounds = 0;
for (let i = 0; i < 2000; i++) {
  describe(() => {
    throw new HttpError(i, "/warm");
  });
  rounds++;
}
console.log(rounds + " honest rounds");

for (const [name, make] of thrown) {
  log.length = 0;
  let line: string;
  try {
    line = show(
      describe(() => {
        throw make();
      }),
    );
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(name + " -> " + line + (log.length > 0 ? " | " + log.join(" ") : ""));
}

export {};
