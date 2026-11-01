// an executable built with --compile-autoload-package-json and --compile-autoload-tsconfig reads both files where it runs: Bun.resolveSync goes by "exports" and by "paths"
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
const dir = realpathSync(mkdtempSync(join(tmpdir(), "package-files-")));
mkdirSync(join(dir, "node_modules", "pkg", "lib"), { recursive: true });
mkdirSync(join(dir, "src"));
writeFileSync(
  join(dir, "node_modules", "pkg", "package.json"),
  JSON.stringify({
    name: "pkg",
    exports: { ".": "./lib/main.js", "./sub": "./lib/sub.js" },
    sideEffects: ["*.css", "./lib/s*.js"],
  }),
);
writeFileSync(join(dir, "node_modules", "pkg", "lib", "main.js"), "");
writeFileSync(join(dir, "node_modules", "pkg", "lib", "sub.js"), "");
writeFileSync(join(dir, "src", "thing.ts"), "");
writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
for (const name of ["pkg", "pkg/sub", "@/thing", "pkg/missing"]) {
  try {
    console.log(name, relative(dir, Bun.resolveSync(name, dir)));
  } catch (error) {
    console.log(name, (error as Error).name);
  }
}
rmSync(dir, { recursive: true });
