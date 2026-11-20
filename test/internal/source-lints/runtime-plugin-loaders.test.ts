import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `handleOnLoadResultNotPromise` in src/jsc/bindings/ModuleLoader.cpp has the loader names that a runtime plugin
// (`Bun.plugin`) can return from `onLoad` or `module()`. It throws for every other name. The list has three
// hand-written copies: the message of that throw, the JSDoc of `OnLoadResultSourceCode.loader` in
// packages/bun-types/bun.d.ts, and docs/runtime/plugins.mdx. The type of that property is the `Loader` of
// `Bun.build`, which has more names, so the two texts are where a user learns what a runtime plugin accepts (#17655).
const runtimeFile = "src/jsc/bindings/ModuleLoader.cpp";
const typesFile = "packages/bun-types/bun.d.ts";
const docsFile = "docs/runtime/plugins.mdx";
const root = path.resolve(import.meta.dir, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// A copy that moved or changed its shape must fail here, not match nothing.
function between(text: string, start: string, end: string, file: string): string {
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`${file} no longer has \`${start}\``);
  const to = text.indexOf(end, from + start.length);
  if (to === -1) throw new Error(`${file} has no \`${end}\` after \`${start}\``);
  return text.slice(from, to);
}

const namesIn = (text: string, name: RegExp) => Array.from(text.matchAll(name), match => match[1]).sort();

const validator = between(
  read(runtimeFile),
  "static OnLoadResult handleOnLoadResultNotPromise(",
  "\nstatic OnLoadResult handleOnLoadResult(",
  runtimeFile,
);
const accepted = namesIn(validator, /loaderString == "([^"]+)"_s/g);
// "object" takes `exports` in place of `contents`, so the types give it an interface of its own.
const acceptedWithContents = accepted.filter(name => name !== "object");

test(`${runtimeFile} compares the loader of a runtime plugin with a list of names`, () => {
  expect(accepted).toContain("object");
  expect(acceptedWithContents).not.toBeEmpty();
});

test(`the error message in ${runtimeFile} has every loader that a runtime plugin can return`, () => {
  const message = between(validator, '"Expected loader to be one of', '"_s', runtimeFile);
  expect(namesIn(message, /\\"([^"\\]+)\\"/g)).toEqual(accepted);
});

test(`the JSDoc of OnLoadResultSourceCode.loader in ${typesFile} has every loader that a runtime plugin can return`, () => {
  const declaration = between(read(typesFile), "interface OnLoadResultSourceCode {", "\n  }\n", typesFile);
  const sentence = between(declaration, "In a runtime plugin (`Bun.plugin`), `loader` can be", ".", typesFile);
  expect(namesIn(sentence, /`"([^"]+)"`/g)).toEqual(acceptedWithContents);
});

test(`${docsFile} has every loader that a runtime plugin can return`, () => {
  const sentence = between(read(docsFile), "\n`loader` can be ", ".", docsFile);
  expect(namesIn(sentence, /`"([^"]+)"`/g)).toEqual(acceptedWithContents);
});
