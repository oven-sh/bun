import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, longLimit } from "../children";
import { linesOf, tsc } from "./differential";

afterAll(endChildren);

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

// `let held = null; if (..) held = new A(); held.weigh(); if (..) held = new B(); held.weigh(); ..`: the union has one
// member more at each statement. `bun check` makes what it needs of such a union (its facts, the union without `null`, a
// property, that property's type, its signatures, their return type) of what it made of the union before and of the new
// member, wherever the members are plain enough, and TypeScript makes it of all the members. The programs below differ
// at random in all that decides whether they are plain enough. TypeScript is the oracle, so no output is stored.
//
// What it sees was measured: one condition of one shortcut was taken out at a time, and the programs that `bun check` then
// got wrong were counted, among the 1,000 made the first way | among the 1,000 that ask more closely (`closely`):
//   the new member's type left out of the property's type                        453 | 403
//   the part of a member with an index signature, taken by its place               3 | 3
//   the new member's part laid into the property at another place                447 | 397
//   its `?` and `readonly`                                                         7 | 6
//   its private or protected member                                               42 | 38
//   a signature that doesn't match the others                                     27 | 20
//   a return type of its own                                                      42 | 27
//   its facts (`possibly 'undefined'`)                                             2 | 0
//   the `NonNullable<T>` it needs                                                  1 | 2
//   a member that the filter should drop                                           0 | 1
//   a class below another | above another                                   32 | 31, 26 | 26
//   classes that join at once | an empty class                                  2 | 4, 4 | 6
//   one more instantiation of a generic class                                      0 | 7
//   a walk that shares what it found at an assignment of a `T extends A | B`       0 | 29
// WHAT IT DOES NOT SEE, and TypeScript's own tests (`bun check --run-typescript-tests`) don't either: a private or protected
// member of a union's property taken to be within reach (errors_access.rs, `has_union_property_within_reach()`).
// ./property-of-a-union-that-grows.test.ts holds that.
// Three more conditions can go without any type, error or symbol changing: which signature of the union before is taken
// for the first, the place of the new one among them, and the look at unit properties where classes join.
//
// `const p: never = x` reports the type of `x`.
const pool =
  "Anchor Barrel Candle Dagger Ember Fiddle Goblet Hammer Icicle Jacket Kettle Ladder Mallet Needle Oyster Pebble Quiver Ribbon Saddle Thimble Umbrella Velvet Whistle Yarn Zipper".split(
    " ",
  );

function random(seed: number) {
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (count: number) => Math.floor(next() * count);
  const choice = <T>(list: readonly T[]) => list[below(list.length)];
  const shuffled = <T>(list: readonly T[]) => {
    const all = [...list];
    for (let i = all.length - 1; i > 0; i--) {
      const j = below(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  };
  return { next, below, choice, shuffled };
}
type Random = ReturnType<typeof random>;

const method = (r: Random, i: number, name: string, odd: number) =>
  r.next() >= odd
    ? `weigh() { return ${i}; }`
    : r.choice([
        `weigh() { return "${name.toLowerCase()}"; }`,
        "weigh() { return true; }",
        "weigh() { return this; }",
        "weigh(): void {}",
        `weigh(more?: number) { return ${i} + (more ?? 0); }`,
        `weigh(more: number = 1, again?: string) { return ${i} + more; }`,
        `weigh(more: number) { return ${i} + more; }`,
        `weigh(...all: number[]) { return ${i} + all.length; }`,
        `weigh(): number; weigh(unit: string): string; weigh(unit?: string) { return unit === undefined ? ${i} : unit; }`,
        `weigh = () => ${i};`,
        "weigh?: () => number;",
        `readonly weigh = () => ${i};`,
        `get weigh() { return () => ${i}; }`,
        `weigh<T>(value?: T) { return value ?? ${i}; }`,
        `weigh(this: ${name}) { return ${i}; }`,
        `private weigh() { return ${i}; }`,
        `protected weigh() { return ${i}; }`,
        `static weigh() { return ${i}; }`,
        `weigh() { return [${i}]; }`,
        `weigh() { return { grams: ${i} }; }`,
        "weigh() { return null; }",
        "",
      ]);

const field = (r: Random, i: number, name: string, odd: number) =>
  r.next() >= odd
    ? `grams = ${i};`
    : r.choice([
        `grams = "${name.toLowerCase()}";`,
        `readonly grams = ${i};`,
        "grams?: number;",
        `grams = ${i} as const;`,
        `readonly kind = "${name.toLowerCase()}" as const; grams = ${i};`,
        `get grams() { return ${i}; }`,
        `get grams() { return ${i}; } set grams(value: number) {}`,
        `get grams() { return ${i}; } private set grams(value: number) {}`,
        `private grams = ${i};`,
        `protected grams = ${i};`,
        `static grams = ${i};`,
        "declare grams: number | undefined;",
        `grams: number | string = ${i};`,
        "[key: string]: any;",
        "[key: string]: () => string;",
        "",
      ]);

// `closely`: where one class alone is odd, everything is asked behind an odd assignment too. Generic classes are instantiated
// once more, and `held` is also asked for where nothing says what type is expected.
function program(seed: number, closely: boolean) {
  const r = random(seed);
  const names = r.shuffled(pool).slice(0, 9 + r.below(9));
  // How many of the classes, and of the statements, are anything but plain. In every other program one class alone is,
  // and everything is asked behind each statement, so what is made for that class is made of what was made before it.
  const oddOne = r.next() < 0.5 ? r.choice(names) : undefined;
  const oddness = oddOne ? 0 : r.choice([0, 0.04, 0.1, 0.25, 0.6]);
  const lines: string[] = [];
  const made: { name: string; generic: boolean }[] = [];
  names.forEach((name, index) => {
    const odd = name === oddOne ? 1 : oddness;
    const generic = r.next() < 0.2 * odd;
    let head = `class ${name}${generic ? "<T>" : ""}`;
    if (made.length > 0 && r.next() < 0.3 * odd) {
      const base = r.choice(made);
      head += ` extends ${base.name}${base.generic ? "<number>" : ""}`;
    }
    const body =
      r.next() < 0.1 * odd
        ? ""
        : `${field(r, index + 1, name, odd)} ${method(r, index + 1, name, odd)}${generic ? " held?: T;" : ""}`;
    lines.push(`${head} { ${body} }`);
    if (r.next() < 0.1 * odd) lines.push(`interface ${name}${generic ? "<T>" : ""} { extra?: number; }`);
    made.push({ name, generic });
  });
  const inside = r.next() < 0.7;
  const pad = inside ? " " : "";
  // What is read off a type parameter with a union constraint depends on where the reference stands.
  const [first, second] = made.filter(it => !it.generic).map(it => it.name);
  const given =
    inside && second ? r.choice(["T", "T", `T extends ${first} | ${second} | null`, `T extends ${first}`]) : "";
  lines.push(
    inside ? `function f${given && `<${given}>`}(n: number${given && ", given: T"}) {` : "declare const n: number;",
  );
  lines.push(pad + r.choice(["let held = null;", "let held;", "let held = undefined;", "var held = null;"]));
  const odd = oddness;
  const ask = (at: string) => {
    const probes = r.shuffled([
      "held",
      "held!.grams",
      "held!.weigh",
      "held!.weigh()",
      "held?.weigh?.()",
      "held?.grams",
      "[held]",
      "held!",
      "typeof held",
      "held.grams",
      "held.weigh()",
    ]);
    const asked = oddOne ? probes : probes.slice(0, 1 + r.below(4));
    asked.forEach((probe, j) => lines.push(`${pad}{ const p${at}_${j}: never = ${probe}; }`));
    // Nothing says what type is expected of `held` here, so a type parameter stays what it is.
    if (closely && given) lines.push(`${pad}{ const kept${at} = [held]; const p${at}: never = kept${at}; }`);
  };
  r.shuffled(made).forEach(({ name, generic }, k) => {
    const value = `new ${name}${generic && r.next() < 0.5 ? "<string>" : ""}()`;
    const plain = `if (n > ${k}) held = ${value};`;
    lines.push(
      pad +
        r.choice([
          ...Array(8).fill(plain),
          `held = n > ${k} ? ${value} : held;`,
          `if (n > ${k}) { held = ${value}; } else if (n < -${k}) { held = null; }`,
          `switch (n) { case ${k}: held = ${value}; }`,
        ]),
    );
    if (r.next() < (oddOne ? (closely ? 0.12 : 0.08) : 0.25 * odd)) {
      const others = ["undefined", `${k}`, '"text"', "(() => {})()", "null", `{ grams: ${k} }`, "[]"];
      // One more instantiation of a generic class may be a subtype of the one that is there.
      const generics = closely ? made.filter(it => it.generic) : [];
      const again = generics.map(it => `new ${it.name}<${r.choice(["string", "unknown", "never"])}>()`);
      // `held = given` assigns the constraint of `T`, because the type of `held` is expected there.
      const ofParameter = closely ? "(given as T)" : "given";
      const other = r.choice([...others, ...again, ...again, ...(given ? Array(3).fill(ofParameter) : [])]);
      lines.push(`${pad}if (n == ${k}) held = ${other};`);
      if (closely && oddOne) ask(`${k}o`);
    }
    if (r.next() < 0.3 * odd) {
      const test = r.choice([
        `held instanceof ${r.choice(made).name}`,
        'held && "grams" in held',
        'typeof held === "object"',
        "!held",
      ]);
      lines.push(`${pad}if (${test}) { const q${k}: never = held; }`);
    }
    if (oddOne || r.next() < 0.85) ask(`${k}`);
    // What the flags of the property and the parameters of the signature decide.
    if (r.next() < 0.3) {
      lines.push(
        pad +
          r.choice([
            "held!.grams = 1 as any;",
            "delete held!.grams;",
            "held!.weigh = null as any;",
            "delete held!.weigh;",
            "held!.weigh(1);",
            'held!.weigh(1, "text");',
            'held!.weigh("text");',
            "held!.grams++;",
          ]),
      );
    }
  });
  const listed = r.shuffled(made).slice(0, 2 + r.below(made.length - 1));
  lines.push(`${pad}const all = [${listed.map(({ name }) => `new ${name}()`).join(", ")}];`);
  lines.push(`${pad}{ const last: never = all; const one: never = all[0].weigh; }`);
  if (inside) lines.push(" return held;\n}");
  return `export {};\n${lines.join("\n")}\n`;
}

// A run of `bun check` has `longLimit`, on a machine that may be busy: 250 programs take a tenth of it.
const count = 1000;
const countInRun = 250;

for (const closely of [false, true]) {
  for (let first = 0; first < count; first += countInRun) {
    test.concurrent.skipIf(!tsc || isDebug || isASAN)(
      `unions that grow by a class at each statement have the types that TypeScript gives them: programs ${first + 1} to ${first + countInRun}${closely ? ", asked more closely" : ""}`,
      async () => {
        const seeds = Array.from({ length: countInRun }, (_, index) => first + index);
        const files = seeds.map(seed => [`${closely ? "q" : "p"}${seed}.ts`, program(seed + 1, closely)] as const);
        using dir = tempDir("check-unions-that-grow", { "tsconfig.json": tsconfig, ...Object.fromEntries(files) });
        const root = String(dir);
        const [theirs, ours] = await Promise.all([
          linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
          linesOf([bunExe(), "check", "--threads=1"], root, root),
        ]);
        expect(ours).toEqual(theirs);
        expect(theirs.length).toBeGreaterThan(20 * countInRun);
      },
      longLimit + 10_000,
    );
  }
}
