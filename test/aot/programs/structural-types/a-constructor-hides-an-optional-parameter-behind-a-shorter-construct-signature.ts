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

class Tag {
  name: string;
  level: string;
  parent?: Tag;
  constructor(name: string, level: string = "low", parent?: Tag) {
    this.name = name;
    this.level = level;
    if (parent !== undefined) this.parent = parent;
  }
  describe(): string {
    return this.name + " " + text(this.level) + " " + text(this.level.length) + " parent " + (this.parent === undefined ? "none" : text(this.parent.name));
  }
}

class Fields {
  constructor(public name: string, public weight?: string, readonly flags: string[] = []) {}
}

function build<T>(type: new (name: string, index: number, all: string[]) => T, names: string[]): T[] {
  return names.map((name, index, all) => new type(name, index, all));
}

const ShortTag: new (name: string) => Tag = Tag;
const ShortFields: new (name: string) => Fields = Fields;

attempt("honest", () => [new Tag("a").describe(), new Tag("a", "high").describe(), new Tag("a", "high", new Tag("p")).describe()]);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Tag("t", "mid").level.length + new ShortTag("s").level.length;
console.log("2000 honest constructions: " + warm);

const built = build(ShortTag, ["x", "y"]);
attempt("keys", () => built.map(tag => Object.keys(tag).join()));
attempt("levels", () => built.map(tag => text(tag.level)));
attempt("parents", () => built.map(tag => text(tag.parent)));
attempt("describe", () => built.map(tag => tag.describe()));
attempt("upper", () => built.map(tag => tag.level.toUpperCase()));
attempt("json", () => JSON.stringify(built));

const fields = build(ShortFields, ["x", "y"]);
attempt("parameter properties: keys", () => fields.map(f => Object.keys(f).join()));
attempt("parameter properties: weight", () => fields.map(f => text(f.weight)));
attempt("parameter properties: flags are the list of names", () => fields.map(f => f.flags.join("+")));
attempt("parameter properties: one list for all", () => fields[0].flags === fields[1].flags);

attempt("Reflect.construct with more", () => Reflect.construct(ShortTag, ["r", 5, 6]));

class Child extends Tag {
  extra: number;
  constructor(name: string, extra: number = 1) {
    super(name);
    this.extra = extra;
  }
}
const asTag: new (name: string) => Tag = Child;
attempt("a subclass with another second parameter", () => build(asTag, ["c", "d"]).map(tag => JSON.stringify(tag) + " " + tag.describe()));
attempt("honest again", () => new Tag("z", "top").describe());
