import { invalidRequest, S3Error } from "./errors.ts";

export type ChecksumAlgorithm = "CRC32" | "CRC32C" | "CRC64NVME" | "SHA1" | "SHA256";
export type ChecksumType = "FULL_OBJECT" | "COMPOSITE";

export const CHECKSUM_ALGORITHMS: readonly ChecksumAlgorithm[] = ["CRC32", "CRC32C", "CRC64NVME", "SHA1", "SHA256"];

const digestLengths: Record<ChecksumAlgorithm, number> = { CRC32: 4, CRC32C: 4, CRC64NVME: 8, SHA1: 20, SHA256: 32 };

export interface Checksum {
  algorithm: ChecksumAlgorithm;
  /** Base64. A composite checksum of a multipart object has the suffix `-N`, the number of parts. */
  value: string;
  type: ChecksumType;
}

export function parseChecksumAlgorithm(
  value: string | null | undefined,
  header: string,
): ChecksumAlgorithm | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const upper = value.toUpperCase() as ChecksumAlgorithm;
  if (!CHECKSUM_ALGORITHMS.includes(upper)) {
    throw invalidRequest(
      `Checksum algorithm provided is unsupported. Please try again with any of the valid types: [CRC32, CRC32C, CRC64NVME, SHA1, SHA256]`,
    );
  }
  return upper;
}

/** `x-amz-checksum-crc32` and so on. */
export function checksumHeaderName(algorithm: ChecksumAlgorithm): string {
  return "x-amz-checksum-" + algorithm.toLowerCase();
}

/** `ChecksumCRC32` and so on, the element names in XML documents. */
export function checksumElementName(algorithm: ChecksumAlgorithm): string {
  return "Checksum" + algorithm;
}

export function isValidChecksumValue(algorithm: ChecksumAlgorithm, value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === digestLengths[algorithm] && bytes.toString("base64") === value;
}

// CRC-32C and CRC-64/NVME have no function in Bun. These implementations read
// 8 bytes in each step ("slicing by 8"). Table `k` has the CRC of a byte that
// `k` zero bytes follow.

let crc32cTables: Uint32Array[] | undefined;

function makeCrc32cTables(): Uint32Array[] {
  // CRC-32C (Castagnoli), reflected polynomial.
  const polynomial = 0x82f63b78;
  const tables = [new Uint32Array(256)];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1;
    tables[0][i] = crc;
  }
  for (let k = 1; k < 8; k++) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const previous = tables[k - 1][i];
      table[i] = (previous >>> 8) ^ tables[0][previous & 0xff];
    }
    tables.push(table);
  }
  return tables;
}

function crc32c(chunks: Uint8Array[]): number {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = (crc32cTables ??= makeCrc32cTables());
  let crc = 0xffffffff;
  for (const chunk of chunks) {
    const length = chunk.length;
    let i = 0;
    for (const end = length - 7; i < end; i += 8) {
      crc ^= chunk[i] | (chunk[i + 1] << 8) | (chunk[i + 2] << 16) | (chunk[i + 3] << 24);
      crc =
        t7[crc & 0xff] ^
        t6[(crc >>> 8) & 0xff] ^
        t5[(crc >>> 16) & 0xff] ^
        t4[crc >>> 24] ^
        t3[chunk[i + 4]] ^
        t2[chunk[i + 5]] ^
        t1[chunk[i + 6]] ^
        t0[chunk[i + 7]];
    }
    for (; i < length; i++) crc = t0[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface Crc64Tables {
  /** The high and the low 32 bits of the entries of each of the 8 tables. */
  high: Uint32Array[];
  low: Uint32Array[];
}

let crc64Tables: Crc64Tables | undefined;

function makeCrc64Tables(): Crc64Tables {
  // CRC-64/NVME, reflected polynomial.
  const polynomial = 0x9a6c9329ac4bc9b5n;
  const first: bigint[] = [];
  for (let i = 0; i < 256; i++) {
    let crc = BigInt(i);
    for (let bit = 0; bit < 8; bit++) crc = crc & 1n ? (crc >> 1n) ^ polynomial : crc >> 1n;
    first.push(crc);
  }
  const high: Uint32Array[] = [];
  const low: Uint32Array[] = [];
  let previous = first;
  for (let k = 0; k < 8; k++) {
    const entries = k === 0 ? first : previous.map(entry => (entry >> 8n) ^ first[Number(entry & 0xffn)]);
    high.push(Uint32Array.from(entries, entry => Number(entry >> 32n)));
    low.push(Uint32Array.from(entries, entry => Number(entry & 0xffffffffn)));
    previous = entries;
  }
  return { high, low };
}

function crc64nvme(chunks: Uint8Array[]): Buffer {
  const tables = (crc64Tables ??= makeCrc64Tables());
  const [h0, h1, h2, h3, h4, h5, h6, h7] = tables.high;
  const [l0, l1, l2, l3, l4, l5, l6, l7] = tables.low;
  let high = 0xffffffff;
  let low = 0xffffffff;
  for (const chunk of chunks) {
    const length = chunk.length;
    let i = 0;
    for (const end = length - 7; i < end; i += 8) {
      low ^= chunk[i] | (chunk[i + 1] << 8) | (chunk[i + 2] << 16) | (chunk[i + 3] << 24);
      high ^= chunk[i + 4] | (chunk[i + 5] << 8) | (chunk[i + 6] << 16) | (chunk[i + 7] << 24);
      const a = low & 0xff;
      const b = (low >>> 8) & 0xff;
      const c = (low >>> 16) & 0xff;
      const d = low >>> 24;
      const e = high & 0xff;
      const f = (high >>> 8) & 0xff;
      const g = (high >>> 16) & 0xff;
      const h = high >>> 24;
      low = l7[a] ^ l6[b] ^ l5[c] ^ l4[d] ^ l3[e] ^ l2[f] ^ l1[g] ^ l0[h];
      high = h7[a] ^ h6[b] ^ h5[c] ^ h4[d] ^ h3[e] ^ h2[f] ^ h1[g] ^ h0[h];
    }
    for (; i < length; i++) {
      const index = (low ^ chunk[i]) & 0xff;
      low = ((low >>> 8) | (high << 24)) ^ l0[index];
      high = (high >>> 8) ^ h0[index];
    }
  }
  const out = Buffer.alloc(8);
  out.writeUInt32BE((high ^ 0xffffffff) >>> 0, 0);
  out.writeUInt32BE((low ^ 0xffffffff) >>> 0, 4);
  return out;
}

function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}

/** The digest of the chunks, in the byte order that S3 encodes as base64. */
export function digest(algorithm: ChecksumAlgorithm, chunks: Uint8Array | Uint8Array[]): Buffer {
  const list = Array.isArray(chunks) ? chunks : [chunks];
  switch (algorithm) {
    case "CRC32": {
      let crc = 0;
      for (const chunk of list) crc = Bun.hash.crc32(chunk, crc);
      return uint32(crc);
    }
    case "CRC32C":
      return uint32(crc32c(list));
    case "CRC64NVME":
      return crc64nvme(list);
    case "SHA1":
    case "SHA256": {
      const hasher = new Bun.CryptoHasher(algorithm === "SHA1" ? "sha1" : "sha256");
      for (const chunk of list) hasher.update(chunk);
      return hasher.digest() as Buffer;
    }
  }
}

export function computeChecksum(algorithm: ChecksumAlgorithm, chunks: Uint8Array | Uint8Array[]): string {
  return digest(algorithm, chunks).toString("base64");
}

/** The checksum of a multipart object that S3 calls composite: the digest of the part digests, then `-N`. */
export function compositeChecksum(algorithm: ChecksumAlgorithm, partValues: string[]): string {
  const parts = partValues.map(value => Buffer.from(value, "base64"));
  return digest(algorithm, parts).toString("base64") + "-" + parts.length;
}

/**
 * Finds the checksum that a request declares in its headers. S3 accepts one
 * `x-amz-checksum-*` value per request.
 */
export function checksumFromHeaders(
  headers: { get(name: string): string | null },
  exclude?: (name: string) => boolean,
): { algorithm: ChecksumAlgorithm; value: string } | undefined {
  let found: { algorithm: ChecksumAlgorithm; value: string } | undefined;
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const name = checksumHeaderName(algorithm);
    if (exclude?.(name)) continue;
    const value = headers.get(name);
    if (value === null) continue;
    if (found) {
      throw invalidRequest("Expecting a single x-amz-checksum- header. Multiple checksum Types are not allowed.");
    }
    if (!isValidChecksumValue(algorithm, value)) {
      throw invalidRequest(`Value for ${name} header is invalid.`);
    }
    found = { algorithm, value };
  }
  return found;
}

export function checksumMismatch(algorithm: ChecksumAlgorithm): S3Error {
  return new S3Error("BadDigest", {
    message: `The ${algorithm} you specified did not match the calculated checksum.`,
  });
}
