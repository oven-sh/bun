// Packs many small files into one. Each file is `=== /<path> <length in bytes>\n`, its bytes and `\n`, and the whole
// thing is compressed with zstd. Some fixtures test byte order marks, line endings and malformed text, so nothing is
// decoded.
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

/** Concatenates the files without compressing them. */
export function concatenate(files: Map<string, Uint8Array>) {
  const parts: Uint8Array[] = [];
  for (const name of [...files.keys()].sort()) {
    const bytes = files.get(name)!;
    parts.push(Buffer.from(`=== /${name} ${bytes.length}\n`), bytes, Buffer.from("\n"));
  }
  return Buffer.concat(parts);
}

export function writeBundle(path: string, files: Map<string, Uint8Array>) {
  writeFileSync(path, Bun.zstdCompressSync(concatenate(files), { level: 19 }));
}

/** Writes the files whose path contains `part` into the `into` directory. */
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

/** Adds the files under `root`/`directory` to `files`, keyed by their path relative to `root`. */
export function collect(root: string, directory: string, files: Map<string, Uint8Array>, skip: (name: string) => boolean) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(root, path, files, skip);
    else if (!skip(entry.name)) files.set(path, readFileSync(join(root, path)));
  }
}
