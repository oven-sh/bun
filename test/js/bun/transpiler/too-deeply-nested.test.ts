import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

// A JSON or XML document that nests deeper than the native stack allows is
// rejected by the parser, or by the later pass that converts its tape rows
// into the classic AST. That pass has larger frames, so it can trip on a
// depth the parser accepted. Every site has to agree on the wording.
// `scan` is used because `transformSync` also prints, and the printer has a
// depth limit of its own.
const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
const shapes = {
  json: (depth: number) => repeat('{"a":', depth) + "1" + repeat("}", depth),
  xml: (depth: number) => repeat("<a>", depth) + "x" + repeat("</a>", depth),
};

// Deep enough to trip the conversion pass on every build, and below the XML
// parser's own element depth cap of 100_000, which has a different message.
const deepEnough = 99_000;

function scanError(transpiler: Bun.Transpiler, loader: keyof typeof shapes, depth: number): string | undefined {
  try {
    transpiler.scan(shapes[loader](depth), loader);
  } catch (e: any) {
    return `${e.name}: ${e.message}`;
  }
}

test("Bun.Transpiler reports a too deeply nested JSON document with one message", () => {
  // The depth at which each pass trips depends on the build, so sweep depths
  // in small steps and collect every distinct message.
  const transpiler = new Bun.Transpiler();
  const messages = new Set<string>();
  for (let depth = 256; depth <= 2 ** 18; depth = Math.ceil(depth * 1.05)) {
    const message = scanError(transpiler, "json", depth);
    if (message !== undefined) messages.add(message);
  }
  expect([...messages]).toEqual(["BuildMessage: JSON document is too deeply nested"]);
});

test("Bun.Transpiler names the format for a too deeply nested XML document", () => {
  expect(scanError(new Bun.Transpiler(), "xml", deepEnough)).toBe("BuildMessage: XML document is too deeply nested");
});

test("Bun.build reports a too deeply nested document with the same messages", async () => {
  using dir = tempDir("too-deeply-nested", {
    "deep.json": shapes.json(deepEnough),
    "deep.xml": shapes.xml(deepEnough),
  });
  const messages: Record<string, string[]> = {};
  for (const name of ["deep.json", "deep.xml"]) {
    const result = await Bun.build({ entrypoints: [join(String(dir), name)], throw: false });
    messages[name] = result.logs.map(log => `${log.name}: ${log.message}`);
  }
  expect(messages).toEqual({
    "deep.json": ["BuildMessage: JSON document is too deeply nested"],
    "deep.xml": ["BuildMessage: XML document is too deeply nested"],
  });
});
