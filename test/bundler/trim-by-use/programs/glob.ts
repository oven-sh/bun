// Bun.Glob: matching, and walking a folder made here
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const glob = new Bun.Glob("**/*.{ts,tsx}");
console.log(
  glob.match("a/b/c.ts"),
  glob.match("a.tsx"),
  glob.match("a.js"),
  new Bun.Glob("[a-c]?.txt").match("b1.txt"),
  new Bun.Glob("!x*").match("y"),
);
const dir = mkdtempSync(join(tmpdir(), "glob-"));
mkdirSync(join(dir, "src", "deep"), { recursive: true });
for (const name of ["a.ts", "b.js", "src/c.tsx", "src/deep/d.ts", "src/deep/e.md"]) writeFileSync(join(dir, name), "");
console.log([...glob.scanSync({ cwd: dir })].sort().join(" "));
console.log((await Array.fromAsync(new Bun.Glob("src/**").scan({ cwd: dir, onlyFiles: false }))).sort().join(" "));
rmSync(dir, { recursive: true });
