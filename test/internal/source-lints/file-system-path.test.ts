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
const accessor = "src/jsc/bindings/NodeURLHelpers.h";

const rawRead = /(?:\.|->)\s*fileSystemPath\s*\(/;

test("WTF::URL::fileSystemPath() is only called in NodeURLHelpers.h", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const src = path.join(repoRoot, "src");

  const violations: string[] = [];
  let scanned = 0;
  let readsInAccessor = 0;

  for await (const rel of new Glob("**/*.{h,cpp}").scan({ cwd: src })) {
    scanned++;
    const relFromRepo = path.join("src", rel).replaceAll("\\", "/");
    const source = readFileSync(path.join(src, rel), "utf8");
    if (!rawRead.test(source)) continue;
    source.split("\n").forEach((line, index) => {
      const commentStart = line.indexOf("//");
      const code = commentStart === -1 ? line : line.slice(0, commentStart);
      if (!rawRead.test(code)) return;
      if (relFromRepo === accessor) readsInAccessor++;
      else violations.push(`${relFromRepo}:${index + 1}`);
    });
  }

  // Guards against the scan passing vacuously: the glob must have found the
  // tree, and the accessor must still be where the one call lives.
  expect(scanned).toBeGreaterThan(1000);
  expect(readsInAccessor).toBe(1);

  violations.sort();
  expect(violations).toEqual([]);
});
