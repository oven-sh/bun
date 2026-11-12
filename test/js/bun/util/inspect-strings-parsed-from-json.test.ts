import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join, posix, win32 } from "node:path";

const long = "x".repeat(40);
const oneLine = (first: string) => `[ ${JSON.stringify(first)}, "${long}", "o" ]`;
const twoLines = (first: string) => `[ ${JSON.stringify(first)}, "${long}",\n  "o"\n]`;
const textOf = (first: string) => JSON.stringify([first, long, "o"]);
const bytesOf = (first: string) => new TextEncoder().encode(textOf(first));

describe("Bun.inspect of a list of strings parsed from JSON", () => {
  const fromText: Record<string, (text: string) => unknown> = {
    "JSON.parse": text => JSON.parse(text),
    "JSON.parse with a reviver": text => JSON.parse(text, (_, value) => value),
    "Bun.JSONL.parse": text => Bun.JSONL.parse(text + "\n")[0],
    "Bun.JSONL.parseChunk": text => Bun.JSONL.parseChunk(text + "\n").values[0],
    "Response.json": text => new Response(text).json(),
  };
  for (const [name, parse] of Object.entries(fromText)) {
    test.each(["a", "é"])(`${name} of a text of Latin-1 characters: %s`, async first => {
      expect(Bun.inspect(await parse(textOf(first)))).toBe(oneLine(first));
    });
    test.each(["中", "😀"])(`${name} of a text with another character: %s`, async first => {
      expect(Bun.inspect(await parse(textOf(first)))).toBe(twoLines(first));
    });
  }

  const fromBytes: Record<string, (bytes: Uint8Array) => unknown> = {
    "Response.json": bytes => new Response(bytes).json(),
    "Request.json": bytes => new Request("http://localhost/", { method: "POST", body: bytes }).json(),
    "Blob.json": bytes => new Blob([bytes]).json(),
    "Bun.readableStreamToJSON": bytes => Bun.readableStreamToJSON(new Blob([bytes]).stream()),
    "Bun.JSONL.parse": bytes => Bun.JSONL.parse(bytes)[0],
    "Bun.JSONL.parseChunk": bytes => Bun.JSONL.parseChunk(bytes).values[0],
  };
  for (const [name, parse] of Object.entries(fromBytes)) {
    test(`${name} of ASCII bytes`, async () => {
      expect(Bun.inspect(await parse(bytesOf("a")))).toBe(oneLine("a"));
    });
    test.each(["é", "中", "😀"])(`${name} of bytes with another character: %s`, async first => {
      expect(Bun.inspect(await parse(bytesOf(first)))).toBe(twoLines(first));
    });
  }

  test("files", async () => {
    using dir = tempDir("inspect-strings-parsed-from-json", {
      "ascii.json": textOf("a"),
      "accent.json": textOf("é"),
      "wide.json": textOf("中"),
    });
    const printed = async (name: string) => [
      Bun.inspect(await Bun.file(join(String(dir), name)).json()),
      Bun.inspect(require(join(String(dir), name))),
    ];
    expect(await printed("ascii.json")).toEqual([oneLine("a"), oneLine("a")]);
    expect(await printed("accent.json")).toEqual([twoLines("é"), twoLines("é")]);
    expect(await printed("wide.json")).toEqual([twoLines("中"), twoLines("中")]);
  });

  test("the same list written in the program", () => {
    for (const first of ["a", "é", "中", "😀"]) expect(Bun.inspect([first, long, "o"])).toBe(oneLine(first));
  });

  test("strings of up to 16 characters, and strings written with escapes alone", () => {
    const short = "y".repeat(16);
    expect(Bun.inspect(JSON.parse(JSON.stringify(["中", short, short, short, "o"])))).toBe(
      `[ "中", "${short}", "${short}", "${short}", "o" ]`,
    );
    expect(Bun.inspect(JSON.parse(`["中","${"\\u0078".repeat(40)}","o"]`))).toBe(oneLine("中"));
    expect(Bun.inspect(JSON.parse(`["中","${long.slice(2)}\\u0078x","o"]`))).toBe(twoLines("中"));
  });

  test("inside objects", () => {
    expect(Bun.inspect(JSON.parse(`{"name":${textOf("中")}}`))).toBe(`{\n  name: [ "中", "${long}",\n    "o"\n  ],\n}`);
    expect(Bun.inspect(JSON.parse(`{"name":${textOf("é")}}`))).toBe(`{\n  name: [ "é", "${long}", "o" ],\n}`);
  });

  test("an escape character", () => {
    const text = "\x1b[31m" + "x".repeat(30);
    expect(Bun.inspect(JSON.parse(JSON.stringify(["a", text]))[1])).toBe(`"\\u001B[31m${"x".repeat(30)}"`);
    expect(Bun.inspect(JSON.parse(JSON.stringify(["中", text]))[1])).toBe(`"\\u001b[31m${"x".repeat(30)}"`);
  });
});

describe("Bun.inspect of a list of paths", () => {
  const accented = "é".repeat(20) + "x".repeat(20);
  test.each([
    ["posix", posix],
    ["win32", win32],
  ])("%s", (_, path) => {
    const printed = (made: string) => Bun.inspect([made, "o"]).includes("\n");
    expect(printed(path.join(long, "a"))).toBe(false);
    expect(printed(path.basename("/a/" + long))).toBe(false);
    expect(printed(path.join(accented, "a"))).toBe(true);
    expect(printed(path.normalize(accented + "/./a"))).toBe(true);
    expect(printed(path.resolve("/" + accented))).toBe(true);
    expect(printed(path.basename("/a/" + accented))).toBe(true);
    expect(printed(path.dirname("/" + accented + "/a"))).toBe(true);
    expect(printed(path.parse("/a/" + accented + ".txt").name)).toBe(true);
    expect(printed(path.parse("/" + accented + "/" + long + ".txt").base)).toBe(false);
    expect(printed(path.relative("/a", "/a/" + accented))).toBe(true);
    expect(printed(path.format({ dir: "/" + accented, base: "b" }))).toBe(true);
    expect(printed(path.normalize("/" + accented + "/a"))).toBe(true);
    expect(printed(path.join("/" + accented))).toBe(true);
    expect(printed(path.join("/a", "../" + accented))).toBe(true);
    expect(printed(path.resolve("/a", "../" + accented))).toBe(true);
    expect(printed(path.resolve(accented).slice(-40))).toBe(true);
    expect(printed(path.relative("/a/b", "/a/" + accented))).toBe(true);
    expect(printed(path.relative("/a/./b", "/a/" + accented))).toBe(true);
    expect(printed(path.extname("/a/b." + accented))).toBe(true);
    expect(printed(path.basename("/a/" + accented + ".txt", ".txt"))).toBe(true);
    expect(printed(path.basename("/" + accented + "/" + long))).toBe(false);
    expect(printed(path.basename("/" + accented + "/" + long + ".txt", ".txt"))).toBe(false);
    expect(printed(path.dirname("/" + long + "/" + accented))).toBe(false);
    expect(printed(path.extname("/" + accented + "/b." + long))).toBe(false);
  });
});
