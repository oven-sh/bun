// node:fs: sync, callback and promise forms, a directory handle, cp, streams
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = fs.mkdtempSync(join(tmpdir(), "node-fs-"));
fs.mkdirSync(join(dir, "a", "b"), { recursive: true });
fs.writeFileSync(join(dir, "a", "one.txt"), "one");
fs.appendFileSync(join(dir, "a", "one.txt"), "+two");
console.log(
  fs.readFileSync(join(dir, "a", "one.txt"), "utf8"),
  fs.statSync(join(dir, "a", "one.txt")).size,
  fs.existsSync(join(dir, "nothing")),
);
console.log(
  fs.readdirSync(dir, { recursive: true }).sort().join(" "),
  fs
    .readdirSync(join(dir, "a"), { withFileTypes: true })
    .map((entry: any) => `${entry.name}:${entry.isDirectory()}`)
    .sort()
    .join(" "),
);
fs.cpSync(join(dir, "a"), join(dir, "copy"), { recursive: true });
await fs.promises.cp(join(dir, "a"), join(dir, "copy2"), { recursive: true });
console.log(
  await fs.promises.readFile(join(dir, "copy", "one.txt"), "utf8"),
  (await fs.promises.readdir(join(dir, "copy2"))).sort().join(" "),
);
const handle = fs.opendirSync(dir);
const names: string[] = [];
for (let entry; (entry = handle.readSync()); ) names.push(entry.name);
handle.closeSync();
console.log(names.sort().join(" "));
try {
  fs.readFileSync(join(dir, "nothing"));
} catch (error) {
  console.log((error as any).code, (error as any).syscall);
}
const piped = Promise.withResolvers<void>();
fs.createReadStream(join(dir, "a", "one.txt"))
  .pipe(fs.createWriteStream(join(dir, "piped.txt")))
  .on("finish", () => piped.resolve());
await piped.promise;
fs.readFile(join(dir, "piped.txt"), "utf8", (_error: any, text: string) => {
  console.log(text);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fs.existsSync(dir));
});
