import { describe, expect } from "bun:test";
import { SourceMapConsumer } from "source-map";
import { decodeSourceMappings, itBundled } from "./expectBundled";

// These tests decode the emitted source map and assert specific
// generated -> original positions, the `names` table, and the URL form of
// `sources` and `sourceMappingURL`.

/** 0-based line and column of the first occurrence of `needle` in `text`, starting at `from`. */
function position(text: string, needle: string, from = 0): { line: number; column: number; index: number } {
  const index = text.indexOf(needle, from);
  if (index === -1) throw new Error(`${JSON.stringify(needle)} not found`);
  const before = text.slice(0, index);
  const line = before.split("\n").length - 1;
  const column = index - (before.lastIndexOf("\n") + 1);
  return { line, column, index };
}

/** The original position (0-based) and name of the mapping at a 0-based generated position. */
async function originalPositionAt(
  map: any,
  generated: { line: number; column: number },
): Promise<{ source: string | null; line: number | null; column: number | null; name: string | null }> {
  return await SourceMapConsumer.with(map, null, consumer => {
    const pos = consumer.originalPositionFor({ line: generated.line + 1, column: generated.column });
    return {
      source: pos.source,
      line: pos.line === null ? null : pos.line - 1,
      column: pos.column,
      name: pos.name,
    };
  });
}

describe("bundler", () => {
  // `names`: a mapping for a renamed symbol records the original name as the
  // optional fifth VLQ field, so a debugger can show `firstArgument` for the
  // minified `n`. The original name is recorded only when it differs from the
  // printed name.
  itBundled("sourcemap/NamesForMinifiedSymbols", {
    files: {
      "/entry.js": /* js */ `
        export function fn(firstArgument) { return firstArgument * 2 }
      `,
    },
    outdir: "/out",
    sourceMap: "external",
    minifyIdentifiers: true,
    minifyWhitespace: true,
    minifySyntax: true,
    async onAfterBundle(api) {
      const source = api.readFile("/entry.js");
      const code = api.readFile("/out/entry.js");
      const map = JSON.parse(api.readFile("/out/entry.js.map"));

      expect(map.names).toEqual(["fn", "firstArgument"]);

      // `function r(n){return n*2}`
      const fnDecl = code.match(/function (\w+)\((\w+)\)\{return (\w+)\*2\}/);
      expect(fnDecl).not.toBeNull();
      const [, minifiedFn, minifiedParam] = fnDecl!;
      expect(minifiedFn).not.toBe("fn");
      expect(minifiedParam).not.toBe("firstArgument");

      const fnNameGen = position(code, minifiedFn + "(");
      expect(await originalPositionAt(map, fnNameGen)).toEqual({
        source: "../entry.js",
        ...(({ line, column }) => ({ line, column }))(position(source, "fn(")),
        name: "fn",
      });

      const paramGen = position(code, minifiedParam + ")");
      expect(await originalPositionAt(map, paramGen)).toEqual({
        source: "../entry.js",
        ...(({ line, column }) => ({ line, column }))(position(source, "firstArgument)")),
        name: "firstArgument",
      });

      const useGen = position(code, "return " + minifiedParam);
      expect(await originalPositionAt(map, { line: useGen.line, column: useGen.column + "return ".length })).toEqual({
        source: "../entry.js",
        ...(({ line, column }) => ({ line, column }))(position(source, "firstArgument * 2")),
        name: "firstArgument",
      });

      // `return` is not a symbol, so its mapping has no name.
      expect(await originalPositionAt(map, useGen)).toMatchObject({ name: null });
    },
  });

  // Each file is printed into its own source map chunk with a chunk-local
  // `names` table. The linker offsets the name indices of every chunk after
  // the first when it joins them.
  itBundled("sourcemap/NamesAcrossFiles", {
    files: {
      "/entry.js": /* js */ `
        import { helperA } from "./a.js";
        import { helperB } from "./b.js";
        export function fn(firstArgument) { return helperA(firstArgument) + helperB(firstArgument) }
      `,
      "/a.js": /* js */ `
        export function helperA(argumentA) {
          outerLoop: for (const item of argumentA) {
            for (const inner of item) if (inner) continue outerLoop;
          }
          return argumentA + 1
        }
      `,
      "/b.js": /* js */ `
        export function helperB(argumentB) { return argumentB + 2 }
      `,
    },
    outdir: "/out",
    sourceMap: "external",
    minifyIdentifiers: true,
    minifyWhitespace: true,
    minifySyntax: true,
    async onAfterBundle(api) {
      const map = JSON.parse(api.readFile("/out/entry.js.map"));
      const decoded = decodeSourceMappings(map);
      const sourceFor = (name: string) => map.sources.indexOf(`../${name}`);
      expect(map.sources).toEqual(["../a.js", "../b.js", "../entry.js"]);

      // Every named mapping resolves to a real name, and to an identifier
      // that exists in the file the mapping points at.
      const named = decoded.filter(m => m.name !== null);
      expect(named.length).toBeGreaterThanOrEqual(6);
      for (const m of named) {
        expect(m.name).not.toStartWith("<invalid");
        const file = map.sources[m.src!].replace("../", "/");
        const line = api.readFile(file).split("\n")[m.origLine!];
        expect(line.slice(m.origCol!, m.origCol! + m.name!.length)).toBe(m.name!);
      }

      const namesIn = (file: string) => new Set(named.filter(m => m.src === sourceFor(file)).map(m => m.name));
      expect(namesIn("a.js")).toEqual(new Set(["helperA", "argumentA", "outerLoop", "item", "inner"]));
      expect(namesIn("b.js")).toEqual(new Set(["helperB", "argumentB"]));
      expect(namesIn("entry.js")).toEqual(new Set(["fn", "firstArgument", "helperA", "helperB"]));
    },
  });

  // Every `}` that closes a body gets its own mapping. Without it the line of
  // the `}` maps to whatever was mapped last inside the body.
  itBundled("sourcemap/ClosingBraceMappings", {
    files: {
      "/entry.js": /* js */ `
        export function foo() {
          return {
            a: 1,
          }
        }
        export const arrow = () => {
          foo()
        }
        export class Klass {
          static {
            foo()
          }
        }
        for (let i = 0; i < 1; i++) {
          foo()
        }
        try {
          foo()
        } catch {
          foo()
        } finally {
          foo()
        }
        if (foo()) {
          foo()
        } else {
          foo()
        }
        switch (foo()) {
          case 1: {
            foo()
          }
        }
      `,
    },
    outdir: "/out",
    sourceMap: "external",
    async onAfterBundle(api) {
      const source = api.readFile("/entry.js");
      const code = api.readFile("/out/entry.js");
      const map = JSON.parse(api.readFile("/out/entry.js.map"));
      const decoded = decodeSourceMappings(map);

      // The lines that start with `}` in the source and in the output
      // correspond one to one: the printer keeps the statement order and
      // puts every closing brace at the start of a line.
      const braceLines = (text: string) =>
        text
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.trimStart().startsWith("}"))
          .map(({ line, index }) => ({ line: index, column: line.length - line.trimStart().length }));
      const sourceBraces = braceLines(source);
      const outputBraces = braceLines(code.slice(0, code.indexOf("\nexport {")));
      expect(sourceBraces).toHaveLength(13);
      expect(outputBraces).toHaveLength(sourceBraces.length);

      const actual = outputBraces.map(gen => {
        const m = decoded.find(m => m.genLine === gen.line && m.genCol === gen.column);
        return m
          ? `${gen.line}:${gen.column} -> ${m.origLine}:${m.origCol}`
          : `${gen.line}:${gen.column} -> (no mapping)`;
      });
      const expected = outputBraces.map(
        (gen, i) => `${gen.line}:${gen.column} -> ${sourceBraces[i].line}:${sourceBraces[i].column}`,
      );
      expect(actual).toEqual(expected);
    },
  });

  // A file that contributes code but no mappings (a `text` loader shim here)
  // gets a 1-field segment at the start of its code. Without it, the previous
  // file's last mapping covers the shim on a minified line.
  itBundled("sourcemap/NullSegmentAfterFileWithoutMappings", {
    files: {
      "/entry.js": /* js */ `
        import { x } from "./other.js";
        import txt from "./data.txt";
        console.log(txt, x);
      `,
      "/other.js": /* js */ `
        export const x = 1;
      `,
      "/data.txt": "hello",
    },
    outdir: "/out",
    sourceMap: "external",
    minifyWhitespace: true,
    minifySyntax: true,
    async onAfterBundle(api) {
      const code = api.readFile("/out/entry.js");
      const map = JSON.parse(api.readFile("/out/entry.js.map"));
      const decoded = decodeSourceMappings(map);

      // data.txt has no mappings, so it has no `sources` entry.
      expect(map.sources).toEqual(["../other.js", "../entry.js"]);

      // `var x=1;var data_default="hello";console.log(data_default,x);`
      const shim = code.match(/var \w+="hello";/);
      expect(shim).not.toBeNull();
      const shimStart = position(code, shim![0]);
      expect(shimStart.line).toBe(0);

      const nullSegments = decoded.filter(m => m.src === null);
      expect(nullSegments).toEqual([
        { genLine: 0, genCol: shimStart.column, src: null, origLine: null, origCol: null, name: null },
      ]);

      // Inside the shim there is no original position.
      expect(await originalPositionAt(map, { line: 0, column: shimStart.column + "var ".length })).toEqual({
        source: null,
        line: null,
        column: null,
        name: null,
      });
      // The mapping right before the shim belongs to other.js, the one right after to entry.js.
      const before = decoded.filter(m => m.genLine === 0 && m.genCol < shimStart.column).at(-1)!;
      const after = decoded.filter(m => m.genLine === 0 && m.genCol > shimStart.column)[0];
      expect(map.sources[before.src!]).toBe("../other.js");
      expect(map.sources[after.src!]).toBe("../entry.js");
      expect(after.genCol).toBe(shimStart.column + shim![0].length);
    },
  });

  // `sourceMappingURL` and `sources` are URLs. A space, `#`, `%` and
  // non-ASCII in a file name must survive URL parsing. Like esbuild, a space
  // stays literal in `sources` for readability and is `%20` in the comment.
  itBundled("sourcemap/URLEscapedPaths", {
    files: {
      "/my f%le #1 é.js": /* js */ `
        console.log(1);
      `,
    },
    entryPoints: ["/my f%le #1 é.js"],
    outdir: "/out",
    sourceMap: "linked",
    onAfterBundle(api) {
      const code = api.readFile("/out/my f%le #1 é.js");
      const map = JSON.parse(api.readFile("/out/my f%le #1 é.js.map"));

      const comment = code.trimEnd().split("\n").at(-1)!;
      expect(comment).toBe("//# sourceMappingURL=my%20f%25le%20%231%20%C3%A9.js.map");
      const url = new URL(comment.slice("//# sourceMappingURL=".length), "file:///out/");
      expect(decodeURIComponent(url.pathname)).toBe("/out/my f%le #1 é.js.map");

      expect(map.sources).toEqual(["../my f%25le %231 %C3%A9.js"]);
      const sourceURL = new URL(map.sources[0], "file:///out/");
      expect(decodeURIComponent(sourceURL.pathname)).toBe("/my f%le #1 é.js");
    },
  });
});
