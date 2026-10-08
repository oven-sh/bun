// Many small files in one: `=== /<path> <length in bytes>\n`, the bytes, `\n`, one after the other, compressed with zstd.
// Some fixtures are about byte order marks, line endings and malformed text, so nothing is decoded.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readBundle(path: string): Map<string, Buffer> {
  const bytes = Buffer.from(Bun.zstdDecompressSync(readFileSync(path)));
  const files = new Map<string, Buffer>();
  for (let at = 0; at < bytes.length; ) {
    const end = bytes.indexOf(10, at);
    const header = bytes.toString("utf8", at + 5, end);
    const space = header.lastIndexOf(" ");
    const length = Number(header.slice(space + 1));
    files.set(header.slice(0, space), bytes.subarray(end + 1, end + 1 + length));
    at = end + 1 + length + 1;
  }
  return files;
}

export function writeBundle(path: string, files: Map<string, Uint8Array>) {
  const parts: Uint8Array[] = [];
  for (const name of [...files.keys()].sort()) {
    const bytes = files.get(name)!;
    parts.push(Buffer.from(`=== /${name} ${bytes.length}\n`), bytes, Buffer.from("\n"));
  }
  writeFileSync(path, Bun.zstdCompressSync(Buffer.concat(parts), { level: 19 }));
}

/** Writes the files whose path contains `part` below `into`. */
export function extract(bundle: string, part: string, into: string) {
  let count = 0;
  for (const [name, bytes] of readBundle(bundle)) {
    if (!name.includes(part)) continue;
    mkdirSync(dirname(join(into, name)), { recursive: true });
    writeFileSync(join(into, name), bytes);
    count++;
  }
  return count;
}

/** The files below `root`/`directory`, by their path from `root`. */
export function collect(root: string, directory: string, files: Map<string, Uint8Array>, skip: (name: string) => boolean) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(root, path, files, skip);
    else if (!skip(entry.name)) files.set(path, readFileSync(join(root, path)));
  }
}
