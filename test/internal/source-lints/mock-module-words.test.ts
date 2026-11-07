import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The runtime prints a parameter list that holds a comment as it is written, so the comment is part of the text of
// the function. `mentionsOriginalModule` (src/jsc/bindings/BunPlugin.cpp) searches the text of a `mock.module`
// factory for a few words, and takes each as a mention of the original module. So a list that holds one of those
// words is printed without its comments: `READ_BY_MOCK_MODULE` (src/ast/parameter_list_as_written.rs) is a copy of
// the words. A word that only one of the two has brings back a mock that loads its original, with every test green.
test("the words that keep a parameter list from being printed as written are the words that mock.module reads", () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  const reader = read("src/jsc/bindings/BunPlugin.cpp").match(/^static bool mentionsOriginalModule\([^]*?^}/m)?.[0];
  if (!reader) throw new Error("src/jsc/bindings/BunPlugin.cpp no longer has `static bool mentionsOriginalModule(`");
  const writer = read("src/ast/parameter_list_as_written.rs").match(/^const READ_BY_MOCK_MODULE: .*= \[(.*)\];$/m)?.[1];
  if (!writer) throw new Error("src/ast/parameter_list_as_written.rs no longer has `const READ_BY_MOCK_MODULE`");

  const wordsOfReader = Array.from(reader.matchAll(/"(\w+)"_s/g), match => match[1]).sort();
  const wordsOfWriter = Array.from(writer.matchAll(/b"(\w+)"/g), match => match[1]).sort();
  expect(wordsOfReader).not.toEqual([]);
  expect(wordsOfWriter).toEqual(wordsOfReader);
});
