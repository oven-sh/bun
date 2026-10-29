import { cpSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });

/**
 * Copies the fixture package in `from` to `node_modules/<its name>` of `project`. A fixture holds only the TypeScript that its "aot"
 * condition names. The JavaScript beside it, which everything but --aot loads, is written here: the same text without the types.
 */
export function installPackage(from: string, project: string, edit = (typed: string) => typed) {
  const { name } = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
  const to = join(project, "node_modules", name);
  cpSync(from, to, { recursive: true });
  for (const file of readdirSync(to)) {
    if (!file.endsWith(".aot.ts")) continue;
    const typed = edit(readFileSync(join(to, file), "utf8"));
    writeFileSync(join(to, file), typed);
    writeFileSync(join(to, file.replace(/\.aot\.ts$/, ".js")), transpiler.transformSync(typed));
  }
  return to;
}
