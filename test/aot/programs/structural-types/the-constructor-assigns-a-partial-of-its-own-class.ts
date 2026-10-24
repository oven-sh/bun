class Options {
  depth = 1;
  name = "default";
  label(): string {
    return this.name + "/" + this.depth;
  }
  get deep(): boolean {
    return this.depth > 1;
  }
  constructor(given: Partial<Options> = {}) {
    Object.assign(this, given);
  }
}

function labelOf(o: Options): string {
  return o.label();
}

function describe(o: Options): string {
  let deep: string;
  try {
    deep = String(o.deep);
  } catch (error) {
    deep = "threw";
  }
  return o.label() + " " + labelOf(o) + " " + deep + " own " + Object.hasOwn(o, "label") + " keys " + Object.keys(o).join() + " json " + JSON.stringify(o);
}

function attempt(label: string, make: () => Options): void {
  try {
    console.log(label + ": " + describe(make()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += labelOf(new Options({ depth: i })).length + labelOf(new Options()).length;
console.log("2000 honest: " + warm);

attempt("nothing given", () => new Options());
attempt("fields given", () => new Options({ name: "n", depth: 5 }));
attempt("in another order", () => new Options({ depth: 5, name: "n" }));
attempt("a method given", () => new Options({ label: () => "given" }));
attempt("a method that reads this", () => new Options({
  label() {
    return "given for " + this.name;
  },
}));
attempt("undefined for a field", () => new Options({ name: undefined }));
attempt("undefined for the method", () => new Options({ label: undefined }));
attempt("a value for the getter", () => new Options({ deep: true }));
attempt("another instance", () => new Options(new Options({ name: "inner" })));
attempt("an instance that covers the method", () => new Options(new Options({ label: () => "inner given" })));
attempt("nothing given, at the end", () => new Options());

export {};
