export type Kind =
  | "ascii-at-end"
  | "2-byte-sequence-at-end"
  | "3-byte-sequence-at-end"
  | "4-byte-sequence-at-end"
  | "continuation-byte-at-end"
  | "no-over-rollback-3byte"
  | "no-over-rollback-4byte"
  | "trim-newlines"
  | "utf-8-in-the-middle"
  | "random";

const kind: Kind = process.argv[2];

let array: Uint8Array;
if (kind === "ascii-at-end") {
  array = new Uint8Array(512);
  array.fill(97);
} else if (kind === "2-byte-sequence-at-end") {
  array = new Uint8Array(512);
  array.fill(97);
  // £
  array[254] = 0xc2;
  array[255] = 0xa3;
} else if (kind === "3-byte-sequence-at-end") {
  array = new Uint8Array(512);
  array.fill(97);
  // ⛄
  array[253] = 0xe2;
  array[254] = 0x9b;
  array[255] = 0x84;
} else if (kind === "4-byte-sequence-at-end") {
  array = new Uint8Array(512);
  array.fill(97);
  // 𒀖
  array[252] = 0xf0;
  array[253] = 0x92;
  array[254] = 0x80;
  array[255] = 0x96;
} else if (kind === "continuation-byte-at-end") {
  array = new Uint8Array(512);
  array.fill(97);
  // 3 byte sequence, but only 1 continuation byte
  array[254] = 0xe0;
  array[255] = 0x80;
} else if (kind === "no-over-rollback-3byte") {
  array = new Uint8Array(512);
  array.fill(97);
  // 3 byte sequence, but only 1 continuation byte
  array[252] = 0xe0;
  array[253] = 0x80;
  array[254] = 0xe0;
  array[255] = 0x80;
} else if (kind === "no-over-rollback-4byte") {
  array = new Uint8Array(512);
  array.fill(97);
  array[252] = 0xf0;
  array[253] = 0xf0;
  array[254] = 0x80;
  array[255] = 0x80;
} else if (kind === "random") {
  array = new Uint8Array(512);
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
    if (array[i] === 0) {
      array[i] = 0x61;
    }
  }
} else if (kind === "trim-newlines") {
  array = new Uint8Array(512);
  array.fill(97);
  array[252] = 10;
  array[253] = 10;
  array[254] = 10;
  array[255] = 0xc0;
} else if (kind === "utf-8-in-the-middle") {
  array = new Uint8Array(512);
  for (let i = 0; i < array.length; i += 2) {
    // £
    array[i] = 0xc2;
    array[i + 1] = 0xa3;
  }
  array[254] = 0xf0;
  array[255] = 0x80;
} else {
  throw new Error("Invalid kind");
}

process.stderr.write(array);
process.exit(1);
