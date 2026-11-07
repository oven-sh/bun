// Bun.FileSystemRouter over a folder made here
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "fsrouter-"));
mkdirSync(join(dir, "posts"));
writeFileSync(join(dir, "index.tsx"), "");
writeFileSync(join(dir, "posts", "[id].tsx"), "");
writeFileSync(join(dir, "[...rest].tsx"), "");
const router = new Bun.FileSystemRouter({ style: "nextjs", dir });
console.log(Object.keys(router.routes).sort().join(" "), router.style);
for (const path of ["/", "/posts/7?x=1", "/a/b/c"]) {
  const match = router.match(path)!;
  console.log(path, match.name, match.kind, JSON.stringify(match.params), JSON.stringify(match.query), match.pathname);
}
rmSync(dir, { recursive: true });
