// What a program can see of Bun.Archive, as text. `record.ts` saves it and the test compares it.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from "node:fs";

export type Case = {
  /** The archive, base64. */
  data: string;
  /** Whether macOS and Windows read it the way Linux does. */
  mac: boolean;
  win: boolean;
  files: string;
  extract: string;
};

const crc = (bytes: Uint8Array) => Bun.hash.crc32(bytes).toString(16).padStart(8, "0");

export async function observeFiles(archive: Uint8Array): Promise<string> {
  let map: Map<string, File>;
  try {
    map = await new Bun.Archive(archive).files();
  } catch {
    return "rejected\n";
  }
  let out = "";
  for (const [name, file] of map) {
    out += `${JSON.stringify(name)} name=${JSON.stringify(file.name)} size=${file.size} mtime=${file.lastModified} crc=${crc(await file.bytes())}\n`;
  }
  return out;
}

/** Everything under `root` + `relative`. Makes it all readable on the way. */
export function tree(root: Buffer, relative: Buffer, out: string[]) {
  const here = Buffer.concat([root, relative]);
  for (const name of readdirSync(here, { encoding: "buffer" }).sort(Buffer.compare)) {
    const child = Buffer.concat([relative, Buffer.from("/"), name]);
    const path = Buffer.concat([root, child]);
    const stat = lstatSync(path);
    const shown = `${JSON.stringify(child.latin1Slice())} ${(stat.mode & 0o777).toString(8)}`;
    if (stat.isSymbolicLink()) {
      out.push(
        `link ${JSON.stringify(child.latin1Slice())} -> ${JSON.stringify(readlinkSync(path, "buffer").latin1Slice())}`,
      );
    } else if (stat.isDirectory()) {
      out.push(`dir ${shown}`);
      chmodSync(path, 0o700);
      tree(root, child, out);
    } else {
      chmodSync(path, 0o600);
      out.push(`file ${shown} nlink=${stat.nlink} size=${stat.size} crc=${crc(readFileSync(path))}`);
    }
  }
}

/** `into` must not exist yet. What a rejected extraction leaves behind is part of the result. */
export async function observeExtract(archive: Uint8Array, into: string): Promise<string> {
  mkdirSync(into);
  const out: string[] = [];
  try {
    out.push(`extracted ${await new Bun.Archive(archive).extract(into)}`);
  } catch {
    out.push("rejected");
  }
  tree(Buffer.from(into), Buffer.alloc(0), out);
  return out.join("\n") + "\n";
}

const text = (field: Uint8Array) => {
  const end = field.indexOf(0);
  return Buffer.from(end < 0 ? field : field.subarray(0, end));
};

/**
 * The headers of a tar made by Bun.Archive, then a checksum of all of it. Entries are stamped with
 * the current time, so that field is checked and blanked first, with the header checksum it feeds.
 */
export function observeTar(tar: Uint8Array, notBefore: number): string {
  const bytes = Buffer.from(tar);
  let out = `${bytes.length} bytes\n`;
  for (let at = 0; at + 512 <= bytes.length;) {
    const header = bytes.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const stored = parseInt(text(header.subarray(148, 156)).toString(), 8);
    header.fill(" ", 148, 156);
    const sum = header.reduce((a, b) => a + b, 0);
    const mtime = parseInt(text(header.subarray(136, 148)).toString(), 8);
    const now = Math.floor(Date.now() / 1000);
    header.fill(0, 136, 156);
    const size = parseInt(text(header.subarray(124, 136)).toString(), 8);
    const type = String.fromCharCode(header[156]);
    out += `type=${type} name=${text(header.subarray(0, 100)).toString("hex")} prefix=${text(header.subarray(345, 500)).toString("hex")} mode=${text(header.subarray(100, 108))} size=${size}`;
    out += ` checksum=${stored === sum ? "ok" : "bad"} mtime=${mtime >= notBefore && mtime <= now ? "now" : mtime}\n`;
    if (type === "x") out += `  pax=${bytes.subarray(at + 512, at + 512 + size).toString("hex")}\n`;
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out + `crc=${crc(bytes)}\n`;
}
