// https://github.com/oven-sh/bun/issues/32159 — the ad-hoc signer must hash the last partial page unpadded and end the file at the signature.

import { describe, expect, test } from "bun:test";
import { linkSync, readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";
import { run } from "../aot/harness/run";

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const PAGE_SIZE = 0x1000;

// Not page-aligned on purpose, so the last hashed page is partial.
const TEMPLATE_SIG_OFF = 0x8100;

// Larger than the ad-hoc signature, so a missing truncate leaves a stale tail.
const TEMPLATE_SIG_SIZE = 0x2000;

type TextSection = { name: string; offset: number; size: number };

// Minimal arm64 Mach-O: __TEXT, __BUN with one __bun section, __LINKEDIT ending in LC_CODE_SIGNATURE.
function machoTemplate(textSize = 0x4000, textSections: TextSection[] = []): Buffer {
  // What lies behind __TEXT, by how much it is further back than with the default size.
  const moved = textSize - 0x4000;
  const fileSize = TEMPLATE_SIG_OFF + TEMPLATE_SIG_SIZE + moved;
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const sigCmdSize = 16; // sizeof(linkedit_data_command)
  const textCmdSize = segCmdSize + sectSize * textSections.length;
  const sizeofcmds = textCmdSize + (segCmdSize + sectSize) + segCmdSize + sigCmdSize;

  // Non-zero fill so pages (especially the partial last one) hash real content.
  const buf = Buffer.alloc(fileSize, 0xc3);
  const writeName = (off: number, name: string) => {
    buf.fill(0, off, off + 16);
    buf.write(name, off, 16, "latin1");
  };

  // mach_header_64
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(CPU_TYPE_ARM64, 4);
  buf.writeInt32LE(0, 8); // cpusubtype
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(4, 16); // ncmds
  buf.writeUInt32LE(sizeofcmds, 20);
  buf.writeUInt32LE(0, 24); // flags
  buf.writeUInt32LE(0, 28); // reserved

  // LC_SEGMENT_64 __TEXT [0, textSize)
  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(textCmdSize, o + 4);
  writeName(o + 8, "__TEXT");
  buf.writeBigUInt64LE(0x1_0000_0000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(BigInt(textSize), o + 32); // vmsize
  buf.writeBigUInt64LE(0n, o + 40); // fileoff
  buf.writeBigUInt64LE(BigInt(textSize), o + 48); // filesize
  buf.writeInt32LE(5, o + 56); // maxprot r-x
  buf.writeInt32LE(5, o + 60); // initprot
  buf.writeUInt32LE(textSections.length, o + 64); // nsects

  o += segCmdSize;
  for (const { name, offset, size } of textSections) {
    buf.fill(0, o, o + sectSize);
    writeName(o, name);
    writeName(o + 16, "__TEXT");
    buf.writeBigUInt64LE(0x1_0000_0000n + BigInt(offset), o + 32); // addr
    buf.writeBigUInt64LE(BigInt(size), o + 40); // size
    buf.writeUInt32LE(offset, o + 48); // offset
    o += sectSize;
  }

  // LC_SEGMENT_64 __BUN [0x4000, 0x8000) with one __bun section
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize + sectSize, o + 4);
  writeName(o + 8, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n + BigInt(moved), o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x4000n + BigInt(moved), o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(3, o + 56); // maxprot rw-
  buf.writeInt32LE(3, o + 60); // initprot
  buf.writeUInt32LE(1, o + 64); // nsects

  // section_64 __bun
  o += segCmdSize;
  writeName(o, "__bun");
  writeName(o + 16, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n + BigInt(moved), o + 32); // addr
  buf.writeBigUInt64LE(0x4000n, o + 40); // size
  buf.writeUInt32LE(0x4000 + moved, o + 48); // offset
  buf.writeUInt32LE(14, o + 52); // align = 2^14

  // LC_SEGMENT_64 __LINKEDIT [0x8000, fileSize)
  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0000_8000n + BigInt(moved), o + 24); // vmaddr
  buf.writeBigUInt64LE(0x3000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x8000n + BigInt(moved), o + 40); // fileoff
  buf.writeBigUInt64LE(BigInt(fileSize - 0x8000 - moved), o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot r--
  buf.writeInt32LE(1, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_CODE_SIGNATURE (linkedit_data_command)
  o += segCmdSize;
  buf.writeUInt32LE(LC_CODE_SIGNATURE, o);
  buf.writeUInt32LE(sigCmdSize, o + 4);
  buf.writeUInt32LE(TEMPLATE_SIG_OFF + moved, o + 8); // dataoff
  buf.writeUInt32LE(TEMPLATE_SIG_SIZE, o + 12); // datasize

  return buf;
}

type Mismatch = { slot: number; stored: string; expected: string };

type ParsedSignature = {
  dataoff: number;
  datasize: number;
  superBlobMagic: number;
  cdMagic: number;
  codeLimit: number;
  nCodeSlots: number;
  hashSize: number;
  hashType: number;
  pageSizeLog2: number;
  mismatches: Mismatch[];
  // Hex, from slot -1 down.
  specialSlots: string[];
};

// Recompute every CodeDirectory slot hash the way Apple's verifier does (last page unpadded).
function parseAndVerifySignature(buf: Buffer): ParsedSignature {
  expect(buf.length).toBeGreaterThan(32);
  expect(buf.readUInt32LE(0)).toBe(MH_MAGIC_64);
  const ncmds = buf.readUInt32LE(16);

  let dataoff = 0;
  let datasize = 0;
  let p = 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(p);
    const cmdsize = buf.readUInt32LE(p + 4);
    expect(cmdsize).toBeGreaterThanOrEqual(8);
    if (cmd === LC_CODE_SIGNATURE) {
      dataoff = buf.readUInt32LE(p + 8);
      datasize = buf.readUInt32LE(p + 12);
    }
    p += cmdsize;
  }
  expect(dataoff).toBeGreaterThan(0);
  // The advertised signature region must physically exist in the file.
  expect(dataoff + datasize).toBeLessThanOrEqual(buf.length);

  // SuperBlob and everything inside it is big-endian.
  const superBlobMagic = buf.readUInt32BE(dataoff);
  const blobCount = buf.readUInt32BE(dataoff + 8);
  let cd = 0;
  for (let i = 0; i < blobCount; i++) {
    const type = buf.readUInt32BE(dataoff + 12 + i * 8);
    const offset = buf.readUInt32BE(dataoff + 16 + i * 8);
    if (type === CSSLOT_CODEDIRECTORY) cd = dataoff + offset;
  }
  expect(cd).toBeGreaterThan(0);

  const cdMagic = buf.readUInt32BE(cd);
  const hashOffset = buf.readUInt32BE(cd + 16);
  const nSpecialSlots = buf.readUInt32BE(cd + 24);
  const nCodeSlots = buf.readUInt32BE(cd + 28);
  const codeLimit = buf.readUInt32BE(cd + 32);
  const hashSize = buf.readUInt8(cd + 36);
  const hashType = buf.readUInt8(cd + 37);
  const pageSizeLog2 = buf.readUInt8(cd + 39);
  const specialSlots = Array.from({ length: nSpecialSlots }, (_, index) =>
    buf.subarray(cd + hashOffset - (index + 1) * hashSize, cd + hashOffset - index * hashSize).toString("hex"),
  );
  expect(cd + hashOffset + nCodeSlots * hashSize).toBeLessThanOrEqual(buf.length);

  const pageSize = 1 << pageSizeLog2;
  const mismatches: Mismatch[] = [];
  for (let slot = 0; slot < nCodeSlots; slot++) {
    const stored = buf
      .subarray(cd + hashOffset + slot * hashSize, cd + hashOffset + (slot + 1) * hashSize)
      .toString("hex");
    const pageStart = slot * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, codeLimit);
    const expected = createHash("sha256").update(buf.subarray(pageStart, pageEnd)).digest("hex");
    if (stored !== expected) mismatches.push({ slot, stored, expected });
  }

  return {
    dataoff,
    datasize,
    superBlobMagic,
    cdMagic,
    codeLimit,
    nCodeSlots,
    hashSize,
    hashType,
    pageSizeLog2,
    mismatches,
    specialSlots,
  };
}

// tiny fits the template's __BUN slot (size_diff == 0); large shifts __LINKEDIT forward.
const bundles = {
  tiny: `console.log("hi");`,
  large: `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
};

test.each(Object.entries(bundles))(
  "--compile --target=bun-darwin-arm64 stores Apple-style page hashes, including the final partial page (%s bundle)",
  async (label, source) => {
    using dir = tempDir(`compile-macho-codesign-${label}`, {
      "entry.ts": source,
    });
    const cwd = String(dir);
    const template = join(cwd, "template");
    await Bun.write(template, machoTemplate());
    const out = join(cwd, `out-${label}`);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-arm64",
        "--compile-executable-path",
        template,
        join(cwd, "entry.ts"),
        "--outfile",
        out,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const outBytes = readFileSync(out);
    const sig = parseAndVerifySignature(outBytes);
    expect(sig.superBlobMagic).toBe(CSMAGIC_EMBEDDED_SIGNATURE);
    expect(sig.cdMagic).toBe(CSMAGIC_CODEDIRECTORY);
    expect(sig.hashType).toBe(2); // SHA-256
    expect(sig.hashSize).toBe(32);
    expect(1 << sig.pageSizeLog2).toBe(PAGE_SIZE);
    expect(sig.specialSlots).toEqual([]);

    // codeLimit covers everything before the signature blob.
    expect(sig.codeLimit).toBe(sig.dataoff);
    expect(sig.nCodeSlots).toBe(Math.ceil(sig.codeLimit / PAGE_SIZE));
    // The layout must end in a partial page or the test is vacuous.
    expect(sig.codeLimit % PAGE_SIZE).not.toBe(0);

    // codesign strict validation requires the signature to end at EOF.
    expect(outBytes.length).toBe(sig.dataoff + sig.datasize);

    expect(sig.mismatches).toStrictEqual([]);
  },
);

test.skipIf(!isMacOS || !isArm64)(
  "codesign verifies a natively compiled executable",
  async () => {
    using dir = tempDir("compile-macho-codesign-native", {
      "entry.ts": `console.log("hi");`,
    });
    const cwd = String(dir);
    const out = join(cwd, "out-native");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(cwd, "entry.ts"), "--outfile", out],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(buildStderr).not.toContain("error:");
    expect(buildExitCode).toBe(0);

    await using codesign = Bun.spawn({
      cmd: ["codesign", "--verify", out],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      codesign.stdout.text(),
      codesign.stderr.text(),
      codesign.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>sh.bun.test.info-plist</string>
	<key>CFBundleVersion</key>
	<string>1.2.3</string>
</dict>
</plist>
`;

// `segment` is the name of the load command that has the section, and `segname` the field of the section.
type Section = { segment: string; segname: string; name: string; addr: bigint; size: number; offset: number };

function readSections(buf: Buffer): Section[] {
  const readName = (off: number) => buf.toString("latin1", off, off + 16).replace(/\0+$/, "");
  const sections: Section[] = [];
  let p = 32;
  for (let i = buf.readUInt32LE(16); i > 0; i--) {
    if (buf.readUInt32LE(p) === LC_SEGMENT_64) {
      for (let index = 0; index < buf.readUInt32LE(p + 64); index++) {
        const section = p + 72 + index * 80;
        sections.push({
          segment: readName(p + 8),
          segname: readName(section + 16),
          name: readName(section),
          addr: buf.readBigUInt64LE(section + 32),
          size: Number(buf.readBigUInt64LE(section + 40)),
          offset: buf.readUInt32LE(section + 48),
        });
      }
    }
    p += buf.readUInt32LE(p + 4);
  }
  expect(p).toBe(32 + buf.readUInt32LE(20));
  return sections;
}

function readInfoPlist(buf: Buffer): string | undefined {
  const section = readSections(buf).find(section => section.segment === "__TEXT" && section.name === "__info_plist");
  return section && buf.toString("utf8", section.offset, section.offset + section.size);
}

/** The command has to succeed. If it does not, the failure shows what it printed. */
async function build(cmd: string[], cwd: string) {
  const { stderr, exitCode } = await run(cmd, cwd);
  expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
}

describe.concurrent("--macos-info-plist", () => {
  // From the load commands and one more section_64 to the end of __TEXT, which has no sections.
  const templateRoom = 0x4000 - (32 + machoTemplate().readUInt32LE(20)) - 80;

  const crossCompile = (template: string, ...args: string[]) => [
    bunExe(),
    "build",
    "--compile",
    "--target=bun-darwin-arm64",
    `--compile-executable-path=${template}`,
    "entry.ts",
    ...args,
  ];

  test.each(Object.entries(bundles))(
    "embeds the file in __TEXT,__info_plist and seals it (%s bundle)",
    async (label, source) => {
      using dir = tempDir(`compile-macho-info-plist-${label}`, {
        "entry.ts": source,
        "Info.plist": infoPlist,
        "template": machoTemplate(),
      });
      const cwd = String(dir);

      await build(crossCompile("template", "--macos-info-plist=Info.plist", "--outfile=out"), cwd);

      const out = readFileSync(join(cwd, "out"));
      expect(readSections(out)).toEqual([
        {
          segment: "__TEXT",
          segname: "__TEXT",
          name: "__info_plist",
          addr: 0x1_0000_0000n + BigInt(0x4000 - infoPlist.length),
          size: infoPlist.length,
          offset: 0x4000 - infoPlist.length,
        },
        expect.objectContaining({ segment: "__BUN", name: "__bun", offset: 0x4000 }),
      ]);
      expect(readInfoPlist(out)).toBe(infoPlist);

      const sig = parseAndVerifySignature(out);
      expect(sig.specialSlots).toEqual([createHash("sha256").update(infoPlist).digest("hex")]);
      expect(sig.mismatches).toEqual([]);
      expect(out.length).toBe(sig.dataoff + sig.datasize);
    },
  );

  test("replaces the Info.plist of the executable it copies", async () => {
    using dir = tempDir("compile-macho-info-plist-replace", {
      "entry.ts": bundles.tiny,
      "First.plist": infoPlist.replace("1.2.3", "1.2.3.4.5.6"),
      "Info.plist": infoPlist,
      "template": machoTemplate(),
      "expected": {},
      "second": {},
    });
    const cwd = String(dir);

    await build(crossCompile("template", "--macos-info-plist=First.plist", "--outfile=first"), cwd);
    await build(crossCompile("template", "--macos-info-plist=Info.plist", "--outfile=expected/out"), cwd);
    await build(crossCompile("first", "--macos-info-plist=Info.plist", "--outfile=second/out"), cwd);

    const [first, expected, second] = ["first", "expected/out", "second/out"].map(path =>
      readFileSync(join(cwd, path)),
    );
    const longer = infoPlist.replace("1.2.3", "1.2.3.4.5.6");
    expect(readInfoPlist(first)).toBe(longer);
    expect(readInfoPlist(second)).toBe(infoPlist);
    expect(parseAndVerifySignature(second).mismatches).toEqual([]);

    // Nothing of the longer file is left in front of the shorter one, and that is all that tells the two apart.
    // The name of the file is in the payload, so both are called `out`.
    const [leftFrom, leftTo] = [0x4000 - longer.length, 0x4000 - infoPlist.length];
    expect(second.subarray(leftFrom, leftTo)).toEqual(Buffer.alloc(leftTo - leftFrom));
    const signatureAt = parseAndVerifySignature(second).dataoff;
    expect(second.subarray(0, leftFrom).equals(expected.subarray(0, leftFrom))).toBe(true);
    expect(second.subarray(leftTo, signatureAt).equals(expected.subarray(leftTo, signatureAt))).toBe(true);
  });

  test("replaces an Info.plist that the executable was linked with", async () => {
    // Far enough into __TEXT that the bytes around it are not written together with the load commands.
    const linked = { name: "__info_plist", offset: 0x200000, size: 0x100 };
    using dir = tempDir("compile-macho-info-plist-linked", {
      "entry.ts": bundles.tiny,
      "Info.plist": infoPlist,
      "template": machoTemplate(0x400000, [{ name: "__text", offset: 0x2000, size: 0x1000 }, linked]),
    });
    const cwd = String(dir);

    await build(crossCompile("template", "--macos-info-plist=Info.plist", "--outfile=out"), cwd);

    const out = readFileSync(join(cwd, "out"));
    expect(readInfoPlist(out)).toBe(infoPlist);
    expect(readSections(out).map(section => section.name)).toEqual(["__text", "__info_plist", "__bun"]);
    expect(out.subarray(linked.offset, linked.offset + linked.size)).toEqual(Buffer.alloc(linked.size));
    const sig = parseAndVerifySignature(out);
    expect(sig.specialSlots).toEqual([createHash("sha256").update(infoPlist).digest("hex")]);
    expect(sig.mismatches).toEqual([]);
  });

  test("does not inherit the Info.plist that the executable it copies was given", async () => {
    // Large enough that the end of __TEXT, where the file goes, is not written together with the load commands.
    const textSize = 0x400000;
    const linked = { name: "__info_plist", offset: 0x200000, size: 0x100 };
    using dir = tempDir("compile-macho-info-plist-inherited", {
      "entry.ts": bundles.tiny,
      "Info.plist": infoPlist,
      "template": machoTemplate(textSize),
      "linked": machoTemplate(textSize, [{ name: "__text", offset: 0x2000, size: 0x1000 }, linked]),
      "plain": {},
      "from-compiled": {},
    });
    const cwd = String(dir);

    // The name of the file is in the payload, so those that are compared are called `out`.
    await build(crossCompile("template", "--outfile=plain/out"), cwd);
    await build(crossCompile("template", "--macos-info-plist=Info.plist", "--outfile=compiled"), cwd);
    await build(crossCompile("compiled", "--outfile=from-compiled/out"), cwd);
    await build(crossCompile("linked", "--outfile=from-linked"), cwd);
    const [plain, fromCompiled, fromLinked] = ["plain/out", "from-compiled/out", "from-linked"].map(path =>
      readFileSync(join(cwd, path)),
    );
    const summarize = (out: Buffer) => {
      const { specialSlots, mismatches, dataoff, datasize } = parseAndVerifySignature(out);
      return {
        sections: readSections(out),
        specialSlots,
        mismatches,
        bytesBehindSignature: out.length - dataoff - datasize,
      };
    };

    expect(summarize(fromCompiled)).toEqual(summarize(plain));
    expect(summarize(plain)).toMatchObject({ specialSlots: [], mismatches: [], bytesBehindSignature: 0 });
    expect(fromCompiled.subarray(textSize - infoPlist.length, textSize)).toEqual(Buffer.alloc(infoPlist.length));

    // One that the runtime was linked with is for every program of that runtime.
    const linkedInfoPlist = fromLinked.subarray(linked.offset, linked.offset + linked.size);
    expect(linkedInfoPlist).toEqual(Buffer.alloc(linked.size, 0xc3));
    expect(summarize(fromLinked)).toMatchObject({
      sections: [{ name: "__text" }, { name: "__info_plist", offset: linked.offset }, { name: "__bun" }],
      specialSlots: [createHash("sha256").update(linkedInfoPlist).digest("hex")],
      mismatches: [],
      bytesBehindSignature: 0,
    });
  });

  test("Bun.build embeds compile.macos.infoPlist, for macOS only", async () => {
    using dir = tempDir("compile-macho-info-plist-api", {
      "entry.ts": bundles.tiny,
      "Info.plist": infoPlist,
      "Large.plist": Buffer.alloc(templateRoom + 1, "x"),
      "Empty.plist": "",
      "index.html": "<p>hi</p>",
      "template": machoTemplate(),
      "elsewhere": {},
      "build.ts": `
        import { resolve } from "node:path";
        const entrypoints = ["entry.ts"];
        const darwin = { target: "bun-darwin-arm64", executablePath: "template" };
        const macos = { infoPlist: "Info.plist" };
        const missing = { infoPlist: "Missing.plist" };
        await Bun.build({ entrypoints, compile: { ...darwin, outfile: "out", macos } });
        const none = [undefined, null, false];
        for (const [index, macos] of [...none, ...none.map(infoPlist => ({ infoPlist }))].entries()) {
          await Bun.build({ entrypoints, compile: { ...darwin, outfile: "without-" + index, macos } });
        }
        await Bun.build({
          entrypoints,
          compile: { executablePath: process.execPath, outfile: "native", macos: process.platform === "darwin" ? macos : missing },
        });
        const pending = Bun.build({
          entrypoints: [resolve("entry.ts")],
          compile: { ...darwin, executablePath: resolve("template"), outfile: resolve("moved"), macos },
        });
        process.chdir("elsewhere");
        await pending;
        process.chdir("..");
        for (const options of [
          { entrypoints, compile: { ...darwin, outfile: "never", macos: 1 } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: true } } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: ["Info.plist"] } } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: Bun.file("Info.plist") } } },
          { entrypoints, compile: { target: "bun-linux-x64", outfile: "never", macos: { infoPlist: 1 } } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: "Info.plist\\0.nope" } } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: missing } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: "Empty.plist" } } },
          { entrypoints, compile: { ...darwin, outfile: "never", macos: { infoPlist: "Large.plist" } } },
          { entrypoints: ["index.html"], target: "browser", compile: { ...darwin, macos } },
        ]) {
          try {
            await Bun.build(options);
          } catch (error) {
            // What follows the code is worded by the system.
            console.log((error.errors?.[0].message ?? error.message).replace(/ENOENT.*/, "ENOENT"));
          }
        }
      `,
    });
    const cwd = String(dir);

    const built = await run([bunExe(), "build.ts"], cwd);
    expect(built).toEqual({
      stdout: [
        "macos must be an object",
        'The "compile.macos.infoPlist" property must be of type string. Received boolean',
        'The "compile.macos.infoPlist" property must be of type string. Received object',
        'The "compile.macos.infoPlist" property must be of type string. Received object',
        'The "compile.macos.infoPlist" property must be of type string. Received number',
        'the Info.plist "Info.plist\\u0000.nope" has a NUL byte in its path',
        'the Info.plist "Missing.plist" cannot be read: ENOENT',
        'the Info.plist "Empty.plist" is empty',
        `failed to embed the Info.plist: ${templateRoom + 1} bytes do not fit in the ${templateRoom} bytes of padding behind the load commands`,
        "Cannot use compile.macos.infoPlist with target 'browser' for standalone HTML",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(readInfoPlist(readFileSync(join(cwd, "out")))).toBe(infoPlist);
    for (let index = 0; index < 6; index++) {
      expect(readInfoPlist(readFileSync(join(cwd, "without-" + index)))).toBeUndefined();
    }
    expect(readInfoPlist(readFileSync(join(cwd, "moved")))).toBe(infoPlist);

    const native = await run([join(cwd, isWindows ? "native.exe" : "native")], cwd);
    expect(native).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
  });

  test("takes a file that fills the room behind the load commands, and not a byte more", async () => {
    using dir = tempDir("compile-macho-info-plist-room", {
      "entry.ts": bundles.tiny,
      "Fits.plist": Buffer.alloc(templateRoom, "x"),
      "Large.plist": Buffer.alloc(templateRoom + 1, "x"),
      "template": machoTemplate(),
    });
    const cwd = String(dir);

    await build(crossCompile("template", "--macos-info-plist=Fits.plist", "--outfile=fits"), cwd);
    const fits = readFileSync(join(cwd, "fits"));
    expect(readInfoPlist(fits)).toBe(Buffer.alloc(templateRoom, "x").toString());
    expect(parseAndVerifySignature(fits).mismatches).toEqual([]);

    const { stderr, exitCode } = await run(
      crossCompile("template", "--macos-info-plist=Large.plist", "--outfile=large"),
      cwd,
    );
    expect({ stderr, exitCode }).toEqual({
      stderr: `failed to embed the Info.plist: ${templateRoom + 1} bytes do not fit in the ${templateRoom} bytes of padding behind the load commands\n`,
      exitCode: 1,
    });
    expect(await Bun.file(join(cwd, "large")).exists()).toBe(false);
  });

  test("refuses a file that it cannot embed before it builds anything", async () => {
    const mostRead = 1 << 20;
    using dir = tempDir("compile-macho-info-plist-refused", {
      "entry.ts": bundles.tiny,
      "Empty.plist": "",
      "MostRead.plist": Buffer.alloc(mostRead, "x"),
      "Huge.plist": Buffer.alloc(mostRead + 1, "x"),
      "Folder.plist": {},
      "template": machoTemplate(),
    });
    const cwd = String(dir);
    const refuse = (path: string) => run(crossCompile("template", `--macos-info-plist=${path}`, "--outfile=out"), cwd);
    const refused = (problem: string) => ({ stdout: "", stderr: `error: the Info.plist ${problem}\n`, exitCode: 1 });

    expect(await refuse("Empty.plist")).toEqual(refused('"Empty.plist" is empty'));
    expect(await refuse("Huge.plist")).toEqual(
      refused(`"Huge.plist" is ${mostRead + 1} bytes, which is too large to embed`),
    );
    expect(await refuse("Folder.plist")).toEqual(refused('"Folder.plist" is not a regular file'));
    if (!isWindows) expect(await refuse("/dev/zero")).toEqual(refused('"/dev/zero" is not a regular file'));

    const missing = await refuse("Missing.plist");
    expect(missing.stderr).toStartWith('error: the Info.plist "Missing.plist" cannot be read: ENOENT');
    expect({ ...missing, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1 });

    // The largest file that is read gets as far as the executable, which says how much fits.
    const mostReadResult = await refuse("MostRead.plist");
    expect({ stderr: mostReadResult.stderr, exitCode: mostReadResult.exitCode }).toEqual({
      stderr: `failed to embed the Info.plist: ${mostRead} bytes do not fit in the ${templateRoom} bytes of padding behind the load commands\n`,
      exitCode: 1,
    });

    expect(await Bun.file(join(cwd, "out")).exists()).toBe(false);
  });

  test("requires --compile and a macOS target", async () => {
    using dir = tempDir("compile-macho-info-plist-flags", {
      "entry.ts": bundles.tiny,
      "index.html": "<p>hi</p>",
      "Info.plist": infoPlist,
    });
    const cwd = String(dir);
    const buildWith = (...args: string[]) => run([bunExe(), "build", "--macos-info-plist=Info.plist", ...args], cwd);
    const refused = (why: string) => ({ stdout: "", stderr: `error: ${why}\n`, exitCode: 1 });
    const needsMacOS = refused("--macos-info-plist requires a macOS compile target");

    expect(await buildWith("entry.ts")).toEqual(refused("--macos-info-plist requires --compile"));
    expect(await buildWith("--compile", "--target=bun-linux-x64", "entry.ts")).toEqual(needsMacOS);
    // Without a target for the executable, it is the host.
    expect(await buildWith("--compile", "--target=browser", "index.html")).toEqual(
      isMacOS ? refused("cannot use --compile --target browser with --macos-info-plist") : needsMacOS,
    );
  });

  test.skipIf(!isMacOS)("CoreFoundation reads the Info.plist of a natively compiled executable", async () => {
    using dir = tempDir("compile-macho-info-plist-native", {
      "embedded.plist": infoPlist,
      "unnamed": { "Info.plist": infoPlist.replace("sh.bun.test.info-plist", "sh.bun.test.beside") },
      "named": {
        "Info.plist": infoPlist
          .replace("sh.bun.test.info-plist", "sh.bun.test.beside")
          .replace("<dict>", "<dict><key>CFBundleExecutable</key><string>out</string>"),
      },
      "entry.ts": `
          import { CString, dlopen, ptr } from "bun:ffi";
          const { symbols: cf } = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
            CFBundleGetMainBundle: { args: [], returns: "ptr" },
            CFBundleGetIdentifier: { args: ["ptr"], returns: "ptr" },
            CFStringGetCString: { args: ["ptr", "ptr", "i64", "u32"], returns: "bool" },
          });
          const identifier = cf.CFBundleGetIdentifier(cf.CFBundleGetMainBundle());
          const buffer = new Uint8Array(256);
          const kCFStringEncodingUTF8 = 0x08000100;
          if (identifier && cf.CFStringGetCString(identifier, ptr(buffer), buffer.length, kCFStringEncodingUTF8)) {
            console.log(new CString(ptr(buffer)).toString());
          } else {
            console.log("no identifier");
          }
        `,
    });
    const cwd = String(dir);

    await build(
      [bunExe(), "build", "--compile", "--macos-info-plist=embedded.plist", "entry.ts", "--outfile=out"],
      cwd,
    );
    expect(readInfoPlist(readFileSync(join(cwd, "out")))).toBe(infoPlist);

    expect(await run([join(cwd, "out")], cwd)).toEqual({
      stdout: "sh.bun.test.info-plist\n",
      stderr: "",
      exitCode: 0,
    });

    if (isArm64) {
      expect(await run(["codesign", "--verify", "out"], cwd)).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
      // "Info.plist=not bound" unless the signature has the hash of the section.
      const described = await run(["codesign", "--display", "--verbose=2", "out"], cwd);
      expect(described.stderr).toContain("Info.plist entries=2");
      expect(described.exitCode).toBe(0);
    }

    // CoreFoundation prefers a file named Info.plist beside the executable, if that file names the executable.
    for (const [directory, identifier] of [
      ["unnamed", "sh.bun.test.info-plist"],
      ["named", "sh.bun.test.beside"],
    ]) {
      linkSync(join(cwd, "out"), join(cwd, directory, "out"));
      expect(await run([join(cwd, directory, "out")], cwd)).toEqual({
        stdout: identifier + "\n",
        stderr: "",
        exitCode: 0,
      });
    }

    // A program that an executable with an Info.plist compiles is not that executable.
    await build([bunExe(), "build", "--compile", "--compile-executable-path=out", "entry.ts", "--outfile=child"], cwd);
    expect(await run([join(cwd, "child")], cwd)).toEqual({ stdout: "no identifier\n", stderr: "", exitCode: 0 });
    if (isArm64) {
      expect(await run(["codesign", "--verify", "child"], cwd)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    }

    // What a developer does to ship it: codesign takes the identifier from the embedded Info.plist.
    await build(["codesign", "--force", "--sign", "-", "out"], cwd);
    const resigned = await run(["codesign", "--display", "--verbose=2", "out"], cwd);
    expect(resigned.stderr).toContain("Identifier=sh.bun.test.info-plist");
    expect(resigned.stderr).toContain("Info.plist entries=2");
    expect(await run([join(cwd, "out")], cwd)).toEqual({
      stdout: "sh.bun.test.info-plist\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
