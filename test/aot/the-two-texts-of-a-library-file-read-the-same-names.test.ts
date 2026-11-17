// Some files of Bun's library have two texts: src/js/<file>, which `bun <file>` runs, and src/js/ahead-of-time/<file>, which a compiled program runs.
// Nobody held one against the other: a name that the first reads off an object and the second reads no more is a difference that a program can see.
// This lists each such name. A name that is not expected here fails, and so does an expected one that is found no more: its line goes out.
// A read that has moved into another of the ahead-of-time files is a read still. TypeScript's `!` and the names of types behind import("..") are no reads.
// Each link of `a.b.c` is a read.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const library = join(import.meta.dir, "..", "..", "src", "js");

const expected: string[] = [
  // Names of types.
  // It answers false, always.
  // `globalThis.TypeError` and `Function.prototype.call`, each kept in a variable.
  // Read by a pattern: `const { subject, subjectaltname: altNames } = cert`.
  "node/tls.ts subject",
  "node/tls.ts subjectaltname",
];

function namesReadIn(file: string): Set<string> {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;])\/\/.*$/gm, "$1")
    .replace(/import\("[^"]*"\)(\.\w+)+/g, "")
    .replace(/(?<=[\w)\]])!(?=\??\.|\[)/g, "");
  const names = new Set<string>();
  for (const [, name] of text.matchAll(/(?<=[\w)\]])\??\.([A-Za-z_]\w*)\b(?!\s*=(?!=))/g)) names.add(name);
  for (const [, name] of text.matchAll(/[\w)]\??\.?\[(k[A-Z]\w*)\](?!\s*=(?!=))/g)) names.add(name);
  return names;
}

test("what plain's text of a library file reads off an object, the ahead-of-time text reads too", () => {
  const entries = readdirSync(join(library, "ahead-of-time"), { recursive: true }) as string[];
  const files = entries.map(entry => entry.replaceAll("\\", "/")).filter(file => file.endsWith(".ts"));
  // A file without a second text has one text, which the compiler reads too.
  const withOneText = (readdirSync(library, { recursive: true }) as string[])
    .map(entry => entry.replaceAll("\\", "/"))
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.startsWith("ahead-of-time/"))
    .filter(file => !files.includes(file));
  const compiled = new Set(
    [
      ...files.map(file => join(library, "ahead-of-time", file)),
      ...withOneText.map(file => join(library, file)),
    ].flatMap(path => [...namesReadIn(path)]),
  );
  const found: string[] = [];
  for (const file of files.filter(file => existsSync(join(library, file)))) {
    for (const name of namesReadIn(join(library, file))) {
      if (!compiled.has(name)) found.push(`${file} ${name}`);
    }
  }
  expect(found.sort()).toEqual(expected.toSorted());
});
