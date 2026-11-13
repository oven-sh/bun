// What `bun build --dts` writes into `.aot.ts` files for a class member with no annotation. A build parts such a
// member from what types it: with `"useDefineForClassFields": false` it moves the value of a field into the
// constructor, and `--define` can remove the stores of a member with no value. `bun check` judges a caller by the
// typed file as it does by the sources.
import { expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "./with-compiler";

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What `bun check` says of the project in `root`. `errors`: the place and the code of each error, by file. `types`: a
// file under `types/` gives each of its expressions to a `never`, so the error says the type of the expression.
async function checkedIn(root: string) {
  const checked = await bun(root, "check");
  const errors: Record<string, string[]> = {};
  const types: Record<string, string[]> = {};
  for (const [, file, at, code, said] of checked.stdout.matchAll(/^(.+?)(\(\d+,\d+\)): error (TS\d+): (.*)$/gm)) {
    const path = file.replaceAll("\\", "/");
    const type = /^Type '(.*)' is not assignable to type 'never'\.$/.exec(said)?.[1];
    if (!path.startsWith("types/")) (errors[path] ??= []).push(`${at}: ${code}`);
    else if (type) (types[path] ??= []).push(type);
  }
  return { errors, types };
}

// A project that checks `callers` and `types` under the options that its package.json states for the typed files.
function project(compilerOptions: Record<string, unknown>) {
  return {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        ...compilerOptions,
        module: "preserve",
        moduleResolution: "bundler",
        noEmit: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["callers", "types"],
    }),
    "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", compilerOptions }),
  };
}
const assigned = { strict: true, lib: ["es2015"], useDefineForClassFields: false };

// Each shape is a library of its own in `src/<shape>/`. `caller` is judged twice: by the sources, and by the
// `index.aot.ts` of the shape's build. `errors`: every error that `bun check` has for the caller. `reads`: expressions
// of the caller whose types the two judges must agree on. `written`: lines that the typed file has.
type Shape = {
  files: Record<string, string>;
  caller: string;
  reads: string[];
  errors: string[];
  written: string[];
};
const shapes: Record<string, Shape> = {
  "number-text-and-flag": {
    files: {
      "index.ts": `export class Box {
  n = 1;
  label = "x";
  flag = false;
  text(): string { return this.label + this.n + this.flag; }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
box.n = 2;
box.label = "y";
box.flag = true;
box.n = "two";
`,
    reads: ["new Box().n", "new Box().label", "new Box().flag"],
    errors: ["(6,1): TS2322"],
    written: ["declare n: number;", "declare label: string;", "declare flag: boolean;"],
  },
  "readonly-literal-that-tells-two-classes-apart": {
    files: {
      "index.ts": `export class Circle {
  readonly kind = "circle";
  readonly sides = 0;
  r = 1;
}
export class Square {
  readonly kind = "square";
  readonly sides = 4;
  s = 1;
}
export function area(shape: Circle | Square): number { return shape.kind === "circle" ? shape.r : shape.s; }
`,
    },
    caller: `import { area, Circle, Square } from "LIBRARY";
const sum: number = area(new Circle()) + area(new Square());
let kind = new Circle().kind;
kind = "other";
const circle: "circle" = new Circle().kind;
const four: 4 = new Square().sides;
const wrong: "square" = new Circle().kind;
`,
    reads: ["new Circle().kind", "new Square().sides", "new Circle().r"],
    errors: ["(7,7): TS2322"],
    written: ['declare readonly kind = "circle";', "declare readonly sides = 4;", "declare r: number;"],
  },
  "member-of-an-enum": {
    files: {
      "index.ts": `export enum Unit { Px = "px", Em = "em", Rem = "rem" }
export class Box {
  unit = Unit.Px;
  readonly fixed = Unit.Em;
  #spare? = Unit.Rem;
  set(unit: Unit): void { this.unit = unit; }
  isFixed(): boolean { return this.fixed === Unit.Em; }
  spare(): Unit | undefined { return this.#spare; }
}
`,
    },
    caller: `import { Box, Unit } from "LIBRARY";
const box = new Box();
box.set(Unit.Rem);
box.unit = Unit.Em;
const em: Unit.Em = box.fixed;
let held = box.fixed;
held = Unit.Rem;
const wrong: Unit.Px = box.unit;
`,
    reads: ["new Box().unit", "new Box().fixed"],
    errors: ["(8,7): TS2322"],
    written: ["declare unit: Unit2;", "declare readonly fixed = Unit2.Em;", "#spare?: Unit2 | undefined;"],
  },
  "class-of-the-bundle-under-another-name": {
    files: {
      "index.ts": `import { Item } from "./item";
import { Item as Other } from "./other";
export class Box {
  item = new Item();
  others = new Map<string, Other>();
  pair = [new Item(), new Other()] as const;
  first: Item | null = null;
  add(name: string): number {
    this.others.set(name, new Other());
    return this.item.a + this.others.size + this.pair.length;
  }
}
export { Item, Other };
`,
      "item.ts": `export class Item { a = 1; }\n`,
      "other.ts": `export class Item { b = "x"; }\n`,
    },
    caller: `import { Box, Item, Other } from "LIBRARY";
const box = new Box();
const a: number = box.item.a;
const b: string | undefined = box.others.get("x")?.b;
box.item = new Item();
box.others = new Map<string, Other>();
box.item = new Other();
`,
    reads: ["new Box().item", "new Box().others", "new Box().pair"],
    errors: ["(7,1): TS2741"],
    written: [
      "declare item: Item;",
      "declare others: Map<string, Item2>;",
      "declare pair: readonly [Item, Item2];",
      "declare first: Item | null;",
    ],
  },
  "private-and-hash-private": {
    files: {
      "index.ts": `export class Box {
  static made = 0;
  private count = 1;
  protected name = "box";
  #held = null as string | null;
  readonly #kind = "box";
  constructor() {
    this.#held = "held";
  }
  clear(): void { this.#held = null; }
  get held() { return this.#held; }
  get kind() { return this.#kind; }
  get total() { return this.count + this.name.length; }
  relabel(): string { let label = this.#kind; label = "other"; return label; }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const held: string | null = box.held;
const kind: string = box.kind;
const total: number = box.total;
const wrong: string = box.held;
`,
    reads: ["new Box().held", "new Box().kind", "new Box().total"],
    errors: ["(6,7): TS2322"],
    written: [
      "static made = 0;",
      "declare private count: number;",
      "declare protected name: string;",
      "#held: string | null;",
      // `declare` is not for a private name, and `: "box"` would not widen where the sources do.
      "readonly #kind;",
    ],
  },
  "parameter-property-that-is-stored-again": {
    files: {
      "index.ts": `export class Box {
  constructor(public held = null as string | null, readonly size = 1, private label = "x") {
    this.held = label;
  }
  clear(): void { this.held = null; }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const held: string | null = box.held;
const size: number = box.size;
const wrong: string = box.held;
`,
    reads: ["new Box().held", "new Box().size"],
    errors: ["(5,7): TS2322"],
    written: [
      "declare public held: string | null;",
      "declare readonly size: number;",
      "declare private label: string;",
    ],
  },
  "member-with-no-value": {
    files: {
      "index.ts": `export class Logger {
  level;
  prefix?;
  ready!: boolean;
  constructor(verbose: boolean) {
    this.level = verbose ? "debug" : "warn";
    if (verbose) this.prefix = "> ";
  }
  start(): void { this.ready = true; }
}
`,
    },
    caller: `import { Logger } from "LIBRARY";
const level: string = new Logger(true).level;
const prefix: string | undefined = new Logger(true).prefix;
const wrong: number = new Logger(false).level;
`,
    reads: ["new Logger(true).level", "new Logger(true).prefix"],
    errors: ["(4,7): TS2322"],
    // `declare` allows no `!` (TS1255).
    written: ["declare level: string;", "declare prefix?: string | undefined;", "declare ready: boolean;"],
  },
  "quoted-and-numeric-names": {
    files: {
      "index.ts": `export class Box {
  "quoted name" = 1;
  0 = "zero";
  ["in brackets"] = true;
  maybe? = 2;
  sum(): string { return this["quoted name"] + this[0] + this["in brackets"] + (this.maybe ?? 0); }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const quoted: number = box["quoted name"];
const zero: string = box[0];
const wrong: string = box["in brackets"];
`,
    reads: ['new Box()["quoted name"]', "new Box()[0]", 'new Box()["in brackets"]', "new Box().maybe"],
    errors: ["(5,7): TS2322"],
    written: [
      'declare "quoted name": number;',
      "declare 0: string;",
      'declare ["in brackets"]: boolean;',
      "declare maybe?: number | undefined;",
    ],
  },
  "generic-class-and-class-expression": {
    files: {
      "index.ts": `export class Stack<T> {
  items = [] as T[];
  top = null as T | null;
  push(item: T): void { this.items.push(item); this.top = item; }
}
export const Counter = class {
  count = 0;
  add(): number { return ++this.count; }
};
export const Chain = class Link {
  next = null as Link | null;
  twin = Link.made;
  static made = 0;
  length(): number { return this.next ? this.next.length() + 1 : this.twin; }
};
export function make(): number {
  interface Point { x: number; y: number }
  class Local {
    at = { x: 0, y: 0 } as Point;
    moved = false;
    move(): number { this.moved = true; return this.at.x; }
  }
  return new Local().move();
}
`,
    },
    caller: `import { Chain, Counter, make, Stack } from "LIBRARY";
const stack = new Stack<string>();
stack.push("a");
const top: string | null = stack.top;
const count: number = new Counter().count + make();
stack.items = [1];
const length: number = new Chain().length() + (new Chain().next?.twin ?? 0);
`,
    reads: [
      "new Stack<string>().items",
      "new Stack<number>().top",
      "new Counter().count",
      "new Chain().next",
      "new Chain().twin",
    ],
    errors: ["(6,16): TS2322"],
    written: [
      "declare items: T[];",
      "declare top: T | null;",
      "declare count: number;",
      // The name of a class expression is a type inside that class.
      "declare next: Link | null;",
      "declare twin: number;",
      "declare at: Point;",
      "declare moved: boolean;",
    ],
  },
  "derived-class-with-a-constructor": {
    files: {
      "index.ts": `export class Base {
  n = 1;
  label = "base";
}
export class Derived extends Base {
  m = 2;
  override n = 3;
  constructor() {
    super();
  }
  sum(): number { return this.n + this.m; }
}
`,
    },
    caller: `import { Derived } from "LIBRARY";
const derived = new Derived();
const sum: number = derived.n + derived.m;
const label: string = derived.label;
const wrong: string = derived.m;
`,
    reads: ["new Derived().n", "new Derived().m", "new Derived().label"],
    errors: ["(5,7): TS2322"],
    written: ["declare m: number;", "declare n: number;"],
  },
  "type-that-has-no-name-where-the-member-stands": {
    files: {
      "index.ts": `import { hide, make } from "./hidden";
export class Box {
  hidden = hide();
  made = make<string>();
  pick = <U>(value: U): U => value;
  read(): string { return this.hidden.h + this.made.value; }
}
`,
      "hidden.ts": `export interface Hidden { h: string }
export interface Made<T> { value: T | undefined }
export function hide(): Hidden { return { h: "" }; }
export function make<T>(): Made<T> { return { value: undefined }; }
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const h: string = box.hidden.h;
const value: string | undefined = box.made.value;
const picked: number = box.pick(1);
const wrong: number = box.hidden.h;
`,
    reads: ["new Box().hidden", "new Box().made", "new Box().pick"],
    errors: ["(6,7): TS2322"],
    written: ["declare hidden;", "declare made;", "declare pick;"],
  },
  // The bundle names the class of other.ts `Item2`. In `make` that name is the interface.
  "renamed-class-beside-a-local-type-of-that-name": {
    files: {
      "index.ts": `import { Item } from "./item";
import { Item as Other } from "./other";
export function make(): number {
  interface Item2 { c: boolean }
  class Local {
    held = new Other();
    flag = { c: true } as Item2;
  }
  return new Local().held.b.length + Number(new Local().flag.c);
}
export { Item, Other };
`,
      "item.ts": `export class Item { a = 1; }\n`,
      "other.ts": `export class Item { b = "x"; }\n`,
    },
    caller: `import { make } from "LIBRARY";
const length: number = make();
const wrong: string = make();
`,
    reads: ["make()"],
    errors: ["(3,7): TS2322"],
    written: ["declare held;", "declare flag: Item2;"],
  },
  // A default does not add `undefined` to the member, also where a parameter with no default comes behind it.
  "parameter-property-with-a-default-before-a-parameter-with-none": {
    files: {
      "index.ts": `export class Box {
  constructor(public first = 1, readonly name: string, public last = "z") {}
  double(): number { return this.first * 2; }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box(undefined, "n");
const first: number = box.first;
const last: string = box.last;
const wrong: string = box.first;
`,
    reads: ['new Box(1, "n").first', 'new Box(1, "n").last'],
    errors: ["(5,7): TS2322"],
    written: ["declare public first: number;", "declare public last: string;"],
  },
  // The typed file declares the types of a namespace. Its object is a variable there.
  "type-of-a-namespace": {
    files: {
      "index.ts": `export namespace Shapes {
  export interface Options { wide: boolean }
  export namespace Inner { export interface Deep { d: number } export const limit = 1; }
}
export class Holder {
  options = { wide: true } as Shapes.Options;
  deep = { d: Shapes.Inner.limit } as Shapes.Inner.Deep;
  wide(): boolean { return this.options.wide && this.deep.d > 0; }
}
`,
    },
    caller: `import { Holder, Shapes } from "LIBRARY";
const holder = new Holder();
const options: Shapes.Options = holder.options;
const d: number = holder.deep.d;
const wrong: string = holder.options.wide;
`,
    reads: ["new Holder().options", "new Holder().deep"],
    errors: ["(5,7): TS2322"],
    written: ["declare options: Shapes.Options;", "declare deep: Shapes.Inner.Deep;"],
  },
  // other.ts has a class `Map` of its own, and index.js names no other `Map`. So the bundle does not rename that class.
  "global-that-the-bundle-shadows": {
    files: {
      "index.ts": `import { Map as Own } from "./other";
export class Box {
  items = null as Map<string, number> | null;
  own = new Own();
  size(): number { return (this.items?.size ?? 0) + this.own.own; }
}
`,
      "other.ts": `export class Map { own = 1; }\n`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const items: globalThis.Map<string, number> | null = box.items;
const own: number = box.own.own;
const wrong: number = box.items;
`,
    reads: ["new Box().items", "new Box().own"],
    errors: ["(5,7): TS2322"],
    written: ["declare items: globalThis.Map<string, number> | null;", "declare own: Map;"],
  },
  // A type printer writes `any` below ten levels and for a type inside itself. Such a text is not the type.
  "type-that-the-printer-cuts-short": {
    files: {
      "index.ts": `function cons<H, R>(head: H, rest: R) { return { head, rest }; }
export class Box {
  list = cons(1, cons(2, cons(3, cons(4, cons(5, cons(6, cons(7, cons(8, cons(9, cons(10, cons(11, cons(12, "end"))))))))))));
  api = { count: 0, add(n: number) { this.count += n; return this; } };
  pair = [this.api, this.api];
  // More than the 4,000 characters that a stated type can have.
  wide = { ${Array.from({ length: 400 }, (_, index) => `p${index}: ${index}`).join(", ")} };
  next(): number { return this.api.add(1).add(1).count + this.pair.length + this.wide.p399; }
}
`,
    },
    caller: `import { Box } from "LIBRARY";
const box = new Box();
const end: string = box.list.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest;
const count: number = box.api.add(1).add(2).add(3).count + box.pair[0].add(1).count + box.wide.p399;
const wrong: number = box.list.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest;
`,
    reads: [
      "new Box().list.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.rest.head",
      "new Box().api.add(1).add(1).count",
      "new Box().pair[0].add(1).count",
      "new Box().wide.p399",
    ],
    errors: ["(5,7): TS2322"],
    written: ["declare list;", "declare api;", "declare pair;", "declare wide;"],
  },
};

const names = Object.keys(shapes);
const builds = [
  { flags: [] as string[], built: names.slice(0, 6) },
  { flags: [] as string[], built: names.slice(6, 12) },
  { flags: [] as string[], built: names.slice(12) },
  { flags: ["--minify-syntax", "--minify-whitespace"], built: names },
].map(build => ({ ...build, title: [...build.flags, ...build.built].join(" ") }));

// A typed file names a class or an enum as its bundle does: `Item2`, `Unit2`.
const named = (printed: string[] = []) => printed.map(type => type.replace(/\b([A-Za-z_$][\w$]*?)\d+\b/g, "$1"));

describe.concurrent("bun build --dts states the type of a class field that the build assigns", () => {
  test.each(builds)("$title", async ({ flags, built }) => {
    const files: Record<string, string> = { ...project(assigned) };
    for (const name of built) {
      const shape = shapes[name];
      for (const [path, text] of Object.entries(shape.files)) files[`src/${name}/${path}`] = text;
      const [imports] = shape.caller.split("\n");
      const types = `${imports}\n${shape.reads.map((read, index) => `const type${index}: never = ${read};\n`).join("")}`;
      for (const [judge, library] of [
        ["of-the-sources", `../../src/${name}/index`],
        ["of-the-typed-file", `../../out/${name}/index.aot`],
      ]) {
        files[`callers/${judge}/${name}.ts`] = shape.caller.replace('"LIBRARY"', `"${library}"`);
        files[`types/${judge}/${name}.ts`] = types.replace('"LIBRARY"', `"${library}"`);
      }
    }
    using dir = tempDir("build-dts-assigned-fields", files);
    const entries = built.map(name => `./src/${name}/index.ts`);
    const build = await bun(String(dir), "build", ...entries, "--root", "src", "--outdir", "out", "--dts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const { errors, types } = await checkedIn(String(dir));
    const byShape = <T>(of: (name: string) => T) => Object.fromEntries(built.map(name => [name, of(name)]));
    const judged = (judge: string) =>
      byShape(name => ({
        errors: errors[`callers/${judge}/${name}.ts`] ?? [],
        types: named(types[`types/${judge}/${name}.ts`]),
      }));
    expect(byShape(name => errors[`callers/of-the-sources/${name}.ts`] ?? [])).toEqual(
      byShape(name => shapes[name].errors),
    );
    expect(byShape(name => types[`types/of-the-sources/${name}.ts`]?.length)).toEqual(
      byShape(name => shapes[name].reads.length),
    );
    expect(judged("of-the-typed-file")).toEqual(judged("of-the-sources"));
    // The typed files are sources of this project here, so a code that a build drops for a package counts too.
    expect(byShape(name => errors[`out/${name}/index.aot.ts`] ?? [])).toEqual(byShape(() => []));
    // Without its types, a typed file is the JavaScript beside it.
    const read = (name: string, file: string) => readFileSync(join(String(dir), "out", name, file), "utf8");
    const code = (text: string, loader: "ts" | "js") =>
      new Bun.Transpiler({ loader, target: "node" })
        .transformSync(text)
        .replace(/\/\/.*$/gm, "")
        .replace(/\s+/g, "");
    expect(byShape(name => code(read(name, "index.aot.ts"), "ts"))).toEqual(
      byShape(name => code(read(name, "index.js"), "js")),
    );
    if (flags.length > 0) return;
    const lines = (name: string) =>
      read(name, "index.aot.ts")
        .split("\n")
        .map(line => line.trim());
    expect(byShape(name => shapes[name].written.filter(line => lines(name).includes(line)))).toEqual(
      byShape(name => shapes[name].written),
    );
  });
});

// Builds of their own: other options, and a build that moves nothing.
const box = `export class Box {
  n = 1;
  items = new Map<string, number>();
  readonly kind = "box";
  label(): string { return this.kind + this.n + this.items.size; }
}
`;
const boxCaller = (library: string) => `import { Box } from "${library}";
const n: number = new Box().n;
const items: Map<string, number> = new Box().items;
const kind: "box" = new Box().kind;
const wrong: string = new Box().n;
`;
const boxTypes = (library: string) => `import { Box } from "${library}";
const type0: never = new Box().n;
const type1: never = new Box().items;
const type2: never = new Box().kind;
`;
const judgedTwice = {
  "callers/of-the-sources.ts": boxCaller("../src/index"),
  "callers/of-the-typed-file.ts": boxCaller("../out/index.aot"),
  "types/of-the-sources.ts": boxTypes("../src/index"),
  "types/of-the-typed-file.ts": boxTypes("../out/index.aot"),
};
const BOX_TYPES = ["number", "Map<string, number>", '"box"'];
const BOX_ERRORS = ["(5,7): TS2322"];

describe.concurrent("bun build --dts and class fields", () => {
  test("without noImplicitAny a field that the build assigns keeps its type", async () => {
    const loose = { strict: false, lib: ["es2015"], useDefineForClassFields: false };
    using dir = tempDir("build-dts-assigned-fields-loose", { ...project(loose), ...judgedTwice, "src/index.ts": box });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain("  declare n: number;\n  declare items: Map<string, number>;\n");
    expect(typed).toContain('  declare readonly kind = "box";\n');
    expect(await checkedIn(String(dir))).toEqual({
      errors: { "callers/of-the-sources.ts": BOX_ERRORS, "callers/of-the-typed-file.ts": BOX_ERRORS },
      types: { "types/of-the-sources.ts": BOX_TYPES, "types/of-the-typed-file.ts": BOX_TYPES },
    });
  });

  // On Windows the build says nothing about .aot.ts files that it leaves out.
  test.todoIf(isWindows)(
    "without noImplicitAny a field whose type has no name there leaves the typed files out",
    async () => {
      const loose = { strict: false, lib: ["es2015"], useDefineForClassFields: false };
      using dir = tempDir("build-dts-assigned-fields-loose-hidden", {
        ...project(loose),
        "src/hidden.ts": `export interface Hidden { h: string }\nexport function hide(): Hidden { return { h: "" }; }\n`,
        "src/index.ts": `import { hide } from "./hidden";\nexport class Box {\n  hidden = hide();\n}\n`,
      });
      const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr:
          "warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at index.aot.ts:10:10: TS2339: Property 'hidden' does not exist on type 'Box'.\n",
        exitCode: 0,
      });
      expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["hidden.d.ts", "index.d.ts", "index.js"]);
    },
  );

  // A namespace object is `any` in a typed file, so the overloaded call answers `string` there, and `number` in the
  // sources. Without the type of the sources, the typed file says that `size` is a string.
  test.todoIf(isWindows)(
    "a store that the typed file types in another way than the sources leaves the typed files out",
    async () => {
      using dir = tempDir("build-dts-assigned-fields-other-store", {
        ...project(assigned),
        "src/index.ts": `namespace Defaults { export const size = 1; }
function pick(value: string): string;
function pick(value: number): number;
function pick(value: any): any { return value; }
export class Box {
  #size = pick(Defaults.size);
  get size() { return this.#size; }
}
`,
      });
      const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr:
          "warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at index.aot.ts:14:5: TS2322: Type 'string' is not assignable to type 'number'.\n",
        exitCode: 0,
      });
      expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js"]);
    },
  );

  test("a module that is not checked declares the field with no type", async () => {
    using dir = tempDir("build-dts-assigned-fields-unchecked", {
      ...project(assigned),
      "src/index.ts": `// @ts-nocheck\n${box}`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain("  declare n;\n  declare items;\n  declare readonly kind;\n");
  });

  test("a field is declared by the tsconfig.json of its own file", async () => {
    using dir = tempDir("build-dts-assigned-fields-nearest", {
      ...project({ strict: true, lib: ["es2015"] }),
      ...judgedTwice,
      "src/index.ts": `export { Box } from "./old/box";\nexport class Kept {\n  n = 1;\n}\n`,
      "src/old/tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "src/old/box.ts": box,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain("  declare n: number;\n  declare items: Map<string, number>;\n");
    expect(typed).toContain("class Kept {\n  n = 1;\n}");
    expect(await checkedIn(String(dir))).toEqual({
      errors: { "callers/of-the-sources.ts": BOX_ERRORS, "callers/of-the-typed-file.ts": BOX_ERRORS },
      types: { "types/of-the-sources.ts": BOX_TYPES, "types/of-the-typed-file.ts": BOX_TYPES },
    });
  });

  // The typed file of another output has the class. For `take`, this one declares a twin of it, which is another type.
  test("--splitting: a field whose class is in another output takes its type from the constructor", async () => {
    const reads = (library: string) => `import { Box } from "${library}";
const type0: never = new Box().item;
const type1: never = new Box().held;
const type2: never = new Box().unit;
const type3: never = new Box().n;
`;
    using dir = tempDir("build-dts-assigned-fields-splitting", {
      ...project(assigned),
      "src/shared.ts": `export class Item {
  a = 1;
  private secret = "s";
  read(): string { return this.secret + this.a; }
}
export enum Unit { Px, Em }
`,
      "src/index.ts": `import { Item, Unit } from "./shared";
export class Box {
  item = new Item();
  #held = new Item();
  unit = Unit.Px;
  n = 1;
  get held() { return this.#held; }
  set(unit: Unit): void { this.unit = unit; }
  take(item: Item): void {}
}
`,
      "src/other.ts": `import { Item, Unit } from "./shared";
export function make() { return new Item(); }
export function unit() { return Unit.Em; }
`,
      "types/of-the-sources.ts": reads("../src/index"),
      "types/of-the-typed-file.ts": reads("../out/index.aot"),
    });
    const entries = ["./src/index.ts", "./src/other.ts"];
    const build = await bun(String(dir), "build", ...entries, "--splitting", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      "  declare item;\n  #held;\n  declare unit: Unit;\n  declare n: number;\n",
    );
    const types = ["Item", "Item", "Unit", "number"];
    expect(await checkedIn(String(dir))).toEqual({
      errors: {},
      types: { "types/of-the-sources.ts": types, "types/of-the-typed-file.ts": types },
    });
  });

  // A member with no value has the type of its stores, and this build removes them. The sources name `Other`, and
  // the typed file names that class as its bundle does.
  test("a member with no value is stated with the names that the typed file has", async () => {
    const reads = (library: string) => `import { Box } from "${library}";
const box = new Box<string>(true);
const type0: never = box.item;
const type1: never = box.other;
const type2: never = box.others;
const type3: never = box.unit;
const type4: never = box.mode;
const type5: never = box.top;
`;
    using dir = tempDir("build-dts-members-without-values", {
      ...project({ strict: true, lib: ["es2015"] }),
      "src/item.ts": `export class Item { a = 1; }\n`,
      "src/other.ts": `export class Item { b = "x"; }\n`,
      "src/index.ts": `import { Item } from "./item";
import { Item as Other } from "./other";
declare const __DEV__: boolean;
export enum Unit { Px, Em }
export type Mode = "fast" | "slow";
export class Box<T> {
  item;
  other;
  others;
  unit;
  mode;
  top;
  constructor(on: boolean, first?: T) {
    if (__DEV__) {
      this.item = new Item();
      this.other = new Other();
      this.others = new Map<string, Other>();
      this.unit = on ? Unit.Px : Unit.Em;
      this.mode = (on ? "fast" : "slow") as Mode;
      this.top = first;
    }
  }
}
export { Item, Other };
`,
      "types/of-the-sources.ts": reads("../src/index"),
      "types/of-the-typed-file.ts": reads("../out/index.aot"),
    });
    const flags = ["--outdir", "out", "--dts", "--define", "__DEV__=false"];
    const build = await bun(String(dir), "build", "./src/index.ts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(`class Box<T> {
  item: Item | undefined;
  other: Item2 | undefined;
  others: Map<string, Item2> | undefined;
  unit: Unit2 | undefined;
  mode: Mode | undefined;
  top: T | undefined;
`);
    const { errors, types } = await checkedIn(String(dir));
    expect(errors).toEqual({});
    expect(named(types["types/of-the-typed-file.ts"])).toEqual(named(types["types/of-the-sources.ts"]));
    expect(types["types/of-the-sources.ts"]).toEqual([
      "Item | undefined",
      "Item | undefined",
      "Map<string, Item> | undefined",
      "Unit | undefined",
      "Mode | undefined",
      "string | undefined",
    ]);
  });

  // A class with a computed name keeps its fields. Such a field has its type from its value, as in the sources.
  test("a field that keeps its value in the bundle gets no type", async () => {
    using dir = tempDir("build-dts-assigned-fields-kept", {
      ...project(assigned),
      "src/index.ts": `const key = "dynamic";
export enum Unit { Px, Em }
export class Box {
  [key] = 0;
  n = 1;
  readonly kind = "box";
  unit = Unit.Px;
  #held = "h";
  maybe? = 2;
  label(): string { return this.kind + this.n + this.#held + this.unit + (this.maybe ?? 0); }
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(`class Box {
  [key] = 0;
  n = 1;
  readonly kind = "box";
  unit: Unit2 = 0 as Unit2.Px /* Px */;
  #held = "h";
  maybe? = 2;
`);
  });

  // The build removes the store, so index.js has no `Item`. For `take`, index.aot.ts declares a twin of the class,
  // which is another type than the class that other.aot.ts imports. The member does not take the twin as its type.
  test("--splitting: a member with no value does not get a twin of a class of another output", async () => {
    using dir = tempDir("build-dts-members-splitting-twin", {
      ...project({ strict: true, lib: ["es2015"] }),
      "src/shared.ts": `export class Item {
  a = 1;
  private secret = "s";
  read(): string { return this.secret + this.a; }
}
`,
      "src/index.ts": `import { Item } from "./shared";
declare const __DEV__: boolean;
export class Box {
  item;
  constructor() {
    if (__DEV__) this.item = new Item();
  }
  take(item: Item): void {}
}
`,
      "src/other.ts": `import { Item } from "./shared";
export function make() { return new Item(); }
`,
      "callers/of-the-sources.ts": `import { Box } from "../src/index";
import { make } from "../src/other";
new Box().item = make();
`,
      "callers/of-the-typed-file.ts": `import { Box } from "../out/index.aot";
import { make } from "../out/other.aot";
new Box().item = make();
`,
    });
    const flags = ["--splitting", "--outdir", "out", "--dts", "--define", "__DEV__=false"];
    const build = await bun(String(dir), "build", "./src/index.ts", "./src/other.ts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain("class Box {\n  item;\n");
    const { errors } = await checkedIn(String(dir));
    expect({
      sources: errors["callers/of-the-sources.ts"] ?? [],
      typedFile: errors["callers/of-the-typed-file.ts"] ?? [],
    }).toEqual({ sources: [], typedFile: [] });
  });

  // No annotation and no cast of the bundle names `Hidden`. The typed file declares it for the stated type.
  test("a stated type brings a type that nothing else in the bundle names", async () => {
    using dir = tempDir("build-dts-assigned-fields-only-name", {
      "package.json": project(assigned)["package.json"],
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...assigned, module: "preserve", moduleResolution: "bundler", noEmit: true, types: [] },
        include: ["src", "globals.d.ts"],
      }),
      "globals.d.ts": `declare function hide(): import("./src/types").Hidden;\n`,
      "src/types.ts": `export interface Hidden { h: string }\n`,
      "src/index.ts": `import type { Hidden } from "./types";
export class Box {
  hidden = hide();
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain("interface Hidden { h: string }\n");
    expect(typed).toContain("declare hidden: Hidden;\n");
  });

  // index.js imports the class of the package as a value. The typed file imports its type for the member.
  test("a stated type brings the import of a package that is not in the bundle", async () => {
    const caller = (library: string) => `import { Emitter } from "ext";
import { Bus } from "${library}";
const emitter: Emitter = new Bus().emitter;
const wrong: number = new Bus().emitter;
`;
    using dir = tempDir("build-dts-assigned-fields-package", {
      ...project(assigned),
      "node_modules/ext/package.json": JSON.stringify({ name: "ext", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/ext/index.js": `export class Emitter { on(name, listener) { return this; } }\n`,
      "node_modules/ext/index.d.ts": `export declare class Emitter { on(name: string, listener: () => void): this; }\n`,
      "src/index.ts": `import { Emitter } from "ext";
export class Bus {
  emitter = new Emitter();
}
`,
      "callers/of-the-sources.ts": caller("../src/index"),
      "callers/of-the-typed-file.ts": caller("../out/index.aot"),
    });
    const flags = ["--outdir", "out", "--dts", "--packages", "external"];
    const build = await bun(String(dir), "build", "./src/index.ts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain('import type { Emitter as Emitter2 } from "ext";\n');
    expect(typed).toContain("declare emitter: Emitter2;\n");
    const { errors } = await checkedIn(String(dir));
    expect(errors).toEqual({
      "callers/of-the-sources.ts": ["(4,7): TS2322"],
      "callers/of-the-typed-file.ts": ["(4,7): TS2322"],
    });
  });

  // Beside an `accessor` field the bundle keeps a field for a parameter property.
  test("a parameter property whose field the bundle keeps gets its type at that field", async () => {
    using dir = tempDir("build-dts-assigned-fields-kept-parameter", {
      ...project(assigned),
      "src/index.ts": `export class Box {
  accessor first = 1;
  constructor(public held = null as string | null, readonly size = 1) {}
  clear(): void { this.held = null; }
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed).toContain("  public held: string | null;\n  readonly size: number;\n");
  });

  // The build removed `Req` from index.js. For `handle`, index.aot.ts declares the class, and no other output has it.
  test("a field takes the declaration of a class that the build removed from its one output", async () => {
    const caller = (library: string) => `import { Server } from "${library}";
const url: string | undefined = new Server().current?.url;
const wrong: number = new Server().current;
`;
    using dir = tempDir("build-dts-assigned-fields-removed-class", {
      ...project(assigned),
      "src/req.ts": `export class Req {
  url = "/";
  private secret = "s";
  path(): string { return this.url + this.secret; }
}
`,
      "src/index.ts": `import { Req } from "./req";
export class Server {
  current = null as Req | null;
  handle(req: Req): string { this.current = req; return req.path(); }
}
`,
      "callers/of-the-sources.ts": caller("../src/index"),
      "callers/of-the-typed-file.ts": caller("../out/index.aot"),
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain("  declare current: Req | null;\n");
    const { errors } = await checkedIn(String(dir));
    expect(errors).toEqual({
      "callers/of-the-sources.ts": ["(3,7): TS2322"],
      "callers/of-the-typed-file.ts": ["(3,7): TS2322"],
    });
  });

  // The bundle has `0` for `Level.Low`, and its source map has no place for the field. The class has one `#level`.
  test("a private field that the source map has no place for gets its type by its name", async () => {
    const caller = (library: string) => `import { Box } from "${library}";
const level: number = new Box().level;
const wrong: string = new Box().level;
`;
    const reads = (library: string) => `import { Box } from "${library}";
const type0: never = new Box().level;
`;
    using dir = tempDir("build-dts-assigned-fields-private-enum", {
      ...project(assigned),
      "src/level.ts": `export enum Level { Low, High }\n`,
      "src/index.ts": `import { Level } from "./level";
export class Box {
  #level = Level.Low;
  get level() { return this.#level; }
  raise(): void { this.#level = Level.High; }
}
`,
      "callers/of-the-sources.ts": caller("../src/index"),
      "callers/of-the-typed-file.ts": caller("../out/index.aot"),
      "types/of-the-sources.ts": reads("../src/index"),
      "types/of-the-typed-file.ts": reads("../out/index.aot"),
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed.match(/^ *#level.*;$/gm)).toEqual(["  #level: Level;"]);
    expect(await checkedIn(String(dir))).toEqual({
      errors: { "callers/of-the-sources.ts": ["(3,7): TS2322"], "callers/of-the-typed-file.ts": ["(3,7): TS2322"] },
      types: { "types/of-the-sources.ts": ["Level"], "types/of-the-typed-file.ts": ["Level"] },
    });
  });

  // What the stores of the bundle say of such a member is another type than the one of the sources: `"em"` is a
  // string there, and the object of a namespace is `any`. With no name for the type, the member gets no declaration.
  test.todoIf(isWindows).each([
    [
      "an enum behind a namespace import",
      {
        "src/unit.ts": `export enum Unit { Px = "px", Em = "em" }\n`,
        "src/index.ts": `import * as u from "./unit";
export class Box {
  readonly fixed = u.Unit.Em;
  label(): string { return this.fixed; }
}
`,
      },
      "index.aot.ts:4:10: TS2339: Property 'fixed' does not exist on type 'Box'.",
    ],
    [
      "an enum of a namespace",
      {
        "src/index.ts": `export namespace Shapes {
  export enum Kind { Circle = "circle", Square = "square" }
}
export class Holder {
  kind = Shapes.Kind.Circle;
  is(kind: Shapes.Kind): boolean { return this.kind === kind; }
}
`,
      },
      "index.aot.ts:13:10: TS2339: Property 'kind' does not exist on type 'Holder'.",
    ],
    [
      "an enum of a function",
      {
        "src/index.ts": `export function make(): number {
  enum Local { A = "a", B = "b" }
  class Box {
    readonly fixed = Local.B;
    size(): number { return this.fixed.length; }
  }
  return new Box().size();
}
`,
      },
      "index.aot.ts:11:12: TS2339: Property 'fixed' does not exist on type 'Box'.",
    ],
    // The field has its type, and the bundle stores `"fast"` with no cast.
    [
      "an enum with text values of another module, at a private name,",
      {
        "src/mode.ts": `export enum Mode { Fast = "fast", Slow = "slow" }\n`,
        "src/index.ts": `import { Mode } from "./mode";
export class Box {
  #mode = Mode.Fast;
  get mode() { return this.#mode; }
}
`,
      },
      "index.aot.ts:5:5: TS2322: Type '\"fast\"' is not assignable to type 'Mode'.",
    ],
  ])("a field whose type is %s leaves the typed files out", async (_, sources, first) => {
    using dir = tempDir("build-dts-assigned-fields-other-stores", { ...project(assigned), ...sources });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: `warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at ${first}\n`,
      exitCode: 0,
    });
  });

  // The bundle gives such a class `constructor() { super(...arguments); }`. With that, `new HttpError("gone")` of the
  // sources has an argument too many.
  test.todoIf(isWindows)("a derived class with no constructor leaves the typed files out", async () => {
    using dir = tempDir("build-dts-assigned-fields-derived-warning", {
      ...project(assigned),
      "src/index.ts": `export class HttpError extends Error {
  status = 500;
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr:
        "warn: the .aot.ts files that --aot compiles a package from are left out: index.js: class HttpError inherits its constructor in the sources, and the build gives it one with no parameters\n",
      exitCode: 0,
    });
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js"]);
  });

  // The typed file needs the parameters of the base class at the constructor that the build adds.
  test.todo("a derived class with no constructor keeps its typed file", async () => {
    using dir = tempDir("build-dts-assigned-fields-derived", {
      ...project(assigned),
      "src/index.ts": `export class Base {
  n = 1;
}
export class Derived extends Base {
  m = 2;
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain("  declare m: number;\n");
  });

  test("a build that defines the fields writes no declaration for them", async () => {
    using dir = tempDir("build-dts-defined-fields", {
      ...project({ strict: true, lib: ["es2015"], useDefineForClassFields: true }),
      "src/index.ts": `export class Box {
  n = 1;
  readonly kind = "box";
  #held = null as string | null;
  constructor(public size = 2) {
    this.#held = "held";
  }
  label(): string { return this.kind + this.n + this.#held; }
}
`,
    });
    const build = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toEndWith(`
class Box {
  public size;
  n = 1;
  readonly kind = "box";
  #held = null as string | null;
  constructor(size = 2) {
    this.size = size;
    this.#held = "held";
  }
  label(): string {
    return this.kind + this.n + this.#held;
  }
}
export {
  Box
};
`);
  });
});
