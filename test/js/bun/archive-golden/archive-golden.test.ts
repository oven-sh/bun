// Archives of every shape the tar reader knows about, well formed and damaged, with what Bun.Archive
// made of each one when it was recorded. See record.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isPosix, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  differences,
  loadCases,
  observeExtract,
  observeFiles,
  observeTar,
  paxHeader,
  paxRecord,
  tarHeader,
  tarPadded,
  type Case,
} from "./observe";

const all = await loadCases<Case>(join(import.meta.dir, "cases.json.gz"));
const cases = all
  .map((c, index) => ({ ...c, index, archive: Buffer.from(c.data, "base64") }))
  // Recorded on Linux. Names outside ASCII are decoded differently on Windows, and macOS file
  // systems do not take all of them.
  .filter(c => isLinux || ((isMacOS ? c.mac : c.win) && !/[^\x20-\x7e\n]/.test(c.files + c.extract)));

// What a refused archive leaves behind depends on which error a system call fails with, and that
// differs between systems: opening "dir/" for writing is EISDIR on Linux and ENOENT on macOS.
const comparable = (extracted: string) => (!isLinux && extracted.startsWith("rejected\n") ? "rejected\n" : extracted);

describe("Bun.Archive reads archives the way it was recorded to", () => {
  test("files()", async () => {
    expect(cases.length).toBeGreaterThan(500);
    const results = await Promise.all(
      cases.map(async c => ({ index: c.index, expected: c.files, actual: await observeFiles(c.archive) })),
    );
    expect(differences(results)).toBe("");
  });

  // The recorded trees have permission bits, links and names that Windows does not.
  test.skipIf(!isPosix)("extract()", async () => {
    using dir = tempDir("archive-golden", {});
    const umask = process.umask(0o022);
    try {
      const results = await Promise.all(
        cases.map(async c => ({
          index: c.index,
          expected: comparable(c.extract),
          actual: comparable(await observeExtract(c.archive, join(String(dir), String(c.index)))),
        })),
      );
      expect(differences(results)).toBe("");
    } finally {
      process.umask(umask);
    }
  });

  // Without openat2 or O_RESOLVE_BENEATH, other code has to come to the same results.
  test.skipIf(!isPosix)("extract() when the kernel is not asked to resolve paths", async () => {
    using dir = tempDir("archive-golden", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "extract-fixture.ts"), String(dir)],
      env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const observed: string[] = JSON.parse(stdout);
    const results = cases.map(c => ({
      index: c.index,
      expected: comparable(c.extract),
      actual: comparable(observed[c.index]),
    }));
    expect(differences(results)).toBe("");
  });
});

const file = (name: Buffer | string, body = "x") =>
  Buffer.concat([tarHeader(name, body.length), tarPadded(Buffer.from(body))]);
const pax = (path: Buffer, before: Buffer[] = []) =>
  Buffer.concat([paxHeader(...before, paxRecord("path", path)), file("short")]);
function gnuLongName(path: Buffer) {
  const body = Buffer.concat([path, Buffer.from([0])]);
  return Buffer.concat([tarHeader("././@LongLink", body.length, "L"), tarPadded(body), file("short")]);
}
const end = Buffer.alloc(1024);
const units = (s: string) =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, "0")).join(" ");
const names = async (...parts: Buffer[]) => [...(await new Bun.Archive(Buffer.concat(parts)).files()).keys()];

// Measured with Bun 1.4.4 on Linux and macOS and Bun 1.4.3 on Windows.
describe("entry names", () => {
  test.each([
    // name, POSIX, Windows unless it is a pax path, Windows pax path
    ["63c3a9", "0063 00e9", "0063 00c3 00a9", "0063 00e9"],
    ["6365cc81", "0063 0065 0301", "0063 0065 00cc 0081", "0063 00e9"],
    ["63e284ab", "0063 212b", "0063 00e2 0084 00ab", "0063 212b"],
    ["63e18492e185a1", "0063 1112 1161", "0063 00e1 0084 0092 00e1 0085 00a1", "0063 d558"],
    ["63efac81", "0063 fb01", "0063 00ef 00ac 0081", "0063 fb01"],
    ["63f09f9880", "0063 d83d de00", "0063 00f0 009f 0098 0080", "0063 d83d de00"],
    ["63fffe", "0063 fffd fffd", "0063 00ff 00fe", "0063 00ff 00fe"],
    ["63c3a9ff", "0063 00e9 fffd", "0063 00c3 00a9 00ff", "0063 00c3 00a9 00ff"],
    ["63eda080", "0063 fffd fffd fffd", "0063 00ed 00a0 0080", "0063 00ed 00a0 0080"],
    ["645c65", "0064 005c 0065", "0064 005c 0065", "0064 005c 0065"],
    ["643a65", "0064 003a 0065", "0064 003a 0065", "0064 003a 0065"],
  ])("%s", async (hex, posix, windowsBytes, windowsPax) => {
    const name = Buffer.from(hex, "hex");
    const read = async (tar: Buffer) => (await names(tar, end)).map(units);
    expect({
      ustar: await read(file(name)),
      pax: await read(pax(name)),
      binary: await read(pax(name, [paxRecord("hdrcharset", "BINARY")])),
      gnu: await read(gnuLongName(name)),
    }).toEqual({
      ustar: [isWindows ? windowsBytes : posix],
      pax: [isWindows ? windowsPax : posix],
      binary: [isWindows ? windowsBytes : posix],
      gnu: [isWindows ? windowsBytes : posix],
    });
  });

  test("a ._ file belongs to the entry after it on macOS only", async () => {
    expect(await names(file("._a"), file("a"), end)).toEqual(isMacOS ? ["a"] : ["._a", "a"]);
    const nothingAfter = /end-of-archive within a sequence of headers/;
    for (const tar of [[file("._a"), end], [file("._a")], [file("a"), file("._z"), end]]) {
      if (isMacOS) await expect(names(...tar)).rejects.toThrow(nothingAfter);
      else expect((await names(...tar)).at(-1)).toStartWith("._");
    }
  });
});

describe("header checksum", () => {
  // The linkname field holds the bytes over 127, which a regular file makes no use of.
  const withChecksum = (sum: (bytes: Buffer) => number) => {
    const header = tarHeader("a", 0);
    header.fill(0xe9, 157, 200);
    header.fill(" ", 148, 156);
    header.write(sum(header).toString(8).padStart(6, "0") + "\0 ", 148);
    return header;
  };
  const unsigned = (bytes: Buffer) => bytes.reduce((a, b) => a + b, 0);
  const signed = (bytes: Buffer) => new Int8Array(bytes).reduce((a, b) => a + b, 0);

  test.each([
    ["of unsigned bytes", unsigned, 0, ["first", "a", "last"]],
    ["of signed bytes, as some old tars wrote it", signed, 0, ["first", "a", "last"]],
    ["that is off by one", unsigned, 1, ["first", "last"]],
    ["of signed bytes that is off by one", signed, -1, ["first", "last"]],
  ] as const)("%s", async (_, sum, off, expected) => {
    const header = withChecksum(bytes => sum(bytes) + off);
    expect(await names(file("first"), header, file("last"), end)).toEqual([...expected]);
  });
});

describe("Bun.Archive writes archives the way it was recorded to", () => {
  const write = async (files: Record<string, string | Uint8Array>, options?: Bun.ArchiveOptions) => {
    const started = Math.floor(Date.now() / 1000);
    const bytes = await new Bun.Archive(files, options).bytes();
    return observeTar(options?.compress ? Bun.gunzipSync(bytes) : bytes, started);
  };
  const n = (count: number) => Buffer.alloc(count, "n").toString();

  // The snapshots come from the same Bun as cases.json.gz.
  test.each([
    ["nothing", {}],
    ["one file", { "a.txt": "x" }],
    ["empty file", { "a": "" }],
    ["block sizes", { "511": n(511), "512": n(512), "513": n(513), "9999": n(9999), "10240": n(10240) }],
    ["directories in names", { "a/b/c.txt": "x", "a/": "", "./d": "x", "/abs": "x", "../up": "x", "a//b": "x" }],
    ["name of 99", { [n(99)]: "x" }],
    ["name of 100", { [n(100)]: "x" }],
    ["name of 101", { [n(101)]: "x" }],
    ["name of 300", { [n(300)]: "x" }],
    ["prefix of 1", { ["d/" + n(100)]: "x" }],
    ["prefix of 154", { [n(154) + "/" + n(100)]: "x" }],
    ["prefix of 155", { [n(155) + "/" + n(100)]: "x" }],
    ["prefix of 156", { [n(156) + "/" + n(100)]: "x" }],
    ["prefix then name of 101", { ["d/" + n(101)]: "x" }],
    ["many parts", { [Array(60).fill("dir").join("/") + "/f"]: "x" }],
    ["many long parts", { [Array(8).fill(n(90)).join("/")]: "x" }],
    ["long with a trailing slash", { [n(120) + "/"]: "" }],
    ["long name ending in a dot", { ["d/" + n(120) + "/."]: "x" }],
    ["control characters", { "a\nb": "x", "a\tb": "x", "a=b": "x", " ": "x" }],
    ["binary data", { "bin": new Uint8Array(1000).map((_, i) => i * 7) }],
    ["a hundred files", Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`dir${i % 7}/file${i}`, n(i * 13)]))],
  ] as [string, Record<string, string | Uint8Array>][])("%s", async (_, files) => {
    const plain = await write(files);
    expect(plain).toMatchSnapshot();
    expect(await write(files, { compress: "gzip" })).toBe(plain);
  });

  test.each([
    [
      "cé",
      "323120686472636861727365743d42494e4152590a313220706174683d63c3a90a",
      "63c3a9",
      "313220706174683d63c3a90a",
      "63c3a9",
    ],
    [
      "cé",
      "323120686472636861727365743d42494e4152590a313320706174683d6365cc810a",
      "6365cc81",
      "313220706174683d63c3a90a",
      "63c3a9",
    ],
    [
      "a\ud800b",
      "323120686472636861727365743d42494e4152590a313420706174683d61efbfbd620a",
      "61efbfbd62",
      "313420706174683d61efbfbd620a",
      "61efbfbd62",
    ],
  ])("name outside ASCII %j", async (name, posixPax, posixName, windowsPax, windowsName) => {
    const [paxRecords, stored] = isWindows ? [windowsPax, windowsName] : [posixPax, posixName];
    const lines = (await write({ [name]: "x" })).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "10240 bytes",
      `type=x name=${Buffer.from("PaxHeader/").toString("hex")}${stored} prefix= mode=000644  size=${paxRecords.length / 2} checksum=ok mtime=now`,
      `  pax=${paxRecords}`,
      `type=0 name=${stored} prefix= mode=000644  size=1 checksum=ok mtime=now`,
    ]);
  });

  test("a backslash is a separator on Windows only", async () => {
    expect((await write({ "d\\e": "x" })).split("\n")[1]).toBe(
      `type=0 name=${isWindows ? "642f65" : "645c65"} prefix= mode=000644  size=1 checksum=ok mtime=now`,
    );
  });
});

// Measured with Bun 1.4.4.
describe("gzip inside gzip", () => {
  function gzip(data: Uint8Array, { name = 0, badCrc = false } = {}) {
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE((Bun.hash.crc32(data) ^ Number(badCrc)) >>> 0, 0);
    trailer.writeUInt32LE(data.length >>> 0, 4);
    return Buffer.concat([
      Buffer.from([0x1f, 0x8b, 8, name ? 8 : 0, 0, 0, 0, 0, 0, 255]),
      name ? Buffer.alloc(name + 1, "n").fill(0, name) : Buffer.alloc(0),
      Bun.deflateSync(data),
      trailer,
    ]);
  }
  const tar = Buffer.concat([file("a"), end]);
  const incompressible = (length: number) => {
    let state = 1;
    return Buffer.from(Array.from({ length }, () => (state = (state * 48271) % 2147483647) & 0xff));
  };

  test("is unwrapped 24 times and no more", async () => {
    let wrapped = tar;
    for (let i = 0; i < 24; i++) wrapped = gzip(wrapped);
    expect(await names(wrapped)).toEqual(["a"]);
    await expect(names(gzip(wrapped))).rejects.toThrow("Input requires too many filters for decoding");
  });

  // Each leaves less than a tar header, or less than the inner gzip header, in the outer layer's first 64 KiB.
  test.each([65225, 65485, 66000, 140000])("is recognized behind an inner header of %d bytes", async name => {
    expect(await names(gzip(gzip(tar, { name })))).toEqual(["a"]);
  });

  test("an inner name has to end within 1 MiB", async () => {
    expect(await names(gzip(gzip(tar, { name: 1048576 - 10 })))).toEqual(["a"]);
    await expect(names(gzip(gzip(tar, { name: 1048576 - 9 })))).rejects.toThrow("Unrecognized archive format");
    expect(await names(gzip(tar, { name: 1048576 + 100 }))).toEqual(["a"]);
  });

  test("the outer layer is read no further than the inner one needs", async () => {
    const inner = Buffer.concat([gzip(tar), incompressible(200_000)]);
    expect(await names(gzip(inner, { badCrc: true }))).toEqual(["a"]);
    expect(await names(gzip(inner).subarray(0, 150_000))).toEqual(["a"]);
    await expect(names(gzip(gzip(tar), { badCrc: true }))).rejects.toThrow("gzip trailer mismatch");
  });

  test("what follows a member that ends with a 64 KiB block does not spoil that block", async () => {
    const block = Buffer.concat([file("a", Buffer.alloc(64000, "x").toString()), end]);
    expect(block.length).toBe(65536);
    // A header that announces nine bytes of extra field and ends after one.
    const cutHeader = Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 255, 9, 0, 0]);
    using dir = tempDir("archive-golden-member", {});
    const archive = new Bun.Archive(gzip(Buffer.concat([gzip(block), cutHeader])));
    await expect(archive.extract(String(dir))).rejects.toThrow("ReadError");
    expect(readdirSync(String(dir))).toEqual(["a"]);
  });
});
