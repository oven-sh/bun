import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

// Helper to create tar files programmatically with exact control over entry paths
function createTarHeader(
  name: string,
  size: number,
  type: "0" | "2" | "5", // 0=file, 2=symlink, 5=directory
  linkname: string = "",
): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  // Name (100 bytes)
  const nameBytes = encoder.encode(name);
  header.set(nameBytes.slice(0, 100), 0);

  // Mode (8 bytes) - octal
  const modeStr = type === "5" ? "0000755" : "0000644";
  header.set(encoder.encode(modeStr.padStart(7, "0") + " "), 100);

  // UID (8 bytes)
  header.set(encoder.encode("0000000 "), 108);

  // GID (8 bytes)
  header.set(encoder.encode("0000000 "), 116);

  // Size (12 bytes) - octal
  const sizeStr = size.toString(8).padStart(11, "0") + " ";
  header.set(encoder.encode(sizeStr), 124);

  // Mtime (12 bytes)
  const mtime = Math.floor(Date.now() / 1000)
    .toString(8)
    .padStart(11, "0");
  header.set(encoder.encode(mtime + " "), 136);

  // Checksum placeholder (8 spaces)
  header.set(encoder.encode("        "), 148);

  // Type flag (1 byte)
  header[156] = type.charCodeAt(0);

  // Link name (100 bytes) - for symlinks
  if (linkname) {
    const linkBytes = encoder.encode(linkname);
    header.set(linkBytes.slice(0, 100), 157);
  }

  // USTAR magic
  header.set(encoder.encode("ustar"), 257);
  header[262] = 0; // null terminator
  header.set(encoder.encode("00"), 263);

  // Calculate and set checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.set(encoder.encode(checksumStr), 148);

  return header;
}

function padToBlock(data: Uint8Array): Uint8Array[] {
  const result = [data];
  const remainder = data.length % 512;
  if (remainder > 0) {
    result.push(new Uint8Array(512 - remainder));
  }
  return result;
}

function createTarball(
  entries: Array<{ name: string; type: "file" | "symlink" | "dir"; content?: string; linkname?: string }>,
): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    if (entry.type === "dir") {
      blocks.push(createTarHeader(entry.name, 0, "5"));
    } else if (entry.type === "symlink") {
      blocks.push(createTarHeader(entry.name, 0, "2", entry.linkname || ""));
    } else {
      const content = encoder.encode(entry.content || "");
      blocks.push(createTarHeader(entry.name, content.length, "0"));
      blocks.push(...padToBlock(content));
    }
  }

  // End of archive (two empty blocks)
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));

  // Combine all blocks
  const totalLength = blocks.reduce((sum, b) => sum + b.length, 0);
  const tarball = new Uint8Array(totalLength);
  let offset = 0;
  for (const block of blocks) {
    tarball.set(block, offset);
    offset += block.length;
  }

  return tarball;
}

// Skip on Windows - the bug is POSIX-only (Windows uses the correct normalized path)
const isWindows = process.platform === "win32";

describe.skipIf(isWindows)("directory path traversal prevention", () => {
  test("should not create directories outside extraction root via ../ in directory entry", async () => {
    // Create a temp dir structure:
    //   root/
    //     extract/   <-- extraction target
    //     canary/    <-- should NOT be created by extraction

    using root = tempDir("dir-traversal-root", {});
    const rootStr = String(root);
    const extractDir = join(rootStr, "extract");
    const canaryDir = join(rootStr, "canary");

    // Create the extraction directory
    const { mkdirSync } = require("fs");
    mkdirSync(extractDir, { recursive: true });

    // Craft a tarball with a directory entry that tries to escape via ../
    // The entry "../canary" should be normalized to "" or "canary" inside the extract dir,
    // NOT create a directory at the sibling level
    const maliciousTarball = createTarball([
      { name: "safe-dir/", type: "dir" },
      { name: "safe-dir/file.txt", type: "file", content: "safe content" },
      // Malicious directory entry that attempts to traverse out
      { name: "../canary/", type: "dir" },
    ]);

    const archive = new Bun.Archive(maliciousTarball);

    // Extract - this should NOT create ../canary relative to extractDir
    try {
      await archive.extract(extractDir);
    } catch {
      // It's acceptable if extraction throws for malicious paths
    }

    // The canary directory should NOT exist at the sibling level
    expect(existsSync(canaryDir)).toBe(false);

    // The safe file should have been extracted successfully
    expect(existsSync(join(extractDir, "safe-dir/file.txt"))).toBe(true);
  });

  test("should not create deeply traversed directories outside extraction root", async () => {
    using root = tempDir("dir-traversal-deep", {});
    const rootStr = String(root);
    const extractDir = join(rootStr, "a", "b", "c", "extract");
    const traversedDir = join(rootStr, "a", "b", "pwned");

    const { mkdirSync } = require("fs");
    mkdirSync(extractDir, { recursive: true });

    // Craft a tarball with deeper path traversal
    const maliciousTarball = createTarball([
      { name: "legit/", type: "dir" },
      { name: "legit/file.txt", type: "file", content: "legit content" },
      // Try to escape multiple levels
      { name: "../../pwned/", type: "dir" },
    ]);

    const archive = new Bun.Archive(maliciousTarball);

    try {
      await archive.extract(extractDir);
    } catch {
      // Acceptable if it throws
    }

    // The traversed directory should NOT exist
    expect(existsSync(traversedDir)).toBe(false);
  });
});
