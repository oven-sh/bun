import { describe, expect, test } from "bun:test";
import {
  accountsFor,
  build,
  closed,
  completeness,
  computedModuleName,
  external,
  globalObject,
  machineCode,
  open,
  retainsFeature,
  type Use,
} from "./runtime-use-expectations";
import { unsupported } from "./harness/compiler";
import { declared, of, runtimeUse } from "./runtime-use-harness";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);

const wholeHolders = (use: Use) => use.lines.filter(line => line.endsWith(" (escapes, so any member may be used)"));
const wholeHostHolders = (use: Use) =>
  wholeHolders(use).filter(line => /^(Bun|process|console|performance) /.test(line));

group("built-ins that a program names", () => {
  test.each([["the base of a class", `class Mine extends HTMLRewriter {} new Mine();`]])(
    "a global is named by %s",
    async (_, text) => {
      const use = await of(text);
      expect({ ...completeness(use), named: use.lines.includes("global HTMLRewriter") }).toEqual({
        ...closed,
        named: true,
      });
    },
  );

  test("a member that reaches unknown code does not take its holder along", async () => {
    const use = await of(external + `external(Bun.nanoseconds, process.argv);`);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });

  test("Bun.plugin beside an import() of a computed name: the import opens the report", async () => {
    const use = await of(`Bun.plugin({ name: "a", setup() {} });\nconst name: string = process.argv[2]; import(name);`);
    expect({ ...completeness(use), named: use.lines.includes("Bun plugin") }).toEqual({
      ...open(computedModuleName),
      named: true,
    });
  });

  test("a built-in module, and the native code it binds", async () => {
    const isBinding = (line: string) => /^native \S*JSSQLStatement\.cpp:createJSSQLStatementConstructor$/.test(line);
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({
      "main.ts": `import { Database } from "bun:sqlite";\ndeclare const console: any;\nconsole.log(new Database(":memory:").query("select 1").get());`,
    });
    expect(use.lines[0]).toEqual(closed.first);
    expect(use.lines).toContain("module bun:sqlite");
    expect(use.lines.some(isBinding)).toBe(true);
    expect(without.lines.includes("module bun:sqlite")).toBe(false);
    expect(without.lines.some(isBinding)).toBe(false);
  });

  test.each([
    ["require.main === module", `console.log(require.main === module);`],
    ["process.getBuiltinModule of a literal", `console.log(typeof process.getBuiltinModule("node:fs").readFileSync);`],
  ])("a feature test leaves the report closed: %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("code from strings", () => {
  test.each([["an indirect eval", `console.log((0, eval)("1 + 1"));`]])(
    "text that is a constant is compiled with the program, so the report stays closed with %s",
    async (_, text) => {
      expect(completeness(await of(text))).toEqual(closed);
    },
  );

  const input = `declare const input: any;\n`;
  // What has been through native memory is a value nobody knows.
  const unknownFunction = `declare const CustomEvent: any;\nfunction mine() {}\nconst unknown: any = new CustomEvent("x", { detail: mine }).detail;\n`;

  test("code from strings is allowed unless the build says --disallow-code-generation-from-strings", async () => {
    const files = { "main.ts": declared + `console.log(eval(process.argv[2]));` };
    const [byDefault, withFlag] = await Promise.all([
      runtimeUse(files),
      runtimeUse(files, ["check", "--aot", "--no-pretty", "--disallow-code-generation-from-strings"]),
    ]);
    expect({
      byDefault: retainsFeature(byDefault.lines, "Interpreter"),
      withFlag: retainsFeature(withFlag.lines, "Interpreter"),
    }).toEqual({ byDefault: true, withFlag: false });
  });
});

group("modules that are named at run time", () => {
  test.each([
    ["import() of a computed path", `const name: string = process.argv[2]; import("./" + name);`],
    [
      "node:module out of process.getBuiltinModule, for another file",
      `console.log(process.getBuiltinModule("node:module").createRequire(process.argv[2])("late-package"));`,
    ],
  ])("the report is open with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(open(computedModuleName));
  });

  test.each([
    [
      "a constant name for what createRequire out of process.getBuiltinModule made for the file",
      `console.log(process.getBuiltinModule("node:module").createRequire((import.meta as any).url)("late-package"));`,
    ],
  ])("nothing is loaded, so the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  const asks = `process.getBuiltinModule("node:module").createRequire((import.meta as any).url)(process.argv[2])`;

  test("the arguments of the function around a CommonJS file hold require and module", async () => {
    const use = await runtimeUse({ "main.cjs": `console.log(arguments[1](process.argv[2]));` }, undefined, "main.cjs");
    expect(completeness(use)).toEqual(open(computedModuleName));
  });

  test("the arguments of a function in a CommonJS file do not", async () => {
    const use = await runtimeUse(
      { "main.cjs": `function count() { return arguments.length; }\nconsole.log(String(count(1)));` },
      undefined,
      "main.cjs",
    );
    expect(completeness(use)).toEqual(closed);
  });
});

group("modules that are not in the executable", () => {
  test.each([
    [
      "import()",
      {
        "main.ts": declared + `// @ts-ignore\ntry { console.log(await import("late-package")); } catch {}\nexport {};`,
      },
    ],
  ])(
    "a module that the build does not find throws where it is loaded, so the report stays closed: %s",
    async (_, files) => {
      const use = await runtimeUse(files);
      expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...closed, exitCode: 0 });
    },
  );

  test.each([
    [
      "import() of a file of the program",
      { "main.ts": declared + `console.log((await import("./own")).a);\nexport {};`, "own.ts": `export const a = 1;` },
    ],
  ])("%s leaves the report closed", async (_, files) => {
    expect(completeness(await runtimeUse(files))).toEqual(closed);
  });

  test.each([
    [
      "names",
      `// @ts-ignore\nimport { __legacyDecorateClassTS, __legacyMetadataTS } from "bun:wrap";\nconsole.log(typeof __legacyDecorateClassTS, typeof __legacyMetadataTS);`,
    ],
    ["the namespace", `// @ts-ignore\nimport * as helpers from "bun:wrap";\nconsole.log(helpers);`],
    ["a re-export", `// @ts-ignore\nexport { __legacyDecorateClassTS } from "bun:wrap";`],
    ["export *", `// @ts-ignore\nexport * from "bun:wrap";`],
    ["require", `console.log(require("bun:wrap"));`],
  ])("bun:wrap, which holds the helpers for decorators, is compiled with the program: %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("this in a sloppy function", () => {
  const main = `import lib from "./lib.cjs";\ndeclare const console: any;\nconsole.log(lib());`;

  test.each([
    [
      "is passed to what super finds in an arrow function",
      `module.exports = { me() { return (() => super.valueOf())(); } }.me;`,
    ],
  ])("may be the global object: the report is open when it %s", async (_, lib) => {
    expect(completeness(await runtimeUse({ "main.ts": main, "lib.cjs": lib }))).toEqual(open(globalObject));
  });

  test.each([
    ["it is at the top of the file", `const top = this; module.exports = () => top;`],
    [
      "super is in a method of a class, which is strict",
      `module.exports = () => new (class extends Object { me() { return super.valueOf(); } })().me();`,
    ],
  ])("the report stays closed when %s", async (_, lib) => {
    expect(completeness(await runtimeUse({ "main.ts": main, "lib.cjs": lib }))).toEqual(closed);
  });

  test("the report stays closed in an ECMAScript module", async () => {
    const use = await runtimeUse({
      "main.ts": main.replace("lib.cjs", "lib.mjs"),
      "lib.mjs": `export default function () { return this; }`,
    });
    expect(completeness(use)).toEqual(closed);
  });
});

group("Bun, process and other holders", () => {
  const me = `function (this: any) { return this; }`;

  test.each([
    [
      "an object of the program's own",
      `const mine: any = { fetch: 1, title: 2 }; delete mine.fetch; delete mine.title;`,
    ],
  ])("delete of a member of %s is no use of the other members", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });
});

group("parts of Bun that run code the compiler does not see", () => {
  test.each([
    [
      "CFunction of bun:ffi",
      `import { CFunction } from "bun:ffi";\nconsole.log(CFunction({ ptr: 0 as any }));`,
      "bun:ffi.CFunction",
    ],
  ])("the report is open with %s", async (_, text, builtin) => {
    expect(completeness(await of(text))).toEqual(open(machineCode(builtin)));
  });

  test.each([
    ["node:vm", `import vm from "node:vm"; console.log(vm);`],
    ["import() of bun:ffi", `console.log(await import("bun:ffi"));\nexport {};`],
  ])("only a call opens the report: it stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    [
      "has another extension and is imported with the type napi",
      `// @ts-ignore\nimport addon from "./hello.bin" with { type: "napi" };\nconsole.log(addon);`,
    ],
  ])("the report is open with a native addon that %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + text, "hello.node": "no addon", "hello.bin": "no addon" });
    expect(completeness(use)).toEqual(open(machineCode("process.dlopen")));
  });

  test("only a call that the program reaches opens the report: it stays closed with a native addon that is required in a function that nothing calls", async () => {
    const use = await runtimeUse({
      "main.ts": declared + `function never() { return require("./hello.node"); }\nconsole.log(1);`,
      "hello.node": "no addon",
    });
    expect(completeness(use)).toEqual(closed);
  });

  test.each([
    [
      "members of an object of the program's own",
      `const mine = { ModuleGraph: Map, build() {}, Transpiler: Map, dlopen() {} }; console.log(new mine.ModuleGraph(), mine.build(), new mine.Transpiler(), mine.dlopen());`,
    ],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    ["require", `declare const console: any, require: any;\nconsole.log(require("bun:internal-for-testing"));`],
  ])("the module that Bun's own tests use is listed: %s", async (_, text) => {
    expect(
      accountsFor(await runtimeUse({ "main.ts": "// @ts-nocheck\n" + text }), "module bun:internal-for-testing"),
    ).toBe(true);
  });
});

group("only reached code counts", () => {
  test("a function that nothing calls does not open the report", async () => {
    expect(completeness(await of(`function never() { return eval("1"); }\nconsole.log(1);`))).toEqual(closed);
  });

  test.each([["an import() of a computed name", `function never(name: string) { return import(name); }\n`]])(
    "%s in a function that nothing calls brings no built-in module along",
    async (_, never) => {
      const modulesOf = (use: Use) => use.lines.filter(line => line.startsWith("module "));
      const [plain, withNever] = await Promise.all([of(`console.log(1);`), of(never + `console.log(1);`)]);
      expect({ first: withNever.lines[0], modules: modulesOf(withNever) }).toEqual({
        first: closed.first,
        modules: modulesOf(plain),
      });
    },
  );

  test.each([
    [
      "a function that only such a function calls",
      `function inner() { return new HTMLRewriter(); }\nfunction never() { return inner(); }\nconsole.log(1);`,
    ],
    [
      "a getter of a class that nothing constructs",
      `class Never { get create() { return new HTMLRewriter(); } }\nconsole.log(1);`,
    ],
  ])("a global is not named by %s", async (_, text) => {
    const use = await of(text);
    expect({ first: use.lines[0], named: use.lines.includes("global HTMLRewriter"), exitCode: use.exitCode }).toEqual({
      first: closed.first,
      named: false,
      exitCode: 0,
    });
  });

  test.each([
    [
      "a getter of an instance that reaches unknown code",
      `class Maker { get create() { return new HTMLRewriter(); } }\nexternal(new Maker());`,
    ],
    [
      "the default in a pattern",
      `function create({ value = new HTMLRewriter() } = {} as any) { return value; }\ncreate();`,
    ],
    ["a generator", `function* create() { yield new HTMLRewriter(); }\nconsole.log([...create()]);`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(external + text);
    expect({ first: use.lines[0], named: use.lines.includes("global HTMLRewriter") }).toEqual({
      first: closed.first,
      named: true,
    });
  });
});

group("members of built-in classes", () => {
  const input = `declare const input: any;\n`;
  const members = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declared + input + text, "other.ts": `export const localeCompare = 1;` });
    return {
      first: use.lines[0],
      named: use.lines.includes("property localeCompare"),
      every: use.lines.includes("property toTemporalInstant"),
    };
  };

  test.each([
    ["a template with a constant in brackets", 'const tail = "Compare";\nconsole.log(input[`locale${tail}`]);'],
    ["the list of names of JSON.stringify", `console.log(JSON.stringify(input, ["localeCompare", 0]));`],
  ])("a member is used through %s", async (_, text) => {
    expect(await members(text)).toMatchObject({ first: closed.first, named: true });
  });

  test("a method of a primitive is named", async () => {
    const use = await of(`console.log((1234.5).toLocaleString("de"));`);
    expect({ ...completeness(use), named: use.lines.includes("property toLocaleString") }).toEqual({
      ...closed,
      named: true,
    });
  });

  const holderNames = [
    "sql",
    "file",
    "build",
    "password",
    "listen",
    "send",
    "serve",
    "Image",
    "$",
    "alert",
    "color",
    "fetch",
    "on",
    "mark",
  ];
  const holderMembers = (use: Use) =>
    use.lines.filter(
      line =>
        /^(Bun|process|global|console|performance|Intl) /.test(line) &&
        (line.endsWith(" (escapes, so any member may be used)") || holderNames.includes(line.split(" ")[1])),
    );

  test.each([
    [
      "an instance of a class",
      `class Mine { ${holderNames.map(name => `${name} = 1;`).join(" ")} }\nconst mine = new Mine();`,
    ],
    ["a parameter of type any", `const mine = ((input: any) => input)({});`],
  ])(
    "a property with the name of a member of Bun, process or the global object, read from %s, names no such member",
    async (_, creates) => {
      const reads = holderNames.map(name => `mine.${name}`).join(", ");
      const use = await of(
        `${creates}\nconst { ${holderNames.map((name, index) => `${name}: taken${index}`).join(", ")} } = mine;\nconsole.log(${reads}, mine["file"], taken0);`,
      );
      expect({ exitCode: use.exitCode, first: use.lines[0], members: holderMembers(use) }).toEqual({
        exitCode: 0,
        first: closed.first,
        members: [],
      });
    },
  );

  test.each([
    [
      "a template with unknown substitutions",
      "function read(one: string, other: string) { return input[`${one}Locale${other}`]; }\nconsole.log(read(input.one, input.other));",
    ],
    [
      "a computed key in a pattern that is assigned to",
      `function read(key: string) { let value; ({ [key]: value } = input); return value; }\nconsole.log(read(input.name));`,
    ],
  ])("any member may be used with %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: true, every: true });
  });

  test.each([
    [
      "through super in a class that extends it",
      `class Child extends ({}.constructor as any) {\n  static take(from: unknown, name: string) {\n    return (super.getOwnPropertyDescriptor as any)(from, name);\n  }\n}\nconsole.log(Child.take(input, input.name).value);`,
    ],
  ])(
    "Object can be reached without its name: any member may be used with the function that returns a descriptor, %s",
    async (_, text) => {
      expect((await members(text)).every).toBe(true);
    },
  );

  test.each([
    [
      "a store under a parameter that only literals reach",
      `function store(key: string) { input[key] = 1; }\nstore("a");`,
    ],
    [
      "a key of a class of the program's own",
      `class Point { x = 1; y = 2; }\nfunction read(point: Point, key: keyof Point) { return point[key] === 1; }\nconsole.log(read(new Point(), "x"));`,
    ],
  ])("no other member is used with %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: false, every: false });
  });
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
group("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    [
      "the report is open with createRequire, called at once",
      'import { createRequire } from "node:module";\nconsole.log(typeof createRequire((import.meta as any).url)("node:path").join);',
    ],
    ["the report is open with import() of bun:main", 'try { await import("bun:main"); } catch {}\nexport {};'],
    [
      "the base of a class leaves the report closed, and any member of the holder may be used",
      'class Text extends String { compare() { return super.localeCompare("a"); } }\nconsole.log(new Text().compare());',
    ],
    [
      "a computed member of super leaves the report closed, and any member of the holder may be used",
      "declare const input: any;\nclass Text extends String { read(key: string) { return (super[key as any] as any); } }\nconsole.log(new Text().read(input.name));",
    ],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test("the report is open with module.require of one of two literals", async () => {
    const use = await of('console.log(module.require(process.argv[2] ? "node:vm" : "node:path"));');
    const loaded = ["module node:path", "module node:vm"];
    expect({ ...completeness(use), loaded: use.lines.filter(line => loaded.includes(line)) }).toEqual({
      ...closed,
      loaded,
    });
  });
});

/** Every `parts`-th group, from the `part`-th on. */
export function runtimeUseTests(part: number, parts: number) {
  groups.forEach(([name, body], index) => {
    if (index % parts === part - 1) (unsupported ? describe.skip : describe.concurrent)(name, body);
  });
}
