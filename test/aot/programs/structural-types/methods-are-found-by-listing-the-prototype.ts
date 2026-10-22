function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const secret = Symbol("secret");

class Routes {
  hits = 0;
  index(n: number): number {
    this.hits++;
    return n + 1;
  }
  about(n: number): string {
    this.hits++;
    return "about " + n * 2;
  }
  get status(): string {
    return "status after " + this.hits;
  }
  set level(n: number) {
    this.hits += n;
  }
  static create(n: number): Routes {
    const routes = new Routes();
    routes.hits = n;
    return routes;
  }
  static version(): number {
    return 3;
  }
  [secret](n: number): number {
    return n * 100;
  }
  ["computed" + "Name"](n: number): number {
    return n - 1;
  }
  async later(n: number): Promise<number> {
    return n + 10;
  }
  *many(n: number): Generator<number> {
    yield n;
    yield n + 1;
  }
}

class Admin extends Routes {
  users(n: number): number[] {
    return [n, this.hits];
  }
  index(n: number): number {
    return super.index(n) + 1000;
  }
}

const table = {
  double(n: number): number {
    return n * 2;
  },
  negate: (n: number): number => -n,
  nested: {
    deep(n: number): string {
      return "deep " + n;
    },
  },
};

function namesOf(object: object): string[] {
  const names: string[] = [];
  for (let o: object | null = object; o !== null && o !== Object.prototype; o = Reflect.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) if (name !== "constructor" && !names.includes(name)) names.push(name);
  }
  return names.sort();
}

attempt("the names of the prototype", () => Object.getOwnPropertyNames(Routes.prototype).sort());
attempt("the names of an instance of the subclass", () => namesOf(new Admin()));

const admin = new Admin();
for (const name of namesOf(admin)) {
  attempt("called by a listed name: " + name, () => {
    const member = Reflect.get(admin, name);
    if (typeof member !== "function") return ["no function", member];
    const result = Reflect.apply(member, admin, [2]);
    return [typeof result, typeof result === "object" ? Object.prototype.toString.call(result) : result];
  });
}

attempt("static members", () =>
  Object.getOwnPropertyNames(Routes)
    .filter(name => typeof Reflect.get(Routes, name) === "function")
    .sort()
    .map(name => name + ": " + typeof Reflect.get(Routes, name)(1)),
);
attempt("a member under a symbol", () => Object.getOwnPropertySymbols(Routes.prototype).map(key => Reflect.get(admin, key).call(admin, 2)));
attempt("a setter found by its descriptor", () => {
  const routes = new Routes();
  Object.getOwnPropertyDescriptor(Routes.prototype, "level")?.set?.call(routes, 5);
  return [routes.hits, Object.getOwnPropertyDescriptor(Routes.prototype, "status")?.get?.call(routes)];
});
attempt("a name from parsed text", () => {
  const name: string = JSON.parse('"about"');
  const f: (n: number) => string = Reflect.get(admin, name);
  return f.call(admin, 4);
});
attempt("a name put together", () => Reflect.get(admin, ["us", "ers"].join("")).call(admin, 1));
attempt("a name that is not there", () => Reflect.get(admin, "nothing")(1));
attempt("members of a literal", () => Object.entries(table).map(([name, member]) => name + ": " + (typeof member === "function" ? member(3) : Object.values(member)[0](3))));
attempt("the generator and the async method", () => [...Reflect.get(admin, "many").call(admin, 1)]);
console.log("later -> " + (await Reflect.get(admin, "later").call(admin, 1)));

export {};
