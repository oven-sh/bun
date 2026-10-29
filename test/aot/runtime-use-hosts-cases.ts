import { describe, expect, test } from "bun:test";
import { accountsFor, closed, completeness, everyMemberOf, retainsFeature, type Use } from "./runtime-use-expectations";
import { unsupported } from "./harness/compiler";
import { declared, of, runtimeUse } from "./runtime-use-harness";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);

const me = `function (this: any) { return this; }`;
const classesOfIntl = [
  "Collator",
  "DateTimeFormat",
  "DisplayNames",
  "DurationFormat",
  "ListFormat",
  "Locale",
  "NumberFormat",
  "PluralRules",
  "RelativeTimeFormat",
  "Segmenter",
];
const listsEveryMember = (use: Use, holder: string) =>
  use.lines.includes(everyMemberOf(holder)) ||
  (holder === "Intl" && classesOfIntl.every(name => use.lines.includes(`Intl ${name}`)));
const usesEveryInstanceMember = (use: Use) => use.lines.includes("property toTemporalInstant");

group("a computed name on the global object, process and Bun", () => {
  const key = `const key: string = process.argv[2];\nconst root: any = globalThis;\n`;

  test("the header of a library that exports to the global object brings no built-in module", async () => {
    const use = await runtimeUse(
      {
        "main.cjs": `var assign;
(function (factory) {
  var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : {};
  factory(createExporter(root, createExporter(module.exports)));
  function createExporter(exports, previous) {
    if (exports !== root) Object.defineProperty(exports, "__esModule", { value: true });
    return function (id, v) { return exports[id] = previous ? previous(id, v) : v; };
  }
})(function (exporter) {
  assign = function (a) { return a; };
  exporter("assign", assign);
});
console.log(typeof module.exports.assign);`,
      },
      undefined,
      "main.cjs",
    );
    expect({ ...completeness(use), bringsModules: use.lines.includes("module node:zlib") }).toEqual({
      ...closed,
      bringsModules: false,
    });
  });
});

group("process and its listeners", () => {
  const reads = `console.log(typeof this.report);`;

  test.each([
    [
      "of an arrow function",
      `const listen = () => process.on("exit", () => {});\nconsole.log(typeof listen().report);`,
    ],
  ])("what on() returns is process: the result %s", async (_, text) => {
    expect(accountsFor(await of(text), "process report")).toBe(true);
  });
});

group("a function of the program's own on a holder", () => {
  const seen = `const seen = ${me};\n`;

  test.each([
    [
      "a member of a holder that a pattern reads from",
      `const [first] = [(globalThis as any).mine];\nconsole.log(first);`,
    ],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("operators that pass a holder to code of the program's own", () => {
  const has = (member: string) =>
    `class Has { static [Symbol.hasInstance](value: any) { return value.${member} !== undefined; } }\n`;

  test.each([
    [
      "an alias of the global object on the left of instanceof",
      has("HTMLRewriter") + `const scope: any = globalThis;\nconsole.log(scope instanceof Has);`,
      "global HTMLRewriter",
    ],
    [
      "process compared loosely with a number",
      `process.valueOf = function (this: any) { return typeof this.report; };\nconsole.log(process == 1);`,
      "process report",
    ],
  ])("%s", async (_, text, line) => {
    expect(accountsFor(await of(text), line)).toBe(true);
  });
});

group("members of performance", () => {
  const members = async (text: string, declarations = `declare const performance: any;\n`) => {
    const use = await of(declarations + text);
    return {
      ...completeness(use),
      mark: use.lines.includes("property mark"),
      every: listsEveryMember(use, "Performance.prototype"),
    };
  };

  test("node:perf_hooks exports the object, and a call on it is no use of every member", async () => {
    const use = await runtimeUse({
      "main.ts": `import { performance as timeline } from "node:perf_hooks";\ntimeline.mark("a", { detail: { deep: 1 } });`,
    });
    expect({ ...completeness(use), every: listsEveryMember(use, "Performance.prototype") }).toEqual({
      ...closed,
      every: false,
    });
  });
});

group("members of Intl", () => {
  let plainReport: Promise<Use> | undefined;
  const named = (use: Use, names: string[]) => ({
    ...completeness(use),
    global: use.lines.includes("global Intl"),
    named: names.filter(name => use.lines.includes("Intl " + name)),
  });

  test.each([["new", `new Intl.Segmenter("en");`, ["Segmenter"]]])(
    "a member is named by %s",
    async (_, text, names) => {
      const use = await of(text);
      expect({ ...named(use, names), every: listsEveryMember(use, "Intl") }).toEqual({
        ...closed,
        global: true,
        named: names,
        every: false,
      });
    },
  );

  test.each([["a key is computed", `new (Intl as any)[process.argv[2]]();`]])(
    "any member may be used, and the report stays closed, when %s",
    async (_, text) => {
      const use = await of(text);
      expect({ ...completeness(use), every: listsEveryMember(use, "Intl") }).toEqual({ ...closed, every: true });
    },
  );
});

group("Bun.serve", () => {
  const fetch = `fetch() { return new Response("served"); }`;
  const serves = async (files: Record<string, string>) => {
    const use = await runtimeUse(
      Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, declared + `declare const Response: any;\n` + text]),
      ),
    );
    return {
      ...completeness(use),
      named: use.lines.includes("Bun serve"),
      retained: retainsFeature(use.lines, "Serve"),
    };
  };
  const bundles = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declared + `declare const Response: any;\n` + text });
    return retainsFeature(use.lines, "Bundler");
  };

  test.each([["a tag", "Bun.serve`options`;"]])("is listed and retained with %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toEqual({ ...closed, named: true, retained: true });
  });

  test.each([
    ["a computed name", `Bun.serve({ [process.argv[2]]: {}, ${fetch} });`],
    ["a spread of an unknown value", `Bun.serve({ ...JSON.parse(process.argv[2]), ${fetch} });`],
  ])("its options make no difference: %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toEqual({ ...closed, named: true, retained: true });
  });

  test("is listed where another file exports it again under another name", async () => {
    expect(
      await serves({
        "main.ts": `import { listen } from "./other";\nlisten({ fetch: () => new Response("") });`,
        "other.ts": `export { serve as listen } from "bun";`,
      }),
    ).toEqual({ ...closed, named: true, retained: true });
  });
});

group("other names for Bun and process", () => {
  const used = async (files: Record<string, string>) => {
    const use = await runtimeUse(
      Object.fromEntries(Object.entries(files).map(([path, text]) => [path, declared + text])),
    );
    return {
      ...completeness(use),
      color: use.lines.includes("Bun color"),
      report: use.lines.includes("process report"),
      mayPaint: accountsFor(use, "Bun color"),
      mayReport: accountsFor(use, "process report"),
    };
  };
  const paints = `console.log(B.color("red", "hex"));`;

  test.each([
    ["default of the namespace", `import * as p from "node:process";\nconsole.log(typeof p.default.report.getReport);`],
  ])("a member of process is listed through %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toEqual({
      ...closed,
      color: false,
      report: true,
      mayPaint: false,
      mayReport: true,
    });
  });

  test.each([
    [
      "an import of a member of it is exported under another name",
      `import { color as paint } from "bun";\nexport { paint as paintIt };`,
      `import * as other from "./other";\nconsole.log(other.paintIt("red", "hex"));`,
    ],
  ])("what is called on Bun is accounted for when %s", async (_, other, main) => {
    expect(await used({ "main.ts": main, "other.ts": other })).toMatchObject({ mayPaint: true });
  });

  test.each([["an import of mainModule", `import { mainModule } from "node:process";\nconsole.log(mainModule);`]])(
    "nothing is loaded, so the report stays closed with %s",
    async (_, text) => {
      expect(await used({ "main.ts": text })).toMatchObject(closed);
    },
  );

  test.each([
    ["default of another module", `import * as other from "./other";\nconsole.log((other as any).default.color);`],
    ["an export of another import", `import { join } from "node:path";\nexport { join as color };`],
    ["await import() of another module", `console.log(((await import("node:path")) as any).color);\nexport {};`],
    [
      "import name = require of another module",
      `import path = require("node:path");\nconsole.log((path as any).color);`,
    ],
  ])("a member of Bun is not listed through %s", async (_, text) => {
    expect(await used({ "main.ts": text, "other.ts": `export default { color: 1 };` })).toEqual({
      ...closed,
      color: false,
      report: false,
      mayPaint: false,
      mayReport: false,
    });
  });
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
group("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    [
      "the report says what can be reached with the global object, to a function that defines a getter on it",
      'function define(scope: any) { Object.defineProperty(scope, "mine", { get() { return this; } }); }\ndefine(globalThis);',
    ],
    [
      "the report says what can be reached with a descriptor with a getter, defined on process",
      'Object.defineProperty(process, "mine", { get value() { return 1; } });',
    ],
    ["Bun in a sum", "Bun.valueOf = function (this: any) { return typeof this.color; };\nconsole.log(Bun + 1);"],
    [
      "any member may be used, and the report stays closed, when a class of it is the base of a class",
      "class Mine extends Intl.PluralRules {}\nnew Mine();",
    ],
    [
      "what is called on Bun is accounted for when import name = require is exported",
      'export import B = require("bun");',
    ],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

/** Every `parts`-th group, from the `part`-th on. */
export function runtimeUseOfHostsTests(part: number, parts: number) {
  groups.forEach(([name, body], index) => {
    if (index % parts === part - 1) (unsupported ? describe.skip : describe.concurrent)(name, body);
  });
}
