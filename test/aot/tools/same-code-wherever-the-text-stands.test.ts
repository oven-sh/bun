// Blanks, comments and empty lines are no part of a program: with them sown into every file it compiles to the same machine code, byte for byte.
// A program sees where its text stands in the positions of a stack trace and in the text of a function, and both are data beside the code.
// ./sow-blanks-and-comments.ts rewrites a program, ./same-code-wherever-the-text-stands.ts builds both and compares the code function by function.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import ts from "typescript";
import { describe, test } from "../supported";
import { storedProgram } from "./same-code-in-every-spelling";
import { compareWithSown } from "./same-code-wherever-the-text-stands";
import { sow } from "./sow-blanks-and-comments";

const programs = [
  "smoke/server-of-node-http-answers-one-request.ts",
  "smoke/async-functions-timers-and-promise-all.ts",
  "smoke/bun-serve-answers-two-requests.ts",
  "smoke/classes.ts",
  "smoke/closures.ts",
  "smoke/commonjs-modules-require-one-another",
  "smoke/es-modules-import-one-another",
  "smoke/generators.ts",
  "smoke/jsx-with-a-factory-of-its-own.tsx",
  "arrays/index-fill-grows-like-push.ts",
  "arrays/nans-computed-used-positions-pushed.cjs",
  "arrays/strings-of-tagged-template-walked.js",
  "classes-and-closures/own-accessor-hides-a-getter-and-a-setter.ts",
  "commonjs/entry-bundle-in-cjs-format-of-bun-build",
  "commonjs/at-top-of-file-first-line-says-cjs.js",
  "constructor-functions/constructor-fn-more-comment-code.js",
  "function-prototypes/new-of-value-finds-many-constructor-fn.js",
  "unexpected-values/sloppy-code-changes-text-param-back",
  "modules/require-of-a-module-with-top-level-await",
  "symbol-fields/class-it-is-printed.ts",
];

describe("a program compiles to the same code wherever its text stands", () => {
  test.concurrent.each(programs)(
    "%s",
    async program => {
      using folder = tempDir("aot-sown", {});
      expect(await compareWithSown(bunExe(), storedProgram(program, String(folder)), String(folder))).toEqual([]);
    },
    300_000,
  );
});

describe("sow-blanks-and-comments", () => {
  const printed = (text: string, path: string) =>
    ts
      .createPrinter({ removeComments: true })
      .printFile(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false));
  const everywhere = (text: string, path = "a.ts") => sow(text, path, { every: 1 });

  test.each([
    ["a.ts", "const a: number = b?.c![d] ?? (e as f)<g>(h, ...i);\nfor (const [j, { k = 1 }] of l) m: while (n--) continue m;\n"],
    ["a.js", "a = b / c / d; e = /f\\/g/u.test(h) ? `i${j}k${`l${m}`}n` : 'o' + \"p\";\nq = 1..toString() + 2.5.toFixed();\n"],
    ["a.js", "function* a() {\n  return\n  yield\n  b\n  ++c\n}\nasync () => { await d; throw e }\n"],
    ["a.ts", "@a class B<C> extends D<C> implements E {\n  static #f = 1;\n  get g(): h { return this.#i }\n  declare j?: k;\n}\n"],
    ["a.tsx", "const a = <b c={d} e='f'>  g {h} <i/> j </b>;\nconst k = <>l</>;\n"],
  ])("the program stays the same: %s %#", (path, text) => {
    const sown = everywhere(text, path);
    expect(sown).not.toBe(text);
    expect(printed(sown, path)).toBe(printed(text, path));
  }); // prettier-ignore

  test("each kind alone", () => {
    const only = (kind: "blanks" | "comments" | "lines") => sow("a = b;\nc();\n", "a.js", { every: 1, kinds: new Set([kind]) });
    expect(only("blanks").replace(/ +/g, " ")).toBe(" a = b ;\n c ( ) ;\n");
    expect(only("comments").replace(/ \/\* (sown )+\*\/ /g, "")).toBe("a = b;\nc();\n");
    expect(only("lines").replace(/(\/\/ sown)?\n/g, "\n").replace(/\n+/g, "\n")).toBe("a = b;\nc();\n");
  }); // prettier-ignore

  test("a line break is sown only where one stands", () => {
    const text = "a = () => { return b }; c\n  .d()\n";
    const lines = everywhere(text, "a.js").split("\n");
    expect(lines[0].replace(/\/\*.*?\*\//g, "").replace(/ /g, "")).toBe("a=()=>{returnb};c");
  });

  test("a comment never joins the token in front of it", () => {
    expect(printed(sow("a/b", "a.js", { every: 1, kinds: new Set(["comments"]) }), "a.js")).toBe(printed("a/b", "a.js"));
  }); // prettier-ignore

  test("what speaks of the line below it stays above that line", () => {
    const text = "// @ts-expect-error\na = 1;\n";
    expect(sow(text, "a.ts", { every: 1, kinds: new Set(["lines"]) })).toBe(text);
  });

  test("the same text is always sown alike, and one place can be sown alone", () => {
    const text = "a = b + c;\nd(e);\n";
    expect(sow(text, "a.js")).toBe(sow(text, "a.js"));
    const found: number[] = [];
    sow(text, "a.js", { every: 1, kinds: new Set(["blanks"]), places: new Set(), found });
    expect(found.length).toBeGreaterThan(1);
    const one = sow(text, "a.js", { every: 1, kinds: new Set(["blanks"]), places: new Set([1]) });
    expect(one.replace(/ +/g, " ").length).toBeGreaterThanOrEqual(text.length);
    expect(one.slice(0, found[1])).toBe(text.slice(0, found[1]));
  });
});
