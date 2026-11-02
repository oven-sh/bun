// `x["name"]` is `x.name`: however a program spells the names of its properties, it compiles to the same machine code and prints the same.
// ./respell-property-names.ts writes a program in each spelling, ./same-code-in-every-spelling.ts builds them and compares the code function by function.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { describe, test } from "../supported";
import { respell, type Spelling } from "./respell-property-names";
import { compareSpellings, functionsByOrder, storedProgram } from "./same-code-in-every-spelling";

const programs = [
  "classes-and-closures/own-accessor-hides-a-getter-and-a-setter.ts",
  "commonjs/function-given-members-object-define.cjs",
  "commonjs/members-are-named-as-packages-name-them.cjs",
  "language/members-named-every-place-name-can-stand.ts",
  "language/patterns-take-members-by-name.js",
];

describe("a program compiles to the same code in every spelling", () => {
  test.concurrent.each(programs)(
    "%s",
    async program => {
      using folder = tempDir("aot-every-spelling", {});
      expect(await compareSpellings(bunExe(), storedProgram(program, String(folder)), String(folder))).toEqual([]);
    },
    300_000,
  );
});

describe("respell-property-names", () => {
  const inEach = (text: string, path = "a.ts") =>
    Object.fromEntries(
      (["names", "strings", "computed", "templates"] as Spelling[]).map(spelling => [
        spelling,
        respell(text, path, spelling),
      ]),
    );

  test("accesses", () => {
    expect(inEach('a.b["c"]?.d(e?.[`f`]);')).toEqual({
      names: "a.b.c?.d(e?.f);",
      strings: 'a["b"]["c"]?.["d"](e?.["f"]);',
      computed: 'a["b"]["c"]?.["d"](e?.["f"]);',
      templates: "a[`b`][`c`]?.[`d`](e?.[`f`]);",
    });
  });

  test("keys of literals, classes and patterns", () => {
    expect(inEach('const { p, q: r } = { p, "q": 1, m() {} }; class C { f = 1; static ["s"]() {} }')).toEqual({
      names: "const { p, q: r } = { p, q: 1, m() {} }; class C { f = 1; static s() {} }",
      strings: 'const { "p": p, "q": r } = { "p": p, "q": 1, "m"() {} }; class C { "f" = 1; static "s"() {} }',
      computed:
        'const { "p": p, ["q"]: r } = { ["p"]: p, ["q"]: 1, ["m"]() {} }; class C { ["f"] = 1; static ["s"]() {} }',
      templates:
        'const { "p": p, [`q`]: r } = { [`p`]: p, [`q`]: 1, [`m`]() {} }; class C { [`f`] = 1; static [`s`]() {} }',
    });
  });

  test("a line stays the same line", () => {
    expect(respell("a\n  .b\n  .c();", "a.js", "computed")).toBe('a\n  ["b"]\n  ["c"]();');
    expect(respell('a[\n  "b"\n];', "a.js", "names")).toBe("a.b\n\n;");
  });

  test.each([
    ["what is no name", 'a["b-c"] + a["0"] + a["é"] + a.é + a.#p;'],
    ["types", "let a: b.c = d as e.f; type G = typeof h.i; class J implements k.l {}"],
    [
      "the constructor of a class",
      'class A { constructor() {} } class B { "constructor"() {} } class C { ["constructor"]() {} }',
    ],
    ["decorators and tags", "@a.b class C {} <d.e />;"],
  ])("%s is left as written", (_, text) => {
    for (const written of Object.values(inEach(text, "a.tsx"))) expect(written).toBe(text);
  });

  test("the last name of what a build replaces is left as written", () => {
    const text =
      'process.env.NODE_ENV + process.env["NODE_ENV"] + process.platform + process["arch"] + process.browser;';
    expect(respell(text, "a.js", "names")).toBe(text);
    expect(respell(text, "a.js", "computed")).toBe(
      'process["env"].NODE_ENV + process["env"]["NODE_ENV"] + process.platform + process["arch"] + process.browser;',
    );
  });

  test("__proto__ in a literal keeps its meaning", () => {
    expect(inEach('({ __proto__: a, ["__proto__"]: b });')).toEqual({
      names: '({ __proto__: a, ["__proto__"]: b });',
      strings: '({ "__proto__": a, ["__proto__"]: b });',
      computed: '({ "__proto__": a, ["__proto__"]: b });',
      templates: '({ "__proto__": a, [`__proto__`]: b });',
    });
    expect(respell("({ __proto__ });", "a.js", "strings")).toBe('({ ["__proto__"]: __proto__ });');
  });

  test("one form, one name or one place alone", () => {
    expect(respell("a.b(); a.c; a.b;", "a.js", "computed", { forms: new Set(["call"]) })).toBe('a["b"](); a.c; a.b;');
    expect(respell("a.b(); a.c; a.b;", "a.js", "computed", { names: new Set(["c"]) })).toBe('a.b(); a["c"]; a.b;');
    expect(respell("a.b(); a.c; a.b;", "a.js", "computed", { places: new Set([2]) })).toBe('a.b(); a.c; a["b"];');
  });
});

test("functions are told apart by their order, not by where they stand", () => {
  const code = Buffer.from([1, 2, 3, 4]);
  const map = (first: number, second: number) =>
    [`F\t0\t0\t2\t0\t0\t0\tf\tmain\t0\t/a/b.ts\t${first}`, `F\t1\t2\t2\t0\t0\t0\tf\tmain\t0\t/a/b.ts\t${second}`].join(
      "\n",
    );
  expect(functionsByOrder(map(7, 20), code)).toEqual(functionsByOrder(map(9, 31), code));
  expect([...functionsByOrder(map(7, 20), code).keys()]).toEqual(["f (main) b.ts", "f (main) b.ts #2"]);
});
