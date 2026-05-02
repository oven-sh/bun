import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

// Helper to create a tar archive containing a file with a very long name.
// Uses PAX extended headers (type 'x') to store the long filename, which
// is the standard way tar handles names > 100 bytes.
function createTarWithLongFilename(longName: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  const blocks: Uint8Array[] = [];

  // --- PAX extended header block ---
  // The PAX header contains "path=<longname>\n"
  const paxPayload = encodePaxPayload(longName);
  const paxPayloadBytes = encoder.encode(paxPayload);
  const paxDataBlocks = Math.ceil(paxPayloadBytes.length / 512);

  // PAX header entry (type 'x')
  const paxHeader = new Uint8Array(512);
  writeTarField(paxHeader, 0, 100, "PaxHeader/longname"); // name
  writeTarField(paxHeader, 100, 8, "0000644"); // mode
  writeTarField(paxHeader, 108, 8, "0000000"); // uid
  writeTarField(paxHeader, 116, 8, "0000000"); // gid
  writeTarField(paxHeader, 124, 12, padOctal(paxPayloadBytes.length, 11)); // size
  writeTarField(paxHeader, 136, 12, padOctal(0, 11)); // mtime
  paxHeader[156] = 0x78; // typeflag = 'x' (PAX extended header)
  writeTarField(paxHeader, 257, 6, "ustar"); // magic
  writeTarField(paxHeader, 263, 2, "00"); // version
  fillChecksum(paxHeader);

  blocks.push(paxHeader);

  // PAX data blocks
  const paxData = new Uint8Array(paxDataBlocks * 512);
  paxData.set(paxPayloadBytes);
  blocks.push(paxData);

  // --- Actual file header ---
  const fileHeader = new Uint8Array(512);
  // Use a truncated name in the header (PAX path overrides it)
  const truncatedName = longName.slice(0, 99);
  writeTarField(fileHeader, 0, 100, truncatedName); // name (will be overridden by PAX)
  writeTarField(fileHeader, 100, 8, "0000644"); // mode
  writeTarField(fileHeader, 108, 8, "0000000"); // uid
  writeTarField(fileHeader, 116, 8, "0000000"); // gid
  writeTarField(fileHeader, 124, 12, padOctal(contentBytes.length, 11)); // size
  writeTarField(fileHeader, 136, 12, padOctal(0, 11)); // mtime
  fileHeader[156] = 0x30; // typeflag = '0' (regular file)
  writeTarField(fileHeader, 257, 6, "ustar"); // magic
  writeTarField(fileHeader, 263, 2, "00"); // version
  fillChecksum(fileHeader);

  blocks.push(fileHeader);

  // File data blocks
  const fileDataBlocks = Math.ceil(contentBytes.length / 512);
  const fileData = new Uint8Array(fileDataBlocks * 512);
  fileData.set(contentBytes);
  blocks.push(fileData);

  // --- Normal file with short name ---
  const normalContent = encoder.encode("normal file content");
  const normalHeader = new Uint8Array(512);
  writeTarField(normalHeader, 0, 100, "normal.txt");
  writeTarField(normalHeader, 100, 8, "0000644");
  writeTarField(normalHeader, 108, 8, "0000000");
  writeTarField(normalHeader, 116, 8, "0000000");
  writeTarField(normalHeader, 124, 12, padOctal(normalContent.length, 11));
  writeTarField(normalHeader, 136, 12, padOctal(0, 11));
  normalHeader[156] = 0x30;
  writeTarField(normalHeader, 257, 6, "ustar");
  writeTarField(normalHeader, 263, 2, "00");
  fillChecksum(normalHeader);

  blocks.push(normalHeader);

  const normalDataBlocks = Math.ceil(normalContent.length / 512);
  const normalData = new Uint8Array(normalDataBlocks * 512);
  normalData.set(normalContent);
  blocks.push(normalData);

  // End-of-archive marker (two zero blocks)
  blocks.push(new Uint8Array(1024));

  // Concatenate all blocks
  const totalSize = blocks.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }

  return result;
}

function writeTarField(header: Uint8Array, offset: number, length: number, value: string) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  for (let i = 0; i < Math.min(bytes.length, length - 1); i++) {
    header[offset + i] = bytes[i];
  }
}

function padOctal(num: number, width: number): string {
  return num.toString(8).padStart(width, "0");
}

function fillChecksum(header: Uint8Array) {
  // Fill checksum field with spaces first
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20; // space
  }
  // Calculate checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += header[i];
  }
  const checksumStr = padOctal(sum, 6);
  writeTarField(header, 148, 7, checksumStr);
  header[154] = 0; // null terminator
  header[155] = 0x20; // space
}

function encodePaxPayload(longName: string): string {
  const entry = "path=" + longName + "\n";
  // PAX format: "<length> <entry>\n" where length includes itself
  // We need to figure out the total length including the length prefix
  let prefix = String(entry.length + 2);
  let total = prefix.length + 1 + entry.length;
  // Adjust if total length changed the prefix length
  prefix = String(total);
  if (prefix.length + 1 + entry.length !== total) {
    total = prefix.length + 1 + entry.length;
    prefix = String(total);
  }
  return prefix + " " + entry;
}

test("extraction skips files with names exceeding filesystem limit (#27078)", async () => {
  using dir = tempDir("issue-27078", {});

  // Create a filename with 256 characters in a single component - exceeds the 255-byte
  // NAME_MAX limit on ext4/tmpfs, and will definitely exceed ecryptfs's ~143-byte limit.
  const longName = "a".repeat(256) + ".txt";

  const tarBytes = createTarWithLongFilename(longName, "long name content");

  // Extract using Bun.Archive - this should NOT throw.
  // The file with the too-long name should be skipped, but normal.txt should be extracted.
  const archive = new Bun.Archive(tarBytes);
  const count = await archive.extract(String(dir));

  // The normal file should have been extracted successfully
  const normalContent = await Bun.file(join(String(dir), "normal.txt")).text();
  expect(normalContent).toBe("normal file content");

  // The file with the too-long name should NOT exist (it was skipped)
  expect(await Bun.file(join(String(dir), longName)).exists()).toBe(false);
});

test("extraction succeeds with filenames at exactly the filesystem limit (#27078)", async () => {
  using dir = tempDir("issue-27078-exact", {});

  // 255 bytes is exactly the NAME_MAX on most Linux filesystems - should work
  const exactLimitName = "b".repeat(251) + ".txt"; // 255 bytes total
  const tarBytes = createTarWithLongFilename(exactLimitName, "exact limit content");

  const archive = new Bun.Archive(tarBytes);
  const count = await archive.extract(String(dir));

  // The file at exactly the limit should be extracted
  const content = await Bun.file(join(String(dir), exactLimitName)).text();
  expect(content).toBe("exact limit content");

  // Normal file should also be extracted
  const normalContent = await Bun.file(join(String(dir), "normal.txt")).text();
  expect(normalContent).toBe("normal file content");
});
