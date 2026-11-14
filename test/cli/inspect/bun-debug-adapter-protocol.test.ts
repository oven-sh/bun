// packages/bun-debug-adapter-protocol is the debugger of Bun's VS Code extension. It translates the
// lines of a breakpoint, and of the place where the program is paused, with the source map that bun
// adds to each script under the inspector.
//
// bun-debug-adapter-protocol-maps.json holds what two versions of bun report for
// bun-debug-adapter-protocol-fixture.ts (`Debugger.getScriptSource`): the extension runs with the
// bun that the user has. Bun 1.4.4 maps a statement after its `export` keyword, bun 1.4.3 at it.
// Both start each generated line that does not begin with a mapping with a copy of the mapping
// before it. Each map holds the program as it was when the map was made.
// bun-debug-adapter-protocol-capture.ts adds the report of another bun.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import {
  getRandomId,
  WebSocketDebugAdapter,
} from "../../../packages/bun-debug-adapter-protocol/src/debugger/adapter.ts";
import { TCPSocketSignal } from "../../../packages/bun-debug-adapter-protocol/src/debugger/signal.ts";
import { SourceMap } from "../../../packages/bun-debug-adapter-protocol/src/debugger/sourcemap.ts";
import { cases } from "../../js/bun/sourcemap/source-positions-corpus";
import captures from "./bun-debug-adapter-protocol-maps.json";

const fixture = join(import.meta.dir, "bun-debug-adapter-protocol-fixture.ts");

function toUrl(map: object): string {
  return "data:application/json;base64," + Buffer.from(JSON.stringify(map)).toString("base64");
}

/** The 0-based number of the only line that contains the text. */
function lineOf(lines: string[], text: string): number {
  return only(lines, text, line => line.includes(text));
}

/** The 0-based number of the only line that is the text. */
function lineIs(lines: string[], text: string): number {
  return only(lines, text, line => line === text);
}

function only(lines: string[], text: string, matches: (line: string) => boolean): number {
  const found = lines.flatMap((line, i) => (matches(line) ? [i] : []));
  if (found.length !== 1) {
    throw new Error(`${found.length} lines match ${JSON.stringify(text)}`);
  }
  return found[0];
}

describe.each(["bun-1.4.3", "bun-1.4.4"] as const)("the map of %s", name => {
  const sourceMap = SourceMap(toUrl(captures[name].map));
  const original = captures[name].map.sourcesContent[0].split("\n");
  const generated = captures[name].generated.split("\n");

  /** Where a breakpoint on an original line goes: the generated line, and the column in it. */
  function breakpoint(text: string, column?: number) {
    const location = sourceMap.generatedLocation({ line: lineOf(original, text), column });
    return { ...location, line: generated[location.line] };
  }

  /** The original line that a place in a generated line is reported on. */
  function reported(text: string, column: number) {
    const location = sourceMap.originalLocation({ line: lineIs(generated, text), column });
    return { ...location, line: original[location.line] };
  }

  test.each([
    ["a method after another method", "reset(): void {", "  reset() {", 0],
    ["the first method after the constructor", "increment(): number {", "  increment() {", 0],
    ["a statement after an arrow function", "add(0);", "  add(0);", 0],
    ["a statement after a callback", "// after the callback", "    return this.count;", 0],
    // The brace has no mapping. JSC moves the breakpoint forward to it.
    ["the last line of a callback", "// callback ends", "    });", 0],
    ["continue", "// continue", "      continue;", 0],
    ["a constructor", "constructor(", "  constructor(step, count) {", 0],
    ["the statement after parameter properties", "// after the parameter properties", "    this.reset();", 0],
    ["an enum", "enum Mode {", "var Mode;", 0],
    ["a member of an enum", "Idle,", '  Mode[Mode["Idle"] = 0] = "Idle";', 0],
    [
      "an exported function after another function",
      "export function describe",
      "export function describe(values) {",
      0,
    ],
    // The code before it on its generated line answers for a line that continues a statement.
    ["the line after return (", "// after return (", '  return "value " + value;', 2],
    // A parameter property is also a class field, which is printed first and where nothing can pause.
    ["the first parameter property", "// first parameter property", "  constructor(step, count) {", 13],
    // The first generated line starts with code of the runtime.
    [
      "the statement behind the code of the runtime",
      "class Counter {",
      "var {require}=import.meta;class Counter {",
      26,
    ],
  ])("a breakpoint on %s goes to the generated line of its code", (_, text, line, column) => {
    expect(breakpoint(text)).toEqual({ line, column, verified: true });
  });

  test("a breakpoint on a line without code goes to the code after the line before it", () => {
    const blank = { line: lineOf(original, "// a comment") - 1 };
    expect(original[blank.line]).toBe("");
    expect(sourceMap.generatedLocation(blank)).toEqual({
      line: lineOf(generated, "  return labels;"),
      column: 0,
      verified: true,
    });
    expect(breakpoint("// a comment")).toEqual({ line: "  return labels;", column: 0, verified: true });

    // A closing brace has no mapping. The line after the last statement of the function holds it.
    expect(sourceMap.generatedLocation({ line: lineOf(original, "// describe ends") })).toEqual({
      line: lineOf(generated, "  return labels;") + 1,
      column: 0,
      verified: true,
    });
    expect(sourceMap.generatedLocation({ line: lineOf(original, "// increment ends") })).toEqual({
      line: lineOf(generated, "    return this.count;") + 1,
      column: 0,
      verified: true,
    });
  });

  test("a breakpoint with a column goes to the token at the column", () => {
    const line = "    add(value);";
    expect(breakpoint("add(value);", 10)).toEqual({ line, column: 8, verified: true });
    // The last token of a generated line has a copy at the start of the next generated line.
    expect(breakpoint("add(value);", 13)).toEqual({ line, column: 13, verified: true });
  });

  test("a breakpoint before the first code of the file is not translated", () => {
    expect(sourceMap.generatedLocation({ line: 0 })).toEqual({ line: 0, column: 0, verified: false });
  });

  test("a map with one source is the map of the script, whatever the url of the script", () => {
    expect(sourceMap.generatedLocation({ line: lineOf(original, "add(0);"), url: "/another/name.ts" })).toEqual({
      line: lineOf(generated, "  add(0);"),
      column: 0,
      verified: true,
    });
  });

  test.each([
    ["a statement", "    this.count = 0;", 4, "    this.count = 0;", 4],
    ["a token after the first one of a line", "    add(value);", 9, "    add(value);", 8],
    // JSC reports the end of a function one column after its brace.
    ["the end of a callback", "    });", 5, "    }); // callback ends", 5],
    [
      "the export of a function",
      "export function describe(values) {",
      0,
      "export function describe(values: number[]): string[] {",
      7,
    ],
    ["the code of the runtime", "var {require}=import.meta;class Counter {", 0, "class Counter {", 0],
    // The name in the last line of an enum maps to the first line of the enum.
    ["the end of an enum", "})(Mode ||= {});", 0, "  Busy,", 2],
  ])("a pause at %s is reported on its line", (_, text, column, line, originalColumn) => {
    expect(reported(text, column)).toEqual({ line, column: originalColumn, verified: true });
  });

  // The brace that ends a function has no mapping. JSC moves a breakpoint to it.
  test.each([
    ["a callback", "    });", 4, "    }); // callback ends"],
    // These braces are one line before the first token after them.
    ["a callback before an argument", "}, 1);", 0, "  1, // argument after the callback"],
    ["a callback without braces", "}, 2);", 0, "  2, // argument after the callback without braces"],
    ["a callback before a parenthesis", "});", 0, "); // parenthesis after the callback"],
  ])("a breakpoint at the brace of %s is reported on the line of the first token after it", (_, text, column, line) => {
    expect(reported(text, column)).toMatchObject({ line, verified: true });
  });

  test("a pause at a brace on a line of its own is reported on the line of the code before it", () => {
    const brace = lineOf(generated, "    return this.count;") + 1;
    expect(generated[brace]).toBe("  }");
    expect(sourceMap.originalLocation({ line: brace, column: 2 })).toMatchObject({
      line: lineOf(original, "// after the callback"),
      verified: true,
    });
    // After the last code of the file.
    expect(sourceMap.originalLocation({ line: generated.length - 1, column: 0 })).toMatchObject({
      line: lineOf(original, "console.log("),
      verified: true,
    });
  });
});

test("a map without copies at the start of its lines (esbuild)", () => {
  const code = readFileSync(
    join(import.meta.dir, "../../../packages/bun-debug-adapter-protocol/src/debugger/fixtures/with-sourcemap.js"),
    "utf8",
  );
  const sourceMap = SourceMap(code.slice(code.indexOf("data:")).trim());
  expect(sourceMap.generatedLocation({ line: 3 })).toEqual({ line: 4, column: 0, verified: true });
  expect(sourceMap.generatedLocation({ line: 27 })).toEqual({ line: 20, column: 0, verified: true });
  expect(sourceMap.originalLocation({ line: 32 })).toEqual({ line: 43, column: 4, verified: true });
  expect(sourceMap.originalLocation({ line: 13 })).toEqual({ line: 13, column: 6, verified: true });
});

test("a script without a map", () => {
  const sourceMap = SourceMap();
  expect(sourceMap.generatedLocation({ line: 7, column: 2 })).toEqual({ line: 7, column: 2, verified: true });
  expect(sourceMap.originalLocation({ line: 11 })).toEqual({ line: 11, column: 0, verified: true });
});

describe("mappings", () => {
  test("the first token of a generated line answers for the start of the line", () => {
    // Column 4 of each generated line is column 4 of a line of the source.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "IAAI;IACA" }));
    expect(sourceMap.generatedLocation({ line: 0 })).toEqual({ line: 0, column: 0, verified: true });
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: true });
    expect(sourceMap.originalLocation({ line: 0, column: 2 })).toEqual({ line: 0, column: 4, verified: true });
    expect(sourceMap.originalLocation({ line: 1, column: 2 })).toEqual({ line: 1, column: 4, verified: true });
  });

  test("the code before a line does not answer when the printer moved it after the line", () => {
    // Column 2 of the second generated line is line 1 of the source, column 6 is line 0.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: ";EACI,IADJ" }));
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: true });

    // Column 6 of line 1 of the source is the first generated line, column 2 of line 1 the second.
    // Line 0 is the third.
    const before = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "IACM;EAAJ;AADF" }));
    expect(before.generatedLocation({ line: 1 })).toEqual({ line: 0, column: 0, verified: true });
  });

  test.each([
    // Line 1 of the source is column 4 of the first generated line and column 2 of the third.
    ["a token that is also printed before it", "IACE;AADF;EACE"],
    // Column 2 of line 1 is in the first generated line, column 6 of line 1 in the third.
    ["another token of the line, when its first token is printed before it", "IACE;AADF;EACM"],
  ])("the code of a line starts after the code before it: at %s", (_, mappings) => {
    // The second generated line is line 0 of the source.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings }));
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 2, column: 0, verified: true });
  });

  test("the code of a line does not start at a token that is printed again with the line", () => {
    // The first generated line is line 0 of the source. Column 14 of line 1 is in the second generated
    // line and in the third, after column 2 of line 1: a parameter property, and the constructor.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "AAAA;EACc;EAAZ,YAAY" }));
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 2, column: 0, verified: true });
  });

  test.each([
    // Line 1 of the source is the second generated line and column 4 of the third, after line 2.
    ["a token that is printed again after code of another line", "AAAA;AACM;AACN,IADM"],
    // Column 8 of line 1 is the second generated line. The third starts with a copy of it, and
    // has column 2 of line 1: the key and the decorator of a class member.
    ["a token that is not the first of its line", "AAAA;AACQ;AAAA,EAAN"],
    // Column 4 of line 1 is column 2 of the second generated line and of the third.
    ["the first token of its line, which is printed again", "AAAA;EACI;EAAA"],
  ])("the code of a line starts at %s", (_, mappings) => {
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings }));
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: true });
  });

  test("a place before the first code is not translated", () => {
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: ";;AAAA" }));
    expect(sourceMap.originalLocation({ line: 0, column: 3 })).toEqual({ line: 0, column: 3, verified: false });
  });

  describe("with two sources", () => {
    // The first generated line is line 0 of a.ts, the second is line 2 of b.ts.
    const map = { version: 3, sources: ["a.ts", "b.ts"], mappings: "AAAA;ACEA" };

    test("the url selects the source", () => {
      const sourceMap = SourceMap(toUrl(map));
      expect(sourceMap.generatedLocation({ line: 0, url: "/app/a.ts" })).toEqual({
        line: 0,
        column: 0,
        verified: true,
      });
      expect(sourceMap.generatedLocation({ line: 2, url: "/app/b.ts" })).toEqual({
        line: 1,
        column: 0,
        verified: true,
      });
      expect(sourceMap.generatedLocation({ line: 2 })).toEqual({ line: 0, column: 0, verified: true });
      expect(sourceMap.generatedLocation({ line: 2, url: "/app/c.ts" })).toEqual({
        line: 2,
        column: 0,
        verified: false,
      });
      // The code before line 2 of b.ts is a.ts.
      expect(sourceMap.generatedLocation({ line: 1, url: "/app/b.ts" })).toEqual({
        line: 1,
        column: 0,
        verified: false,
      });
    });

    test.each([
      ["src", ["a.ts", "b.ts"], "/app/src/b.ts", "/app/b.ts"],
      ["src/", ["a.ts", "b.ts"], "/app/src/b.ts", "/app/b.ts"],
      ["src", ["/a.ts", "/b.ts"], "/app/src/b.ts", "/app/b.ts"],
      // Also when the source starts with it, or is absolute and not in it.
      ["app", ["app/a.ts", "app/b.ts"], "/app/app/b.ts", "/lib/app/b.ts"],
      ["/app", ["/lib/a.ts", "/lib/b.ts"], "/app/lib/b.ts", "/lib/b.ts"],
      // A URL can be without a scheme.
      ["//cdn.test/lib", ["a.ts", "b.ts"], "//cdn.test/lib/b.ts", "/cdn.test/lib/b.ts"],
    ])("sourceRoot %j is in front of the sources %j", (sourceRoot, sources, url, other) => {
      const sourceMap = SourceMap(toUrl({ ...map, sourceRoot, sources }));
      expect(sourceMap.generatedLocation({ line: 2, url })).toEqual({ line: 1, column: 0, verified: true });
      expect(sourceMap.generatedLocation({ line: 2, url: other })).toEqual({ line: 2, column: 0, verified: false });
    });

    test.each([
      [undefined, ["./a.ts", "./b.ts"], "/app/b.ts"],
      [undefined, ["lib/../a.ts", "lib/../b.ts"], "/app/b.ts"],
      [".", ["a.ts", "b.ts"], "/app/b.ts"],
      ["/app", ["/app/a.ts", "/app/b.ts"], "/app/b.ts"],
      ["/app/", ["/app/a.ts", "/app/b.ts"], "/app/b.ts"],
      ["/app/.", ["/app/a.ts", "/app/b.ts"], "/app/b.ts"],
      ["/app/src", ["/app/lib/a.ts", "/app/lib/b.ts"], "/app/lib/b.ts"],
      ["/app/../lib", ["/lib/a.ts", "/lib/b.ts"], "/lib/b.ts"],
      ["/", ["a.ts", "b.ts"], "/b.ts"],
      ["/", ["/lib/a.ts", "/lib/b.ts"], "/lib/b.ts"],
      [undefined, ["https://example.test/a.ts", "https://example.test/./b.ts"], "https://example.test/b.ts"],
      ["https://example.test/lib", ["../a.ts", "../b.ts"], "https://example.test/b.ts"],
      ["https://example.test", ["https://example.test/a.ts", "https://example.test/b.ts"], "https://example.test/b.ts"],
      ["https://example.test", ["a.ts", "b.ts"], "https://example.test/b.ts"],
      // Not as in source-map-js, which puts the sourceRoot in front of the URL of another host.
      ["https://example.test", ["https://other.test/a.ts", "https://other.test/b.ts"], "https://other.test/b.ts"],
    ])("with sourceRoot %j, the sources %j have the names of the files that they are", (sourceRoot, sources, url) => {
      const sourceMap = SourceMap(toUrl({ ...map, sourceRoot, sources }));
      expect(sourceMap.generatedLocation({ line: 2, url })).toEqual({ line: 1, column: 0, verified: true });
    });

    test("the first token of a line answers for the code before it when the line before is another source", () => {
      // The first generated line is line 5 of a.ts. Column 4 of the second is line 0 of b.ts.
      const sourceMap = SourceMap(toUrl({ ...map, mappings: "AAKA;ICLA" }));
      expect(sourceMap.originalLocation({ line: 1, column: 0 })).toEqual({ line: 0, column: 0, verified: true });

      // Line 0 of b.ts is also at the start of the first generated line, before line 5 of a.ts.
      const twice = SourceMap(toUrl({ ...map, mappings: "ACAA,IDKA;AAAA,ICLA" }));
      expect(twice.originalLocation({ line: 1, column: 0 })).toEqual({ line: 0, column: 0, verified: true });
    });

    test("the code of a line is code of its source", () => {
      // Column 4 of line 0 of b.ts is the first generated line. The same place of a.ts is the second.
      const first = SourceMap(toUrl({ ...map, mappings: "ICAI;IDAA" }));
      expect(first.generatedLocation({ line: 0, url: "/app/a.ts" })).toEqual({ line: 1, column: 0, verified: true });

      // Column 4 of line 0 of a.ts is the first and the third generated line. Column 2 of line 0 of b.ts is the second.
      const twice = SourceMap(toUrl({ ...map, mappings: "IAAI;ECAF;IDAE" }));
      expect(twice.generatedLocation({ line: 0, url: "/app/a.ts" })).toEqual({ line: 0, column: 0, verified: true });
    });
  });

  test("a map without mappings translates nothing", () => {
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "" }));
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: false });
    expect(sourceMap.originalLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: false });
  });

  test("the first token of a line answers for the copy at the start of the line", () => {
    // The second generated line starts at column 0 with the source, line and column of the segment before it.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "AAAA;AAAA,IAAI" }));
    expect(sourceMap.originalLocation({ line: 1, column: 2 })).toEqual({ line: 0, column: 4, verified: true });
  });

  test("the first token of a line answers for the code before it when it maps back and is printed once", () => {
    // Column 7 of the first generated line is line 2 of the source: a class that the runtime moved up.
    // The second generated line starts with a copy. Its column 7 is line 0: the statement before the class.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "OAEO;AAAA,OAFA" }));
    expect(sourceMap.originalLocation({ line: 1, column: 0 })).toEqual({ line: 0, column: 7, verified: true });
  });

  test("the first token of a line answers for the code before it when it is printed again and maps forward", () => {
    // Line 2 of the source is the first generated line, and column 4 of the third, after a copy of
    // line 1: the closing tag of a JSX element.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "AAEA;AADA;AAAA,IACA" }));
    expect(sourceMap.originalLocation({ line: 2, column: 0 })).toEqual({ line: 2, column: 0, verified: true });
  });

  test.each([
    ["is not at column 0", "AAAA;EAAA,IAAI", { line: 0, column: 0 }],
    ["is another line of the source", "AAAA;AACA,IAAI", { line: 1, column: 0 }],
    ["is another column of the source", "AAAA;AAAE,IAAE", { line: 0, column: 2 }],
    ["is another source", "AAAA;ACAA,IAAI", { line: 0, column: 0 }],
    ["is in the generated line of the segment before it", ";AAAA,AAAA,IAAI", { line: 0, column: 0 }],
  ])("a segment that %s is not a copy", (_, mappings, position) => {
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts", "b.ts"], mappings }));
    expect(sourceMap.originalLocation({ line: 1, column: 2 })).toEqual({ ...position, verified: true });
  });

  test("a segment without a source ends the code of the segment before it", () => {
    // Generated columns 0, 4 and 8. The second has no source, the others are columns 0 and 8 of the source.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings: "AAAA,I,IAAQ" }));
    expect(sourceMap.originalLocation({ line: 0, column: 3 })).toEqual({ line: 0, column: 0, verified: true });
    expect(sourceMap.originalLocation({ line: 0, column: 5 })).toEqual({ line: 0, column: 5, verified: false });
    expect(sourceMap.originalLocation({ line: 0, column: 9 })).toEqual({ line: 0, column: 8, verified: true });
    expect(sourceMap.generatedLocation({ line: 0, column: 8 })).toEqual({ line: 0, column: 8, verified: true });

    // Two lines that start without a source, then column 4 of the second one with a source.
    const lines = SourceMap(toUrl({ version: 3, sources: ["a.ts", "b.ts"], mappings: "A;A,IAAA" }));
    expect(lines.originalLocation({ line: 1, column: 2 })).toEqual({ line: 1, column: 2, verified: false });
    expect(lines.generatedLocation({ line: 0, url: "/app/c.ts" })).toEqual({ line: 0, column: 0, verified: false });
  });

  test("the segments of a line can be in any order, and can have a name", () => {
    // Generated columns 4, 2 and 6 are columns 4, 0 and 6 of the source. The last has a name.
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], names: ["a"], mappings: "IAAI,FAAJ,IAAMA" }));
    expect(sourceMap.originalLocation({ line: 0, column: 5 })).toEqual({ line: 0, column: 4, verified: true });
    expect(sourceMap.originalLocation({ line: 0, column: 7 })).toEqual({ line: 0, column: 6, verified: true });
    expect(sourceMap.generatedLocation({ line: 0, column: 6 })).toEqual({ line: 0, column: 6, verified: true });
  });

  test.each([
    [512, "ggB", "hgB"],
    [16383, "+/f", "//f"],
    [16384, "gggB", "hggB"],
    [524287, "+//f", "///f"],
  ])("a number of %d has more than two digits", (number, plus, minus) => {
    // Column `number` of the first generated line is line `number`, column `number` of the source.
    // Column 0 of the second is line 0, column 0.
    const mappings = `${plus}A${plus}${plus};AA${minus}${minus}`;
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings }));
    expect(sourceMap.originalLocation({ line: 0, column: number })).toEqual({
      line: number,
      column: number,
      verified: true,
    });
    expect(sourceMap.originalLocation({ line: 1, column: 0 })).toEqual({ line: 0, column: 0, verified: true });
    expect(sourceMap.generatedLocation({ line: number, column: number })).toEqual({
      line: 0,
      column: number,
      verified: true,
    });
  });

  test.each(["AAAA,!", "AA", "AAAAg"])("mappings %j are read at the first lookup, and are not valid", mappings => {
    using warn = spyOn(console, "warn");
    const sourceMap = SourceMap(toUrl({ version: 3, sources: ["a.ts"], mappings }));
    expect(warn).not.toHaveBeenCalled();
    const location = { line: 0, column: 0, verified: false, message: "Invalid mappings in source map" };
    expect(sourceMap.generatedLocation({ line: 0 })).toEqual(location);
    expect(sourceMap.originalLocation({ line: 0 })).toEqual(location);
  });

  test.each([
    ["of version 2", { version: 2, sources: ["a.ts"], mappings: "AAAA;AACA" }],
    ["without sources", { version: 3, mappings: "AAAA;AACA" }],
    ["without mappings", { version: 3, sources: ["a.ts"] }],
  ])("a map %s is not used", (_, map) => {
    using warn = spyOn(console, "warn").mockImplementation(() => {});
    const sourceMap = SourceMap(toUrl(map));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sourceMap.generatedLocation({ line: 1 })).toEqual({ line: 1, column: 0, verified: true });
  });
});

const program = readFileSync(fixture, "utf8").split(/\r?\n/);

type Breakpoint = { verified: boolean; line?: number; message?: string };
type Request = { line: number; column?: number; hitCondition?: string };

const pick = ({ verified, line, message }: Breakpoint) => ({ verified, line, message });

// A test that ends at its timeout does not close its adapter, and the program waits for a debugger.
const adapters: WebSocketDebugAdapter[] = [];
afterAll(() => {
  for (const adapter of adapters) {
    adapter.close();
  }
});

/**
 * Debugs a program with the requests of VS Code, in the order in which it sends them. The lines
 * are the breakpoints of the program when it starts.
 */
async function debug(lines: number[], program = fixture, runtimeArgs: string[] = []) {
  const adapter = new WebSocketDebugAdapter();
  adapters.push(adapter);
  let output = "";
  let failure: Error | undefined;
  let sequence = 0;
  let spawned = false;
  const responses = new Map<number, PromiseWithResolvers<any>>();
  const events: { event: string; body: any }[] = [];
  const waiting: { event: string; promise: PromiseWithResolvers<any> }[] = [];
  const printed: { text: string; promise: PromiseWithResolvers<void> }[] = [];
  const sources: string[] = [];
  const loading: { file: string; promise: PromiseWithResolvers<void> }[] = [];
  const exited = Promise.withResolvers<void>();

  function fail(error: Error) {
    failure ??= error;
    for (const { promise } of [...waiting, ...printed, ...loading]) {
      promise.reject(failure);
    }
    for (const { reject } of responses.values()) {
      reject(failure);
    }
  }

  adapter.on("Adapter.response", response => {
    const { resolve, reject } = responses.get(response.request_seq)!;
    responses.delete(response.request_seq);
    if (response.success) {
      resolve(response.body);
    } else {
      reject(new Error(`${response.command}: ${response.message}`));
    }
  });
  adapter.on("Adapter.event", ({ event, body }) => {
    if (event === "loadedSource") {
      const path = (body as { source: { path?: string } }).source.path?.replaceAll("\\", "/") ?? "";
      sources.push(path);
      for (const { file, promise } of loading) {
        if (path.endsWith(file)) {
          promise.resolve();
        }
      }
    }
    const index = waiting.findIndex(entry => entry.event === event);
    if (index === -1) {
      events.push({ event, body });
    } else {
      waiting.splice(index, 1)[0].promise.resolve(body);
    }
  });
  // The adapter sends the error of an event handler here.
  adapter.on("Adapter.error", fail);
  adapter.on("Process.spawned", () => void (spawned = true));
  adapter.on("Process.stdout", data => {
    output += data;
    for (const { text, promise } of printed) {
      if (output.includes(text)) {
        promise.resolve();
      }
    }
  });
  adapter.on("Process.stderr", data => void (output += data));
  adapter.on("Process.exited", code => {
    fail(new Error(`The program exited (${code}):\n${output}`));
    exited.resolve();
  });

  function request(command: string, args?: object): Promise<any> {
    const promise = Promise.withResolvers<any>();
    if (failure) {
      promise.reject(failure);
    } else {
      responses.set(++sequence, promise);
      adapter.emit("Adapter.request", { type: "request", seq: sequence, command, arguments: args });
    }
    return promise.promise;
  }

  /** The next event of a kind, or one that is already here. */
  function next(event: string): Promise<any> {
    const index = events.findIndex(entry => entry.event === event);
    if (index !== -1) {
      return Promise.resolve(events.splice(index, 1)[0].body);
    }
    const promise = Promise.withResolvers<any>();
    if (failure) {
      promise.reject(failure);
    } else {
      waiting.push({ event, promise });
    }
    return promise.promise;
  }

  const session = {
    request,
    /** The answer for each breakpoint, when they are the breakpoints of a file. */
    async setBreakpoints(lines: (number | Request)[], path = program): Promise<Breakpoint[]> {
      const { breakpoints } = await request("setBreakpoints", {
        source: { path },
        breakpoints: lines.map(line => (typeof line === "number" ? { line } : line)),
      });
      return breakpoints.map(pick);
    },
    /** Waits until the adapter knows the script of a file. The name ends the path of the file. */
    async loaded(file: string): Promise<void> {
      const promise = Promise.withResolvers<void>();
      if (sources.some(path => path.endsWith(file))) {
        promise.resolve();
      } else if (failure) {
        promise.reject(failure);
      } else {
        loading.push({ file, promise });
      }
      return promise.promise;
    },
    /** Waits until the program has printed a text. */
    async prints(text: string): Promise<void> {
      const promise = Promise.withResolvers<void>();
      if (output.includes(text)) {
        promise.resolve();
      } else if (failure) {
        promise.reject(failure);
      } else {
        printed.push({ text, promise });
      }
      return promise.promise;
    },
    /** The next breakpoint that the adapter reports after the script is loaded. */
    async breakpoint(): Promise<Breakpoint> {
      return pick((await next("breakpoint")).breakpoint);
    },
    /** The next place where the program is paused. */
    async stopped(): Promise<{ reason: string; name: string; line: number }> {
      const { threadId, reason } = await next("stopped");
      const { stackFrames } = await request("stackTrace", { threadId });
      return { reason, name: stackFrames[0].name, line: stackFrames[0].line };
    },
    async [Symbol.asyncDispose]() {
      adapter.close();
      if (spawned) {
        await exited.promise;
      }
    },
  };

  try {
    await request("initialize", { clientID: "vscode", adapterID: "bun", linesStartAt1: true, columnsStartAt1: true });
    await request("launch", { runtime: bunExe(), runtimeArgs, program, cwd: dirname(program), env: bunEnv });
    await next("initialized");
    if (lines.length) {
      // The script is not loaded yet. The adapter answers now, and reports each breakpoint when it is.
      await session.setBreakpoints(lines);
    }
    await request("configurationDone");
  } catch (error) {
    await session[Symbol.asyncDispose]();
    throw error;
  }
  return session;
}

describe.concurrent("a debug session", () => {
  /** The 1-based number of a line of the fixture. */
  const line = (text: string) => lineOf(program, text) + 1;
  const held = (line: number) => ({ verified: true, line, message: undefined });
  // One place in the code holds one breakpoint.
  const refused = {
    verified: false,
    line: undefined,
    message: "This line has no code to pause on, or another breakpoint is already set on the same code.",
  };

  test("a breakpoint on a method after another method pauses in the method", async () => {
    const method = line("reset(): void {");
    const statement = method + 1;

    await using session = await debug([method, statement]);
    expect([await session.breakpoint(), await session.breakpoint()]).toEqual([held(statement), refused]);
    expect(await session.stopped()).toEqual({ reason: "breakpoint", name: "reset", line: statement });

    // VS Code sends every breakpoint of the file again when one of them changes.
    expect(await session.setBreakpoints([method, statement])).toEqual([held(statement), refused]);
    // The breakpoint on the method is removed. The statement gets its place.
    expect(await session.setBreakpoints([statement])).toEqual([held(statement)]);

    // A request that is not valid keeps its answer when another request is on its line.
    expect(await session.setBreakpoints([])).toEqual([]);
    expect(
      await session.setBreakpoints([{ line: statement }, { line: statement, column: 10, hitCondition: "often" }]),
    ).toEqual([held(statement), { verified: false, line: undefined, message: "Hit condition is not a number." }]);
  });

  test("a function and its first statement are one place to pause", async () => {
    const header = line("function label(");
    const statement = header + 1;

    await using session = await debug([header, statement]);
    expect([await session.breakpoint(), await session.breakpoint()]).toEqual([held(statement), refused]);
    expect(await session.stopped()).toEqual({ reason: "breakpoint", name: "label", line: statement });
  });

  test("a breakpoint on an exported function is reported on its line", async () => {
    const exported = line("export function describe");

    await using session = await debug([exported]);
    expect(await session.breakpoint()).toEqual(held(exported));
    // JSC pauses at the export when the module runs.
    expect(await session.stopped()).toMatchObject({ line: exported });
  });

  test("the places where a paused program can pause are on their lines", async () => {
    const source = { path: fixture };
    const statement = line("reset(): void {") + 1;
    const target = line("add(0);");

    await using session = await debug([statement]);
    expect(await session.breakpoint()).toEqual(held(statement));
    expect(await session.stopped()).toMatchObject({ name: "reset", line: statement });

    const places = async (line: number) => {
      const { breakpoints } = await session.request("breakpointLocations", { source, line });
      return breakpoints.map((place: { line: number }) => place.line);
    };
    expect({
      statement: await places(target),
      afterParameterProperties: await places(line("// after the parameter properties")),
      endOfCallback: await places(line("// callback ends")),
      exportedFunction: await places(line("export function describe")),
      // A pause in a method is at its first statement.
      method: await places(line("reset(): void {")),
    }).toEqual({
      statement: [target],
      afterParameterProperties: [line("// after the parameter properties")],
      endOfCallback: [line("// callback ends")],
      exportedFunction: [line("export function describe")],
      method: [],
    });

    // Jump to Cursor.
    const { targets } = await session.request("gotoTargets", { source, line: target });
    expect(targets).toMatchObject([{ line: target }]);
    await session.request("goto", { threadId: 0, targetId: targets[0].id });
    expect(await session.stopped()).toMatchObject({ name: "describe", line: target });
  });
});

// The programs of test/js/bun/sourcemap/source-positions.test.ts, with the printer and the source
// maps of this bun.
test("a breakpoint on each line with a call in the source positions corpus is reported on that line", async () => {
  const eols = { plain: "\n", crlf: "\r\n" };
  const files: Record<string, string> = {};
  const calls: Record<string, { line: number; text: string }[]> = {};
  for (const [variant, eol] of Object.entries(eols)) {
    for (const [name, { lines }] of Object.entries(cases)) {
      // Each line of a program starts with a count of 2 characters and a separator.
      const texts = lines
        .slice(1, -1)
        .split("\n")
        .map(line => line.slice(3));
      files[`${variant}/${name}`] = texts.join(eol) + eol;
      calls[`${variant}/${name}`] = texts.flatMap((text, i) =>
        /\bat(\?\.)?\(\)/.test(text) ? [{ line: i + 1, text }] : [],
      );
    }
  }

  using dir = tempDir("debug-adapter-corpus", {
    ...files,
    "globals.cjs": `globalThis.at = globalThis.ran = globalThis.caught = () => {};\n`,
    "throws.cjs": `throw new Error("thrown while it loads");\n`,
    // The scripts of a program that has ended are gone.
    "run.ts": `
      for (const file of ${JSON.stringify(Object.keys(files))}) {
        await import("./" + file).catch(() => {});
      }
      console.log("loaded");
      setInterval(() => {}, 2 ** 30);
    `,
  });

  await using session = await debug([], join(String(dir), "run.ts"), ["--preload=./globals.cjs"]);
  await session.prints("loaded");

  const elsewhere: Record<string, Record<string, string[]>> = {};
  for (const [file, lines] of Object.entries(calls)) {
    if (!lines.length) continue;
    const [variant, name] = file.split("/");
    // The output of the program and the events of the inspector come on two channels.
    await session.loaded(`/${file}`);
    const breakpoints = await session.setBreakpoints(
      lines.map(({ line }) => line),
      join(String(dir), file),
    );
    const moved = lines.filter(({ line }, i) => !breakpoints[i].verified || breakpoints[i].line !== line);
    if (moved.length) {
      (elsewhere[variant] ??= {})[name] = moved.map(({ text }) => text.trim());
    }
  }

  // These lines continue a statement, or share the place where they pause with the line before.
  const continued = {
    "engine-functions.ts": ["? () => { at(); }"],
    "spans.ts": ["two ${at()} three", "four`; at();"],
    "elements.tsx": ["<div id={at()}>", "text {at()}", "<Component value={at()}>", "{at()}", "{at()}"],
  };
  expect(elsewhere).toEqual({ plain: continued, crlf: continued });
});

describe("the adapter", () => {
  test("only forwards inspector events from known protocol domains to the adapter", () => {
    const adapter = new WebSocketDebugAdapter();

    // Replace the launch request handler so a (wrongly) forwarded event is observable
    // without spawning any process.
    const launchCalls: unknown[][] = [];
    (adapter as any).launch = (...args: unknown[]) => {
      launchCalls.push(args);
    };

    const inspector = adapter.getInspector();

    // The WebSocket inspector re-emits any message without an "id" using the method name
    // chosen by the remote peer. An event named after a DAP request must not be forwarded
    // to the adapter, where it would be dispatched to the matching request handler.
    (inspector as any).emit("launch", {
      runtime: "/bin/sh",
      runtimeArgs: ["-c", "echo unexpected"],
      program: "example.js",
    });
    expect(launchCalls).toHaveLength(0);

    // A genuine inspector-domain event still reaches listeners registered on the adapter.
    const heapEvents: unknown[] = [];
    adapter.on("Heap.garbageCollected", event => {
      heapEvents.push(event);
    });
    (inspector as any).emit("Heap.garbageCollected", {
      collection: { type: "full", startTime: 0, endTime: 1 },
    });
    expect(heapEvents).toEqual([{ collection: { type: "full", startTime: 0, endTime: 1 } }]);
  });

  test("getRandomId returns a distinct 32-character lowercase hex string on every call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 256; i++) {
      const id = getRandomId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(256);
  });

  test("TCPSocketSignal accepts connections only on the loopback interface", async () => {
    // Same construction the VS Code extension uses (diagnostics.ts createSignal).
    const signal = new TCPSocketSignal(0);
    await signal.ready;
    const port = signal.port;

    try {
      // The legitimate local client connects over loopback and its payload is delivered.
      const received = new Promise<string>(resolve => signal.once("Signal.received", resolve));
      await new Promise<void>((resolve, reject) => {
        const client = connect({ host: "127.0.0.1", port }, () => {
          client.end("hello");
          resolve();
        });
        client.on("error", reject);
      });
      expect(await received).toBe("hello");

      // The same port is not reachable through a non-loopback interface address.
      let external: string | undefined;
      for (const addresses of Object.values(networkInterfaces())) {
        for (const { family, internal, address } of addresses ?? []) {
          if (family === "IPv4" && !internal) {
            external = address;
            break;
          }
        }
        if (external) break;
      }

      if (external) {
        const externalHost = external;
        const connectError = await new Promise<Error | null>(resolve => {
          const client = connect({ host: externalHost, port }, () => {
            client.end();
            resolve(null);
          });
          client.on("error", error => resolve(error));
        });
        expect(connectError).not.toBeNull();
      }
    } finally {
      signal.close();
    }
  });
});
