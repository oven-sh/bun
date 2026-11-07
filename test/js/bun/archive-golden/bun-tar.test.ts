// Bun.Archive shows the regular files of an archive, read by the rules of the system it runs on, and
// writes them with one mode and the current time. These tests reach the tar reader and writer
// themselves, with every set of rules on any system.
import { readTar, writeTar } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  contents,
  differences,
  gzipStored,
  loadCases,
  namesToCompose,
  paxHeader,
  paxRecord,
  readerArchives,
  tarHeader,
  tarPadded,
  type ReaderFixture,
  type WriterCase,
} from "./observe";

// See record-reader.ts.
describe("the tar reader reports what libarchive did", async () => {
  const [fixture] = await loadCases<ReaderFixture>(join(import.meta.dir, "reader.json.gz"));
  const archives = await readerArchives();
  const modes = fixture.modes.map((mode, column) => [JSON.stringify(mode), mode, column] as const);
  const recorded = (index: number, column: number) => fixture.logs[fixture.cases[index][column]];

  test.each(modes)("%s", (_, mode, column) => {
    const results = archives.map(({ name, archive }, index) => ({
      index: name,
      expected: recorded(index, column),
      actual: readTar(archive, mode),
    }));
    expect(differences(results)).toBe("");
  });

  const cut = modes.filter(([, mode]) => mode.stream && (mode.skip === "none" || mode.skip === "odd"));
  test.each(cut)("however the input is cut into pieces: %s", (_, mode, column) => {
    const results = archives.map(({ name, archive }, index) => {
      // How much of a damaged gzip stream is seen before it fails depends on where the pieces end.
      const comparable = (log: string) => (archive[0] === 0x1f && !/^end$/m.test(log) ? "fails\n" : log);
      const pieceSize = archive.length > 20_000 ? [4093, 65536][index % 2] : [1, 7, 511, 512, 513][index % 5];
      return {
        index: name,
        expected: comparable(recorded(index, column)),
        actual: comparable(readTar(archive, { ...mode, pieceSize, lateEnd: index % 2 === 1 })),
      };
    });
    expect(differences(results)).toBe("");
  });
});

// The rules in short. libarchive gave the same answers.
describe("the tar reader", () => {
  const end = Buffer.alloc(1024);
  const file = (name: string, body = "x") =>
    Buffer.concat([tarHeader(name, body.length), tarPadded(Buffer.from(body))]);
  const pax = (records: Record<string, string>, then: Buffer) =>
    Buffer.concat([paxHeader(...Object.entries(records).map(([key, value]) => paxRecord(key, value))), then]);
  const x = "  data 0+1\n  end 1 crc32=8cdc1683\n";

  test("reports entries of every type", () => {
    const archive = Buffer.concat([
      tarHeader("d/", 0, "5"),
      tarHeader("l", 0, "2", "../target"),
      tarHeader("h", 0, "1", "f"),
      tarHeader("c", 0, "3"),
      tarHeader("b", 0, "4"),
      tarHeader("p", 0, "6"),
      file("f", "hello"),
      end,
    ]);
    expect(readTar(archive).replaceAll("  end 0 crc32=00000000\n", "")).toBe(
      [
        'directory perm=644 size=0 mtime=0 path="d/"',
        'symlink perm=644 size=0 mtime=0 path="l" -> "../target"',
        'type-0 perm=644 size=0 mtime=0 path="h"',
        'character-device perm=644 size=0 mtime=0 path="c"',
        'block-device perm=644 size=0 mtime=0 path="b"',
        'fifo perm=644 size=0 mtime=0 path="p"',
        'file perm=644 size=5 mtime=0 path="f"',
        "  data 0+5",
        "  end 5 crc32=3610a686",
        "end\n",
      ].join("\n"),
    );
  });

  test("stops at two empty blocks by npm's rules, and reads on otherwise", () => {
    const archive = Buffer.concat([file("a"), end, file("b"), end]);
    const [a, b] = ["a", "b"].map(name => `file perm=644 size=1 mtime=0 path="${name}"\n${x}`);
    expect(readTar(archive)).toBe(a + b + "end\n");
    expect(readTar(archive, { npm: true })).toBe(a + "end\n");
  });

  test("takes a ._ file for metadata of the entry after it on macOS", () => {
    const archive = Buffer.concat([file("._a", "metadata"), file("a"), end]);
    const a = `file perm=644 size=1 mtime=0 path="a"\n${x}end\n`;
    expect(readTar(archive, { macos: true })).toBe(a);
    expect(readTar(archive)).toBe('file perm=644 size=8 mtime=0 path="._a"\n  data 0+8\n  end 8 crc32=4f143414\n' + a);
  });

  test("composes the characters of a pax path on Windows", () => {
    const archive = Buffer.concat([pax({ path: "cafe\u0301" }, file("short")), end]);
    expect(readTar(archive)).toBe(`file perm=644 size=1 mtime=0 path="cafe\\xcc\\x81"\n${x}end\n`);
    expect(readTar(archive, { windows: true })).toBe(`file perm=644 size=1 mtime=0 path="caf\\xc3\\xa9"\n${x}end\n`);
  });

  test("puts the data of a sparse file where it belongs, which npm's rules know nothing of", () => {
    const records = {
      "GNU.sparse.major": "0",
      "GNU.sparse.minor": "0",
      "GNU.sparse.size": "5000",
      "GNU.sparse.map": "1000,3,4000,2",
    };
    const archive = Buffer.concat([pax(records, file("s", "abcde")), end]);
    expect(readTar(archive)).toBe(
      'file perm=644 size=5000 mtime=0 path="s"\n  data 1000+3\n  data 4000+2\n  end 5000 crc32=8587d865\nend\n',
    );
    expect(readTar(archive, { npm: true })).toBe(
      'file perm=644 size=5 mtime=0 path="s"\n  data 0+5\n  end 5 crc32=8587d865\nend\n',
    );
  });

  test.each([{}, { stream: true, pieceSize: 100 }])("says where an archive is cut short %j", mode => {
    const archive = Buffer.concat([file("a"), tarHeader("b", 1000), Buffer.alloc(100, "y")]);
    expect(readTar(archive, mode)).toBe(
      `file perm=644 size=1 mtime=0 path="a"\n${x}file perm=644 size=1000 mtime=0 path="b"\n  data 0+100\n` +
        "error: Truncated tar archive detected while reading data\n",
    );
  });

  // libarchive let them change the permissions.
  test("passes over ACLs", () => {
    const script = 'file perm=755 size=0 mtime=0 path="run.sh"\n  end 0 crc32=00000000\nend\n';
    const entry = tarHeader("run.sh", 0, "0", "", header => void header.write("0000755\0", 100));
    const solaris = Buffer.concat([tarHeader("run.sh", 20, "A"), tarPadded(Buffer.from("1000003\0user::rw-,x\0"))]);
    expect(readTar(Buffer.concat([solaris, entry, end]))).toBe(script);
    expect(readTar(Buffer.concat([pax({ "SCHILY.acl.access": "user::rw-,group::r--,other::r--" }, entry), end]))).toBe(
      script,
    );
    expect(readTar(Buffer.concat([pax({ "SCHILY.acl.default": "not an ACL" }, entry), end]))).toBe(script);
    expect(readTar(Buffer.concat([solaris, solaris, entry, end]))).toStartWith("error: Redundant 'A' header");
  });

  // libarchive looked for the "=" in what was left of its 64 KiB block of unpacked bytes, or in 512 bytes if that
  // was more, and passed over the rest of the header when it was not there. Only a header over 1 MiB got that far.
  test.each([1, 300, 604, 605])("reads a long pax key that starts %i bytes before the end of a block of gzip", left => {
    const filler = paxRecord("comment", Buffer.alloc(17 * 65536 - 512 - left - 17, "c"));
    const records = [filler, paxRecord(Buffer.alloc(600, "k").toString(), "1"), paxRecord("path", "renamed")];
    expect(512 + filler.length).toBe(17 * 65536 - left);
    const archive = Buffer.concat([paxHeader(...records), file("short"), end]);
    const renamed = `file perm=644 size=1 mtime=0 path="renamed"\n${x}end\n`;
    expect([archive, gzipStored(archive)].flatMap(bytes => [readTar(bytes), readTar(bytes, { stream: true })])).toEqual(
      Array(4).fill(renamed),
    );
  });

  test("refuses what is not an archive, unless it is told that it is one", () => {
    expect(readTar(Buffer.alloc(2000, "q"))).toBe("refused: Unrecognized archive format\n");
    expect(readTar(Buffer.alloc(2048, "q"), { stream: true })).toBe("end\n");
  });
});

function write({ files, windows, gzipLevel, writeSize, finish }: Omit<WriterCase, "expected">) {
  return writeTar(
    files.map(file => ({ size: Number(file.size), given: file.length, perm: file.perm, mtime: Number(file.mtime) })),
    Buffer.concat(files.map(file => Buffer.from(file.path + "00", "hex"))),
    Buffer.concat(files.map(file => contents(file.length, file.kind, file.seed))),
    { windows, gzipLevel: gzipLevel ?? undefined, writeSize, finish },
  );
}

describe("the tar writer", () => {
  const written = (name: string, windows: boolean) => {
    const tar = Buffer.from(
      writeTar([{ size: 1, given: 1, perm: 0o644, mtime: 0 }], Buffer.from(name + "\0"), Buffer.from("x"), { windows }),
    );
    return [/path="(.*)"/.exec(readTar(tar, { windows }))![1], tar.includes("hdrcharset=BINARY") ? "binary" : "utf8"];
  };

  test("records a name as it is on POSIX", () => {
    expect(written("cafe\u0301", false)).toEqual(["cafe\\xcc\\x81", "binary"]);
    expect(written("d\\e", false)).toEqual(["d\\\\e", "utf8"]);
  });

  test("composes a name and turns its backslashes on Windows", () => {
    expect(written("cafe\u0301", true)).toEqual(["caf\\xc3\\xa9", "utf8"]);
    expect(written("d\\e", true)).toEqual(["d/e", "utf8"]);
  });

  // libarchive failed such an entry.
  test("records a name with more marks than can be composed as it is on Windows", () => {
    const marks = String.fromCodePoint(0x334, 0x93c, 0x3099, 0x94d, 0x5b0, 0x5b1, 0x5b2, 0x5b3, 0x5b4, 0x5b5);
    const escaped = Array.from(Buffer.from(marks), byte => "\\x" + byte.toString(16)).join("");
    expect(written("x" + marks, true)).toEqual(["x" + escaped, "binary"]);
    expect(written("x" + marks.slice(0, -1), true)).toEqual(["x" + escaped.slice(0, -8), "utf8"]);
  });
});

// libarchive read the same names.
describe("the reader and the writer compose on Windows", () => {
  const composed: Record<string, string> = {
    "European marks": "379841 bytes crc32=243fa655",
    "marks of other scripts": "43463 bytes crc32=72de80e0",
    "class 7": "97181 bytes crc32=132ab45d",
    "class 8": "97010 bytes crc32=f78f5f27",
    "class 202": "67955 bytes crc32=32a1ef7e",
    "class 216": "67949 bytes crc32=aa8cbffa",
    "class 220": "68083 bytes crc32=0010de8b",
    "class 230 in the first plane": "441650 bytes crc32=8d01ca63",
    "class 230 in the second plane": "524259 bytes crc32=1f95bc1c",
    "class 240": "77199 bytes crc32=70cdc340",
    "classes against each other, 1 of 4": "167406 bytes crc32=1d332031",
    "classes against each other, 2 of 4": "164850 bytes crc32=45a68ed3",
    "classes against each other, 3 of 4": "175786 bytes crc32=f0a7c7e3",
    "classes against each other, 4 of 4": "133132 bytes crc32=66d2fdd4",
    "characters without a class": "230435 bytes crc32=1c014ca0",
    "Hangul consonants and vowels": "2184 bytes crc32=7a92fcc9",
    "Hangul syllables and final consonants": "48881 bytes crc32=af722c7b",
    "Hangul syllables": "77021 bytes crc32=cedcd6ca",
  };
  const withoutStart = (log: string) => log.replace(/".*"\.\.\. /, "");

  test.each(Object.entries(namesToCompose()))("%s", (names, make) => {
    const name = make();
    const written = writeTar(
      [{ size: 0, given: 0, perm: 0o644, mtime: 0 }],
      Buffer.concat([name, Buffer.alloc(1)]),
      Buffer.alloc(0),
      { windows: true },
    );
    const archive = Buffer.concat([paxHeader(paxRecord("path", name)), tarHeader("short", 0), Buffer.alloc(1024)]);
    const log = `file perm=644 size=0 mtime=0 path=${composed[names]}\n  end 0 crc32=00000000\nend\n`;
    expect({
      read: withoutStart(readTar(archive, { windows: true })),
      written: withoutStart(readTar(Buffer.from(written))),
    }).toEqual({ read: log, written: log });
  });
});

// Each output was compared with libarchive's, byte for byte, when it was recorded. A compressed or a
// long one is kept as its hash.
describe("the tar writer writes what libarchive did", async () => {
  const cases = (await loadCases<WriterCase>(join(import.meta.dir, "writer.json.gz"))).map((c, index) => ({
    ...c,
    index,
  }));
  const sha256 = (bytes: Uint8Array) =>
    `${bytes.length} bytes, sha256 ${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}\n`;
  // One header or one run of other bytes to a line.
  const blocks = (bytes: Buffer) =>
    `${bytes.length} bytes\n` +
    Array.from({ length: Math.ceil(bytes.length / 512) }, (_, i) =>
      bytes.subarray(i * 512, i * 512 + 512).toString("latin1"),
    )
      .map(block => JSON.stringify(block.replace(/\0+$/, "")))
      .join("\n") +
    "\n";

  test.each([
    ["with the names of POSIX", (c: WriterCase) => !c.windows && c.gzipLevel === null && c.finish],
    ["with the names of Windows", (c: WriterCase) => c.windows && c.gzipLevel === null && c.finish],
    ["compressed", (c: WriterCase) => c.gzipLevel !== null],
    ["for sizes that are not written out", (c: WriterCase) => !c.finish],
  ])("%s", (_, belongs) => {
    const group = cases.filter(belongs);
    expect(group.length).toBeGreaterThan(20);
    const results = group.map(c => {
      const actual = Buffer.from(write(c));
      if (!("expected" in c)) {
        return { index: c.index, expected: `${c.length} bytes, sha256 ${c.sha256}\n`, actual: sha256(actual) };
      }
      const expected = Buffer.from(c.expected, "base64");
      if (actual.equals(expected)) return { index: c.index, expected: "", actual: "" };
      return { index: c.index, expected: blocks(expected), actual: blocks(actual) };
    });
    expect(differences(results)).toBe("");
  });
});
