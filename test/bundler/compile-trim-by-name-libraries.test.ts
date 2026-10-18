import { describe, expect, test } from "bun:test";
import { bunExe, isMacOS, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorsPath, narrowestNameOf, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";

const all = readTrimFeatures(readFileSync(doorsPath, "utf8"));

const textsOf: Record<string, string[]> = {
  "libjpeg-turbo": ["Bogus Huffman table definition", "Unsupported JPEG process", "Invalid JPEG file structure"],
  libwebp: ["Frame setup failed", "Premature end-of-partition0 encountered", "NULL VP8Io parameter"],
  libarchive: ["Damaged tar archive", "Truncated tar archive", "Can't allocate tar data"],
  SQLite: ["malformed database schema", "unable to open database file", "SQLite format 3"],
  TinyCC: ["cannot use local functions", "invalid operand types for binary operation"],
  "lol-html": ["The selector is empty", "Unexpected token in selector"],
  lsquic: ["lsquic_engine"],
};
const isLinked = (library: string) => !(isMacOS && library === "SQLite");

function namesThatTake(library: string) {
  const names = new Set(all.libraries.find(each => each.name === library)!.features.map(feature => narrowestNameOf(all, feature)!));
  for (const name of names) for (const other of removedOnlyWith(all, all.names.find(each => each.name === name)!)) names.add(other);
  return [...names] as Bun.Build.TrimFeature[];
}

async function hello(trim: Bun.Build.TrimFeature[] | true) {
  using dir = tempDir("compile-trim-by-name-libraries", { "hello.ts": `console.log("hello world");` });
  const built = await Bun.build({ entrypoints: [join(String(dir), "hello.ts")], compile: { outfile: join(String(dir), "hello"), trim } });
  return { file: readFileSync(join(String(dir), "hello" + (isWindows ? ".exe" : ""))), said: built.logs.map(log => log.message) };
}

const hasIslands = await hello(true).then(
  () => true,
  () => false,
);

test("the whole Bun holds every text that the libraries are known by here", () => {
  const whole = readFileSync(bunExe());
  const missing = Object.entries(textsOf).flatMap(([library, texts]) => (isLinked(library) ? texts.filter(text => !whole.includes(text)).map(text => `${library}: ${text}`) : []));
  expect(missing).toEqual([]);
});

describe.skipIf(!hasIslands)("a native library that compile.trim takes out leaves none of its texts in the file", () => {
  test.concurrent.each(Object.keys(textsOf).filter(isLinked))("%s", async library => {
    const names = namesThatTake(library);
    const { file, said } = await hello(names);
    expect(said.find(line => line.startsWith("compile.trim: native libraries left out: "))).toContain(library);
    expect({ names, left: textsOf[library]!.filter(text => file.includes(text)) }).toEqual({ names, left: [] });
  });
});
