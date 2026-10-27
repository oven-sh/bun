import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import oxlintConfig from "../../../oxlint.json" with { type: "jsonc" };

// `Bun.fetch` and `Bun.plugin` are user-writable. An internal module that reads
// them at load hands a user stub to every later require of that module. The
// native fetch comes from $cpp("NodeFetch.cpp", "createNativeFetchBinding").
// oxlint.json enforces this with `no-restricted-properties` for src/js/**, but
// its `ignorePatterns` take some files out of oxlint entirely. This lint covers
// those files, so the two checks together reach every file in src/js.
test("no file in src/js that oxlint ignores reads Bun.fetch or Bun.plugin", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const ignored = (oxlintConfig.ignorePatterns as string[]).filter(p => p.startsWith("src/js/"));
  expect(ignored.length).toBeGreaterThan(0);

  const violations: string[] = [];
  const files = new Set<string>();
  for (const pattern of ignored) {
    // A bare directory in ignorePatterns ignores everything under it.
    const isDir =
      !pattern.includes("*") && statSync(path.join(repoRoot, pattern), { throwIfNoEntry: false })?.isDirectory();
    const glob = new Glob(isDir ? pattern + "/**" : pattern);
    for (const rel of glob.scanSync({ cwd: repoRoot })) {
      if (/\.[cm]?[jt]s$/.test(rel)) files.add(rel.replaceAll("\\", "/"));
    }
  }
  expect(files.size).toBeGreaterThan(0);
  for (const rel of [...files].sort()) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    stripCommentsAndStrings(source)
      .split("\n")
      .forEach((code, i) => {
        if (/\bBun\s*\.\s*(fetch|plugin)\b/.test(code) || /\bBun\s*\[\s*["'](fetch|plugin)["']\s*\]/.test(code)) {
          violations.push(`${rel}:${i + 1}: ${source.split("\n")[i].trim()}`);
        }
      });
  }
  expect(violations).toEqual([]);
});

// Blank out comments and string literals, and keep every newline, so a match
// reports the right line. A `//` inside a string does not start a comment and
// a `Bun.fetch` inside a comment or a string is not a read. The key strings of
// `Bun["fetch"]` and `Bun["plugin"]` stay, so the bracket form is still a read.
function stripCommentsAndStrings(source: string): string {
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/g;
  return source.replace(pattern, m => (/^["'](fetch|plugin)["']$/.test(m) ? m : m.replace(/[^\n]/g, " ")));
}
