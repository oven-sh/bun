// Picks type aliases, interfaces and enums out of real code as seeds.
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [tsdir, out, max, ...roots] = process.argv.slice(2);
const ts = (await import(resolve(tsdir, "lib/typescript.js"))).default;
function* walk(p: string): Generator<string> {
  if (statSync(p).isDirectory()) { for (const n of readdirSync(p).sort()) if (n !== "node_modules") yield* walk(join(p, n)); }
  else if (/\.ts$/.test(p)) yield p;
}
const seeds: string[] = [];
const shapes = new Set<string>();
for (const root of roots) for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const visit = (node: any) => {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
      const s = text.slice(node.getStart(sf), node.end);
      if (s.length >= 40 && s.length <= 260 && !/\/\/|\/\*|`/.test(s) && !/\n\s*\n/.test(s)) {
        // One seed per shape: identifiers and literals masked.
        const shape = s.replace(/[A-Za-z_$][\w$]*/g, m => /^(type|interface|enum|extends|keyof|typeof|infer|readonly|in|as|is|new|export|declare|const|null|undefined|void|never|any|unknown|string|number|boolean)$/.test(m) ? m : "x").replace(/'[^']*'|"[^"]*"/g, "s").replace(/\s+/g, " ");
        if (!shapes.has(shape)) { shapes.add(shape); seeds.push(s); }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
// A spread over everything that was found.
const step = Math.max(1, Math.floor(seeds.length / Number(max)));
const picked = seeds.filter((_, i) => i % step === 0).slice(0, Number(max));
writeFileSync(out, picked.join("\n\n") + "\n");
console.log(seeds.length, picked.length);
