// Archives of every shape the tar reader knows about, well formed and damaged, with what Bun.Archive
// made of each one when it was recorded. See record.ts.
import { describe, expect, test } from "bun:test";
import { isLinux, isMacOS, isPosix, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { observeExtract, observeFiles, observeTar, type Case } from "./observe";

const all: Case[] = JSON.parse(
  Buffer.from(Bun.gunzipSync(await Bun.file(join(import.meta.dir, "cases.json.gz")).bytes())).toString(),
);
const cases = all
  .map((c, index) => ({ ...c, index, archive: Buffer.from(c.data, "base64") }))
  // Recorded on Linux. Names outside ASCII are decoded differently on Windows, and macOS file
  // systems do not take all of them.
  .filter(c => isLinux || ((isMacOS ? c.mac : c.win) && !/[^\x20-\x7e\n]/.test(c.files + c.extract)));

/** One failure message that names every case that differs, instead of one test per case. */
function differences(results: { index: number; expected: string; actual: string }[]) {
  return results
    .filter(r => r.actual !== r.expected)
    .map(r => `case ${r.index}\n--- expected\n${r.expected}--- actual\n${r.actual}`)
    .slice(0, 5)
    .join("\n");
}

describe("Bun.Archive reads archives the way it was recorded to", () => {
  test("files()", async () => {
    expect(cases.length).toBeGreaterThan(500);
    const results = await Promise.all(
      cases.map(async c => ({ index: c.index, expected: c.files, actual: await observeFiles(c.archive) })),
    );
    expect(differences(results)).toBe("");
  });

  test.skipIf(!isPosix)("extract()", async () => {
    using dir = tempDir("archive-golden", {});
    const umask = process.umask(0o022);
    try {
      const results = await Promise.all(
        cases.map(async c => ({
          index: c.index,
          expected: c.extract,
          actual: await observeExtract(c.archive, join(String(dir), String(c.index))),
        })),
      );
      expect(differences(results)).toBe("");
    } finally {
      process.umask(umask);
    }
  });
});

function header(name: Buffer, size: number, type = "0") {
  const h = Buffer.alloc(512);
  name.copy(h, 0, 0, Math.min(100, name.length));
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.fill(" ", 148, 156);
  h.write(type, 156);
  h.write("ustar\0" + "00", 257);
  h.write(
    h
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return h;
}
const padded = (body: Buffer) => Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
const file = (name: Buffer | string, body = "x") =>
  Buffer.concat([header(Buffer.from(name), body.length), padded(Buffer.from(body))]);
function record(key: string, value: Buffer) {
  const rest = Buffer.concat([Buffer.from(` ${key}=`), value, Buffer.from("\n")]);
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
  return Buffer.concat([Buffer.from(String(length)), rest]);
}
function pax(path: Buffer, before: Buffer[] = []) {
  const body = Buffer.concat([...before, record("path", path)]);
  return Buffer.concat([header(Buffer.from("PaxHeader/x"), body.length, "x"), padded(body), file("short")]);
}
function gnuLongName(path: Buffer) {
  const body = Buffer.concat([path, Buffer.from([0])]);
  return Buffer.concat([header(Buffer.from("././@LongLink"), body.length, "L"), padded(body), file("short")]);
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
      binary: await read(pax(name, [record("hdrcharset", Buffer.from("BINARY"))])),
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
