import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// WTF::URL::fileSystemPath() returns a null String for a file: URL whose
// percent-decoded path is not UTF-8, for example file:///tmp/50%deposit.db.
// A null String reads as "", which most callers take for the current directory,
// and which crashes as a HashMap key.
//
// Bun::fileSystemPath() in NodeURLHelpers.h is the one place that calls it. It
// returns a Markable<String>, so the caller has to say what "no path" does
// before it can use the path. Bun::fileURLToPath() (Node's rules, for a URL
// from the user) and Bun::fileSystemPathOfInternalURL() are built on it.
//
// The raw call compiles, so this scan is what keeps it out.
const accessor = "src/jsc/bindings/NodeURLHelpers.h";

const rawRead = /(?:\.|->)\s*fileSystemPath\s*\(/g;

// The 1-based lines of `source` that call fileSystemPath() on an object. Only
// whole-line comments are taken out: the "//" of a "file://" literal does not
// start a comment, and a call can be split after its "." or "->".
function linesWithRawRead(source: string): number[] {
  const code = source.replace(/^[ \t]*\/\/.*$/gm, "");
  return Array.from(code.matchAll(rawRead), match => code.slice(0, match.index).split("\n").length);
}

test("the scan recognizes the spellings of a raw call", () => {
  const banned = [
    "path = url.fileSystemPath();",
    "path = url->fileSystemPath();",
    "return Bun::toStringRef(arg0->href().fileSystemPath());",
    // Beside a "file://" literal, as the readers of a user's string are written.
    'if (s.startsWith("file://"_s)) s = WTF::URL(s).fileSystemPath();',
    'auto path = s.startsWith("file://"_s) ? WTF::URL(s).fileSystemPath() : s;',
    'auto path = WTF::URL(makeString("file://"_s, p)).fileSystemPath();',
    // A chain that is broken before or after the ".".
    "auto path = WTF::URL::fileURLWithFileSystemPath(from)\n    .fileSystemPath();",
    "auto path = url.\n    fileSystemPath();",
  ];
  const allowed = [
    "auto path = Bun::fileSystemPath(url);",
    "if (auto path = fileSystemPath(WTF::URL(s)))",
    "sourceOriginStringHolder = Bun::fileSystemPathOfInternalURL(sourceURL);",
    "auto url = WTF::URL::fileURLWithFileSystemPath(from);",
    "    // Not url.fileSystemPath(): that is null for a path that is not UTF-8.",
  ];
  expect(banned.filter(snippet => linesWithRawRead(snippet).length === 0)).toEqual([]);
  expect(allowed.filter(snippet => linesWithRawRead(snippet).length !== 0)).toEqual([]);
  expect(linesWithRawRead("a;\n// b.fileSystemPath();\nc\n    .fileSystemPath();\n")).toEqual([4]);
});

test("WTF::URL::fileSystemPath() is only called in NodeURLHelpers.h", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const src = path.join(repoRoot, "src");

  const violations: string[] = [];
  let scanned = 0;
  let readsInAccessor = 0;

  for await (const rel of new Glob("**/*.{h,cpp}").scan({ cwd: src })) {
    scanned++;
    const relFromRepo = path.join("src", rel).replaceAll("\\", "/");
    const lines = linesWithRawRead(readFileSync(path.join(src, rel), "utf8"));
    if (relFromRepo === accessor) readsInAccessor = lines.length;
    else for (const line of lines) violations.push(`${relFromRepo}:${line}`);
  }

  // Guards against the scan passing vacuously: the glob must have found the
  // tree, and the accessor must still be where the one call lives.
  expect(scanned).toBeGreaterThan(1000);
  expect(readsInAccessor).toBe(1);

  violations.sort();
  expect(violations).toEqual([]);
});
