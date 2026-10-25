import { describe } from "../supported";
import { testResolution, type ResolutionCase } from "./resolution-cases";

// Bun's resolver looks up a file name in lowercase on every file system, and remembers the path it answered with. So each
// specifier has a tree of its own.
const specifiers: [name: string, specifier: string][] = [
  ["a file name without its extension", "./Foo"],
  ["a file name with its extension", "./Foo.ts"],
  ["a file name with .js for .ts", "./Foo.js"],
  ["a directory name", "./Dir/inner"],
];

const cases = specifiers.map(([name, specifier]): ResolutionCase => ({
  name: `${name} in another letter case`,
  files: { "foo.ts": "", "dir/inner.ts": "" },
  pins: [["importer.js", specifier]],
}));

describe("code resolution", () => testResolution(cases));
