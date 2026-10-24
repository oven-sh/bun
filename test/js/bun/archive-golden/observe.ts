// What a program can see of Bun.Archive, as text. `record.ts` saves it and the test compares it.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export type Case = {
  /** The archive, base64. */
  data: string;
  /** Whether macOS and Windows read it the way Linux does. */
  mac: boolean;
  win: boolean;
  files: string;
  extract: string;
};

export async function loadCases<T>(path: string): Promise<T[]> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(path).bytes())).toString());
}

/** A ustar header with mode 644 and everything else zero. */
/** One failure message for all the cases that differ, instead of one test per case. */
export function differences(results: { index: number | string; expected: string; actual: string }[]) {
  const different = results.filter(r => r.actual !== r.expected);
  if (different.length === 0) return "";
  return [
    `${different.length} of ${results.length} differ`,
    ...different
      .slice(0, 5)
      .map(
        r =>
          `${typeof r.index === "number" ? "case " : ""}${r.index}\n--- expected\n${r.expected}--- actual\n${r.actual}`,
      ),
  ].join("\n");
}

/** The options of `readTar` in `bun:internal-for-testing`. */
export type ReaderMode = {
  npm?: boolean;
  windows?: boolean;
  macos?: boolean;
  stream?: boolean;
  pieceSize?: number;
  lateEnd?: boolean;
  skip?: "none" | "all" | "odd" | "otherThanFiles";
};
export type ReaderFixture = {
  modes: ReaderMode[];
  logs: string[];
  /** For each of `readerArchives()`, the index in `logs` of what each mode reports. */
  cases: number[][];
};

const systems: ReaderMode[] = [{}, { macos: true }, { windows: true }];
/** Both sets of rules, on all three kinds of system, from memory and as a download, reading all, some or none of the contents. */
export const readerModes: ReaderMode[] = systems.flatMap(system =>
  [false, true].flatMap(npm =>
    [false, true].flatMap(stream =>
      (["none", "all", "odd", "otherThanFiles"] as const).map(skip => ({ ...system, npm, stream, skip })),
    ),
  ),
);

/** gzip with stored blocks, made by hand so that the bytes are the same whatever zlib does. */
export function gzipStored(data: Uint8Array, { flags = 0, fields = Buffer.alloc(0) } = {}) {
  const parts = [Buffer.from([0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 255]), fields];
  for (let at = 0; at === 0 || at < data.length; at += 65535) {
    const block = data.subarray(at, at + 65535);
    const head = Buffer.alloc(5);
    head[0] = at + 65535 >= data.length ? 1 : 0;
    head.writeUInt16LE(block.length, 1);
    head.writeUInt16LE(~block.length & 0xffff, 3);
    parts.push(head, Buffer.from(block));
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(Bun.hash.crc32(data), 0);
  trailer.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([...parts, trailer]);
}

export function paxRecord(key: string, value: string | Uint8Array) {
  const rest = Buffer.concat([Buffer.from(` ${key}=`), Buffer.from(value), Buffer.from("\n")]);
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
  return Buffer.concat([Buffer.from(String(length)), rest]);
}

/** Applies to the entry behind it. */
export function paxHeader(...records: Uint8Array[]) {
  const body = Buffer.concat(records);
  return Buffer.concat([tarHeader("PaxHeader/x", body.length, "x"), tarPadded(body)]);
}

/** Archives that are made here and not stored: gzip in every state of repair, and what is at or over a limit of the reader. */
function madeArchives() {
  const made: { name: string; archive: Buffer }[] = [];
  const add = (name: string, ...parts: Uint8Array[]) => void made.push({ name, archive: Buffer.concat(parts) });
  const changed = (bytes: Buffer, at: number, xor: number) => {
    const copy = Buffer.from(bytes);
    copy[at < 0 ? copy.length + at : at] ^= xor;
    return copy;
  };
  const end = Buffer.alloc(1024);
  const file = (name: string, body: Uint8Array | string = "x", type = "0") =>
    Buffer.concat([tarHeader(name, body.length, type), tarPadded(Buffer.from(body))]);
  const tar = Buffer.concat([file("a", "hello"), file("b", Buffer.alloc(600, "b")), end]);
  const gz = gzipStored(tar);

  for (let at = 0; at < gz.length; at += at < 20 || at >= gz.length - 11 ? 1 : 211)
    add(`gzip cut at ${at}`, gz.subarray(0, at));
  for (let at = 0; at < 15; at++) for (const xor of [1, 0x80]) add(`gzip byte ${at} ^ ${xor}`, changed(gz, at, xor));
  for (let at = 1; at <= 8; at++) add(`gzip byte -${at} ^ 1`, changed(gz, -at, 1));

  const fieldsOf = (flags: number) =>
    Buffer.concat([
      Buffer.from(flags & 4 ? [3, 0, 1, 2, 3] : []),
      Buffer.from(flags & 8 ? "name\0" : ""),
      Buffer.from(flags & 16 ? "comment\0" : ""),
      Buffer.from(flags & 2 ? [0, 0] : []),
    ]);
  for (let flags = 1; flags < 32; flags++) {
    const fields = fieldsOf(flags);
    add(`gzip flags ${flags}`, gzipStored(tar, { flags, fields }));
    // The same header behind a whole member, where it is the start of another member or it is nothing.
    for (let cut = 0; cut < fields.length; cut++) {
      add(`gzip flags ${flags}, header cut at ${10 + cut}`, gzipStored(tar, { flags, fields }).subarray(0, 10 + cut));
      add(
        `gzip, then flags ${flags}, header cut at ${10 + cut}`,
        gz,
        gzipStored(tar, { flags, fields }).subarray(0, 10 + cut),
      );
    }
  }
  for (const flags of [0x20, 0x40, 0x80]) add(`gzip flags ${flags}`, gzipStored(tar, { flags }));

  for (const at of [0, 1, 512, 700, 1024, 2560, tar.length]) {
    add(`gzip members split at ${at}`, gzipStored(tar.subarray(0, at)), gzipStored(tar.subarray(at)));
    add(
      `gzip members split at ${at}, second damaged`,
      gzipStored(tar.subarray(0, at)),
      changed(gzipStored(tar.subarray(at)), -6, 1),
    );
    add(
      `gzip members split at ${at}, first damaged`,
      changed(gzipStored(tar.subarray(0, at)), -6, 1),
      gzipStored(tar.subarray(at)),
    );
  }
  for (const after of [
    Buffer.alloc(1),
    Buffer.alloc(8),
    Buffer.alloc(512),
    Buffer.alloc(1024),
    Buffer.from("garbage"),
    tar,
  ]) {
    add(`gzip, then ${after.length} other bytes`, gz, after);
  }
  for (let length = 1; length <= 20; length++)
    add(`gzip, then the first ${length} bytes of another`, gz, gz.subarray(0, length));

  const layers = (bytes: Buffer, count: number) => Array.from({ length: count }).reduce<Buffer>(gzipStored, bytes);
  for (const count of [2, 3, 23, 24, 25, 26]) add(`gzip ${count} times`, layers(tar, count));
  for (const [what, damage] of [
    ["trailer damaged", (bytes: Buffer) => changed(bytes, -6, 1)],
    ["cut short", (bytes: Buffer) => bytes.subarray(0, bytes.length - 100)],
    ["followed by garbage", (bytes: Buffer) => Buffer.concat([bytes, Buffer.from("garbage")])],
    ["followed by another member", (bytes: Buffer) => Buffer.concat([bytes, gzipStored(file("c"))])],
    [
      "followed by a cut header",
      (bytes: Buffer) => Buffer.concat([bytes, Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 255, 9, 0, 0])]),
    ],
  ] as const) {
    add(`gzip in gzip, inner ${what}`, gzipStored(damage(gz)));
    add(`gzip in gzip, outer ${what}`, damage(gzipStored(gz)));
    add(`gzip in gzip in gzip, middle ${what}`, gzipStored(damage(gzipStored(gz))));
  }

  // A reader of gzip hands on 64 KiB at a time, and what fails takes the block it is in with it.
  const many = Buffer.concat(Array.from({ length: 140 }, (_, i) => file(`f${i}`, "x")));
  for (const length of [65024, 65536, 66048, 131072]) {
    for (const [what, after] of [
      ["a cut header", Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 255, 9, 0, 0])],
      ["a damaged member", changed(gzipStored(file("last")), -6, 1)],
      ["a member", gzipStored(Buffer.concat([file("last"), end]))],
      ["nothing", Buffer.alloc(0)],
    ] as const) {
      add(`gzip of ${length} bytes, then ${what}`, gzipStored(many.subarray(0, length)), after);
      add(
        `gzip in gzip of ${length} bytes, then ${what}`,
        gzipStored(Buffer.concat([gzipStored(many.subarray(0, length)), after])),
      );
    }
    add(`gzip of ${length} bytes, trailer damaged`, changed(gzipStored(many.subarray(0, length)), -6, 1));
  }
  add("a tar whose first name looks like gzip", file("\x1f\x8b\x08"), end);

  const pax = (records: Uint8Array[], then = file("short")) =>
    Buffer.concat([paxHeader(...records), then, file("after"), end]);
  for (const [key, limit] of [
    ["path", 1048576],
    ["linkpath", 1048576],
    ["GNU.sparse.name", 1048576],
    ["uname", 65536],
    ["gname", 65536],
    ["SCHILY.fflags", 511],
    ["hdrcharset", 63],
    ["LIBARCHIVE.symlinktype", 15],
    ["size", 64],
    ["uid", 64],
    ["GNU.sparse.offset", 64],
    ["mtime", 128],
    ["atime", 128],
  ] as const) {
    for (const length of [limit, limit + 1])
      add(`pax ${key} of ${length} bytes`, pax([paxRecord(key, Buffer.alloc(length, "1"))]));
  }
  for (const length of [128, 129])
    add(
      `pax SCHILY.xattr with a name of ${length} bytes`,
      pax([paxRecord("SCHILY.xattr." + Buffer.alloc(length, "n"), "v")]),
    );
  for (const key of ["GNU.sparse.map", "SUN.holesdata", "SCHILY.xattr.x", "LIBARCHIVE.xattr.x"]) {
    const limit = key.includes("xattr") ? 16 << 20 : 8 << 20;
    add(`pax ${key} over its limit`, pax([paxRecord(key, Buffer.alloc(limit + 1, "1"))]));
  }
  for (const type of ["L", "K", "V"]) {
    for (const length of [1048576, 1048577])
      add(
        `${type} header of ${length} bytes`,
        file("././@LongLink", Buffer.alloc(length, "n"), type),
        file("short"),
        end,
      );
  }
  for (const size of [16 << 20, (16 << 20) + 1])
    add(`._ file of ${size} bytes, cut short`, tarHeader("._big", size), file("after"), end);

  add("pax record with a length over the limit", pax([Buffer.from("100000000 path=x\n")]));
  add("pax record with no key", pax([Buffer.from("4 =\n"), paxRecord("path", "named")]));
  const sparse = (records: Record<string, string>, body: Uint8Array | string = "abcde") =>
    pax(
      Object.entries(records).map(([key, value]) => paxRecord(`GNU.sparse.${key}`, value)),
      file("s", body),
    );
  add("sparse 0.0, a block past the end of all numbers", sparse({ offset: "9223372036854775806", numbytes: "5" }));
  add(
    "sparse 1.0",
    sparse({ major: "1", minor: "0", realsize: "5000" }, tarPadded(Buffer.from("2\n1000\n3\n4000\n2\n")) + "abcde"),
  );
  add(
    "sparse 1.0, sized by GNU.sparse.size",
    sparse({ major: "1", minor: "0", size: "517" }, tarPadded(Buffer.from("1\n0\n5\n")) + "abcde"),
  );
  add(
    "sparse 1.0, a block past the end of all numbers",
    sparse({ major: "1", minor: "0" }, tarPadded(Buffer.from("1\n9223372036854775806\n5\n"))),
  );
  add("sparse 1.0, the map is cut short", sparse({ major: "1", minor: "0" }, "2\n1000\n"));
  add("sparse 2.0", sparse({ major: "2", minor: "0", realsize: "5000" }));
  add(
    "more stored than a size can be",
    pax([paxRecord("GNU.sparse.realsize", "5"), paxRecord("size", "1152921504606846976")]),
  );
  const oldSparse = (extensions: number) => {
    const pair = (at: number, offset: number, length: number) => (h: Buffer) => {
      h.write(offset.toString(8).padStart(11, "0") + "\0", at);
      h.write(length.toString(8).padStart(11, "0") + "\0", at + 12);
    };
    const header = tarHeader("s", 4 + extensions, "S", "", h => {
      h.write("ustar  \0", 257);
      for (let i = 0; i < 4; i++) pair(386 + i * 24, i * 1000, 1)(h);
      h[482] = extensions ? 1 : 0;
      h.write((9000).toString(8).padStart(11, "0") + "\0", 483);
    });
    const blocks = Array.from({ length: extensions }, (_, i) => {
      const block = Buffer.alloc(512);
      pair(0, 4000 + i * 1000, 1)(block);
      block[504] = i + 1 < extensions ? 1 : 0;
      return block;
    });
    return [header, ...blocks, tarPadded(Buffer.alloc(4 + extensions, "d")), file("after"), end];
  };
  for (const extensions of [0, 1, 3])
    add(`old GNU sparse with ${extensions} more blocks of map`, ...oldSparse(extensions));
  add("old GNU sparse, cut in its map", ...oldSparse(3).slice(0, 2), Buffer.alloc(100));

  const withMap = sparse(
    { major: "1", minor: "0", name: "s", realsize: "20" },
    tarPadded(Buffer.from("1\n10\n5\n")) + "hello",
  );
  for (const length of [2, 3])
    add(`sparse 1.0, cut ${length} bytes into its map`, withMap.subarray(0, withMap.indexOf("1\n10\n5\n") + length));
  for (const [offset, numbytes] of [
    ["9223372036854775807", "1"],
    ["9223372036854775806", "2"],
    ["-1", "1"],
  ])
    add(`sparse 0.0, ${numbytes} bytes at ${offset}`, sparse({ numblocks: "1", offset, numbytes, size: "5" }));
  add(
    "sparse 0.0, the length before the offset",
    sparse({ numblocks: "1", numbytes: "4611686018427387904", offset: "4611686018427387904" }),
  );

  const acl = file("a", "1000007\0user::rw-,group::r--,other::r--\0", "A");
  add("Solaris ACL", acl, file("a"), end);
  add("Solaris ACL twice", acl, acl, file("a"), end);
  add("Solaris ACL of no size", file("a", "", "A"), file("a"), end);

  // Long enough for the inner layer to have handed on a block when the outer one fails.
  const twice = layers(Buffer.concat([file("first"), file("big", Buffer.alloc(100_000, "b")), file("last"), end]), 2);
  add("long gzip in gzip, outer cut at 60%", twice.subarray(0, Math.floor(twice.length * 0.6)));
  add("long gzip in gzip, outer cut near its end", twice.subarray(0, twice.length - 700));
  add("long gzip in gzip, damaged", changed(changed(twice, twice.length >> 1, 0xff), 70_000, 0xff));

  for (const [what, at, bytes] of [
    ["time of 2^63", 136, [0x80, 0, 0, 0, 0x80]],
    ["time below -2^63", 136, [0xff, 0xff, 0xff, 0xff, 0x7f]],
    ["size of 2^63", 124, [0x80, 0, 0, 0, 0x80]],
  ] as const) {
    const number = Buffer.concat([Buffer.from(bytes), Buffer.alloc(7)]);
    add(
      `base-256 ${what}`,
      tarHeader("m", 1, "0", "", h => void number.copy(h, at)),
      tarPadded(Buffer.from("x")),
      end,
    );
  }
  for (const size of [2 ** 30, 2 ** 30 + 1])
    add(`pax header that announces ${size} bytes`, tarHeader("PaxHeader/x", size, "x"), file("a"), end);
  for (const bytes of [
    [0x61, 0xf0, 0x41, 0x80, 0x80],
    [0x61, 0xf0, 0x9f, 0x98, 0x41],
  ])
    add(`pax path ${Buffer.from(bytes).toString("hex")}`, pax([paxRecord("path", Buffer.from(bytes))]));

  // Names that Windows composes, and ones it cannot.
  let state = 1;
  const random = (below: number) => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8) % below;
  const pick = <T>(from: T[]) => from[random(from.length)];
  const bases = [
    ..."aAeEoOuUiIcCnNsSyY<=>\u00a8\u00c2\u00ca\u01a1\u0391\u03b1\u0415\u0627\u0928\u09c7\u1025\u1100\u1112\uac00\uac01",
  ].concat([..."\u1e36\u1f00\u2190\u3046\u304b\u30ab\u212b\ufb01\u{11099}\u{1d157}"]);
  const marks = [
    0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x30a, 0x30b, 0x30c, 0x323, 0x327, 0x328, 0x331, 0x338,
  ]
    .concat([
      0x342, 0x345, 0x3099, 0x309a, 0x5b0, 0x5bc, 0x93c, 0x653, 0x654, 0x655, 0x1161, 0x1162, 0x1175, 0x11a8, 0x11c2,
    ])
    .concat([0x9be, 0x9d7, 0x102e, 0x110ba, 0x1d165, 0x1d16e]);
  const notUtf8 = ["ff", "eda080", "c3", "f4908080", "c0af", "e282"].map(hex => Buffer.from(hex, "hex"));
  for (let archive = 0; archive < 5; archive++) {
    const entries = Array.from({ length: 80 }, () => {
      const clusters = Array.from({ length: 1 + random(4) }, () => {
        const cluster =
          pick(bases) +
          String.fromCodePoint(...Array.from({ length: pick([0, 0, 1, 1, 2, 3, 4, 9, 10, 11]) }, () => pick(marks)));
        return random(12) === 0 ? Buffer.concat([Buffer.from(cluster), pick(notUtf8)]) : Buffer.from(cluster);
      });
      return Buffer.concat([paxHeader(paxRecord("path", Buffer.concat(clusters))), tarHeader("short", 0)]);
    });
    add(`names to compose ${archive}`, ...entries, end);
  }
  return made;
}

/**
 * Long names of short clusters with a "_" after each. Between them they hold every pair that Windows
 * composes, beside many more that it does not, and sort the combining classes into nine groups.
 */
export function namesToCompose(): Record<string, () => Buffer> {
  const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
  // From the space on, without surrogates and without the backslash, which the writer makes a slash.
  function blocks(...numbers: number[]) {
    const characters: number[] = [];
    for (const block of numbers) {
      for (let c = Math.max(block << 8, 0x20); c <= ((block << 8) | 0xff); c++) {
        if ((c < 0xd800 || c > 0xdfff) && c !== 0x5c) characters.push(c);
      }
    }
    return characters;
  }
  function name(characters: Uint32Array) {
    let text = "";
    for (let at = 0; at < characters.length; at += 4096) {
      text += String.fromCodePoint.apply(null, characters.subarray(at, at + 4096) as unknown as number[]);
    }
    return Buffer.from(text);
  }
  function pairs(firsts: number[], seconds: number[]) {
    const characters = new Uint32Array(firsts.length * seconds.length * 3).fill(0x5f);
    let at = 0;
    for (const first of firsts) {
      for (const second of seconds) {
        characters[at] = first;
        characters[at + 1] = second;
        at += 3;
      }
    }
    return name(characters);
  }
  // Whether the mark composes with the base depends on the class of what stands between them.
  function between(base: number, mark: number, middles: number[]) {
    const characters = new Uint32Array(middles.length * 4).fill(0x5f);
    let at = 0;
    for (const middle of middles) {
      characters[at] = base;
      characters[at + 1] = middle;
      characters[at + 2] = mark;
      at += 4;
    }
    return name(characters);
  }

  const european = [...range(0x300, 0x30c), 0x30f, 0x311, 0x313, 0x314, 0x31b, ...range(0x323, 0x328)].concat([
    0x32d, 0x32e, 0x330, 0x331, 0x338, 0x342, 0x345,
  ]);
  const others = [0x653, 0x654, 0x655, 0x93c, 0x9be, 0x9d7, 0xb3e, 0xb56, 0xb57, 0xbbe, 0xbd7, 0xc56, 0xcc2].concat([
    0xcd5, 0xcd6, 0xd3e, 0xd57, 0xdca, 0xdcf, 0xddf, 0x102e, 0x1b35, 0x3099, 0x309a, 0x110ba,
  ]);
  const withMarks = () =>
    blocks(...range(0x03, 0x10), 0x13, ...range(0x17, 0x1d), 0x20, 0x2c, 0x2d, 0x30, 0xa6).concat(
      blocks(...range(0xa8, 0xab), 0xfb, 0xfe, 0x101, 0x10a, 0x110, 0x1d1, 0x1d2),
    );
  // With the character on either side of them.
  const syllables = range(0xabff, 0xd7a4);

  return {
    "European marks": () => pairs(blocks(0, 1, 2, 3, 4, 0x1e, 0x1f, 0x21, 0x22), european),
    "marks of other scripts": () => Buffer.concat(others.map(mark => pairs(blocks(mark >> 8), [mark]))),
    "class 7": () => between(0x928, 0x93c, withMarks()),
    "class 8": () => between(0x304b, 0x3099, withMarks()),
    "class 202": () => between(0x61, 0x328, withMarks()),
    "class 216": () => between(0x6f, 0x31b, withMarks()),
    "class 220": () => between(0x61, 0x323, withMarks()),
    "class 230 in the first plane": () => between(0x61, 0x301, blocks(...range(0, 0xff))),
    "class 230 in the second plane": () => between(0x61, 0x301, blocks(...range(0x100, 0x1ff))),
    "class 240": () => between(0x3b1, 0x345, withMarks()),
    "Hangul consonants and vowels": () => pairs(range(0x10ff, 0x1113), range(0x1160, 0x1176)),
    "Hangul syllables and final consonants": () =>
      pairs(
        syllables.filter(syllable => (syllable - 0xac00) % 28 === 0),
        range(0x11a7, 0x11c3),
      ),
    "Hangul syllables": () => pairs(syllables, [0x11a8]),
  };
}

/** Every archive that `readTar` is tried on. */
export async function readerArchives() {
  const stored = async (file: string, name: string) =>
    (await loadCases<{ data: string }>(join(import.meta.dir, file))).map((c, index) => ({
      name: `${name} ${index}`,
      archive: Buffer.from(c.data, "base64"),
    }));
  return [
    ...(await stored("cases.json.gz", "case")),
    ...(await stored("reader-cases.json.gz", "reader case")),
    ...madeArchives(),
  ];
}

export type WriterCase = {
  files: {
    /** Hex. */
    path: string;
    /** The arguments of `contents`. */
    length: number;
    kind: number;
    seed: number;
    /** What the header announces, which need not be `length`. */
    size: string;
    perm: number;
    mtime: string;
  }[];
  windows: boolean;
  gzipLevel: number | null;
  writeSize: number;
  finish: boolean;
} & ({ expected: string } | { length: number; sha256: string });

/** What a file of a `WriterCase` holds. */
export function contents(length: number, kind: number, seed: number) {
  if (kind === 2) return Buffer.alloc(length, "const x = require('y');\n");
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = kind === 1 ? i / 7 : seed >>> 16;
  }
  return bytes;
}

/** The arguments of a record.ts, which has to be told that it may replace what libarchive did. */
export function recordArguments() {
  const args = process.argv.slice(2);
  if (!process.versions.libarchive && !args.includes("--accept")) {
    throw new Error(
      `Bun ${Bun.version} does not use libarchive, so this would record the code under test. ` +
        "Run it with Bun 1.4.4, or pass --accept after a change that is meant.",
    );
  }
  return args.filter(arg => arg !== "--accept");
}

export function tarHeader(
  name: Buffer | string,
  size: number,
  type = "0",
  linkname = "",
  /** Changes the header before its checksum is taken. */
  change: (header: Buffer) => void = () => {},
) {
  const h = Buffer.alloc(512);
  Buffer.from(name).copy(h, 0, 0, 100);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.fill(" ", 148, 156);
  h.write(type, 156);
  h.write(linkname, 157);
  h.write("ustar\0" + "00", 257);
  change(h);
  h.write(
    h
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return h;
}

export const tarPadded = (body: Buffer) => Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);

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
