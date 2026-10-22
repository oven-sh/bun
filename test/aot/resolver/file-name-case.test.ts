import { describe } from "../supported";
import { testResolution, type ResolutionCase } from "./resolution-cases";

// bun_resolver looks up a file name in lowercase on every file system, and remembers the path it answered with. So each
// specifier has a tree of its own.
const notFound = "bun run finds the file, bun compile does not";
const specifiers: [name: string, specifier: string, notYet?: string][] = [
  ["a file name without its extension", "./Foo", notFound],
  ["a file name with its extension", "./Foo.ts"],
  ["a file name with .js for .ts", "./Foo.js", notFound],
  ["a directory name", "./Dir/inner"],
];

const cases = specifiers.map(
  ([name, specifier, notYet]): ResolutionCase => ({
    notYet,
    name: `${name} in another letter case`,
    files: { "foo.ts": "", "dir/inner.ts": "" },
    pins: [["importer.js", specifier]],
  }),
);

describe("code resolution", () => testResolution(cases));
