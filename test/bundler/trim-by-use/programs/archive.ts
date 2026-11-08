import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const archive = new Bun.Archive({ "a.txt": "first", "folder/b.json": JSON.stringify({ b: 2 }) }, { compress: "gzip" });
const bytes = await archive.bytes();
console.log("gzip", bytes[0] === 0x1f && bytes[1] === 0x8b);
const files = await new Bun.Archive(bytes).files();
for (const [name, file] of [...files].sort(([a]: [string, unknown], [b]: [string, unknown]) => a.localeCompare(b)))
  console.log(name, await file.text());
const folder = mkdtempSync(join(tmpdir(), "trim-archive-"));
console.log(
  "extracted",
  await new Bun.Archive(bytes).extract(folder),
  readFileSync(join(folder, "folder/b.json"), "utf8"),
);
await Bun.write(join(folder, "copy.tar.gz"), archive);
console.log("written", (await new Bun.Archive(readFileSync(join(folder, "copy.tar.gz"))).files()).size);
rmSync(folder, { recursive: true, force: true });
console.log("plain tar", (await new Bun.Archive({ "c.txt": "third" }).bytes()).length);
