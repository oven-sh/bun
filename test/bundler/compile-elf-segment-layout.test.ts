// The `.bun` section (the standalone module graph header) used to be declared
// with 16KB alignment on ELF. That raised the RW PT_LOAD's p_align to 0x4000
// while the other segments stayed at 0x1000, and lld assigned the RW p_vaddr
// without keeping round_down(p_vaddr, 0x4000) clear of the previous segment's
// pages. The kernel ignores p_align at execve, so the plain binary ran, but a
// loader that honors p_align (UPX's decompression stub) mapped the RW segment
// over the tail of the R E segment and the embedded module source read back
// corrupted: `SyntaxError: Invalid character: '\0'`.
//
// These tests assert the strict-p_align non-overlap invariant on the bun
// binary itself and on a `--compile` output (the file UPX processes):
// for each PT_LOAD pair sorted by vaddr,
//   round_down(next.p_vaddr, next.align) >= round_up(prev.p_vaddr + prev.p_memsz, prev.align)
// where align = max(p_align, page size).
//
// https://github.com/oven-sh/bun/issues/40752

import { describe, expect, test } from "bun:test";
import type { Elf64ProgramHeader } from "harness";
import { bunEnv, bunExe, isFreeBSD, isLinux, preadExact, readElf64ProgramHeaders, tempDir } from "harness";
import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type LoadSegment = Pick<Elf64ProgramHeader, "vaddr" | "memsz" | "align">;

/** PT_LOAD program headers of an ELF64 file. */
function readLoadSegments(path: string): LoadSegment[] {
  return readElf64ProgramHeaders(path).filter(ph => ph.type === 1 /* PT_LOAD */);
}

/**
 * Mapped range of a PT_LOAD under strict p_align semantics: what a loader
 * that honors p_align (like UPX's stub) maps for the segment.
 */
function strictRange({ vaddr, memsz, align }: LoadSegment): [bigint, bigint] {
  const a = align > 0x1000n ? align : 0x1000n; // mapping granularity is at least a page
  const start = vaddr & ~(a - 1n);
  const end = (vaddr + memsz + a - 1n) & ~(a - 1n);
  return [start, end];
}

function expectNoOverlap(path: string) {
  const loads = readLoadSegments(path).sort((a, b) => (a.vaddr < b.vaddr ? -1 : 1));
  expect(loads.length).toBeGreaterThan(1);
  for (let i = 1; i < loads.length; i++) {
    const [, prevEnd] = strictRange(loads[i - 1]);
    const [nextStart] = strictRange(loads[i]);
    if (nextStart < prevEnd) {
      const fmt = (s: LoadSegment) =>
        `vaddr=0x${s.vaddr.toString(16)} memsz=0x${s.memsz.toString(16)} align=0x${s.align.toString(16)}`;
      throw new Error(
        `PT_LOAD segments overlap under strict p_align semantics by 0x${(prevEnd - nextStart).toString(16)} bytes:\n` +
          `  ${fmt(loads[i - 1])}\n  ${fmt(loads[i])}`,
      );
    }
  }
}

test.skipIf(!(isLinux || isFreeBSD))("bun binary has no PT_LOAD overlap under strict p_align", () => {
  expectNoOverlap(bunExe());
});

test.skipIf(!(isLinux || isFreeBSD))(
  "compiled executable has no PT_LOAD overlap under strict p_align",
  async () => {
    using dir = tempDir("elf-segment-layout", {
      "index.ts": `console.log("hello from compiled");`,
    });
    const cwd = String(dir);
    const out = join(cwd, "app");

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(cwd, "index.ts"), "--outfile", out],
      env: bunEnv,
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildErr).not.toContain("error:");
    expect(buildExit).toBe(0);

    expectNoOverlap(out);

    await using run = Bun.spawn({ cmd: [out], env: bunEnv, cwd, stderr: "pipe", stdout: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("hello from compiled\n");
    expect(exitCode).toBe(0);
  },
  180_000,
);

// `bun build --compile` injects into a copy of an executable: bun itself, or
// the one `--compile-executable-path` names. That executable can be a compiled
// one: `BUN_BE_BUN=1 ./app build --compile`, or `Bun.build({ compile })`
// called in `./app`. Its `.bun` section header names the payload it carries,
// not BUN_COMPILED. The writer stored the new payload's address over that
// payload's length and left BUN_COMPILED alone, so the new executable read a
// length of tens of MB at startup and crashed.
describe("compiling into a compiled executable", () => {
  async function spawn(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({ cmd, env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const built = { stdout: expect.any(String), stderr: expect.not.stringContaining("error"), exitCode: 0 };

  // The ELF writer is the same on every host. Like the PE and Mach-O writers,
  // it is tested on a template small enough to build by hand: an R E segment,
  // an RW segment with `.data`, `.bun` (BUN_COMPILED, 0) and `.bss`, then
  // `.shstrtab` and the section headers. The result cannot run.
  function minimalElf64Template(machine: number, page: number): Buffer {
    const base = 0x200000;
    const names = Buffer.from("\0.data\0.bun\0.bss\0.shstrtab\0", "latin1");
    const nameAt = (name: string) => names.indexOf(`\0${name}\0`, 0, "latin1") + 1;
    const rw = { offset: page, vaddr: base + 2 * page, filesz: page, memsz: 3 * page - 0x234 };
    const shstrtab = rw.offset + rw.filesz;
    const e_shoff = shstrtab + 64;
    const [PROGBITS, STRTAB, NOBITS, WA] = [1, 3, 8, 3];
    const segments = [
      { flags: 5 /* R E */, offset: 0, vaddr: base, filesz: page, memsz: page },
      { flags: 6 /* RW */, ...rw },
    ];
    const sections = [
      { name: 0, type: 0, flags: 0, addr: 0, offset: 0, size: 0 },
      { name: nameAt(".data"), type: PROGBITS, flags: WA, addr: rw.vaddr, offset: rw.offset, size: 0x100 },
      { name: nameAt(".bun"), type: PROGBITS, flags: WA, addr: rw.vaddr + 0x100, offset: rw.offset + 0x100, size: 8 },
      { name: nameAt(".bss"), type: NOBITS, flags: WA, addr: rw.vaddr + page, offset: shstrtab, size: rw.memsz - page },
      { name: nameAt(".shstrtab"), type: STRTAB, flags: 0, addr: 0, offset: shstrtab, size: names.length },
    ];

    const elf = Buffer.alloc(e_shoff + sections.length * 64);
    elf.write("\x7fELF", 0, "latin1");
    elf.set([2 /* ELFCLASS64 */, 1 /* ELFDATA2LSB */, 1 /* EV_CURRENT */], 4);
    elf.writeUInt16LE(2 /* ET_EXEC */, 16);
    elf.writeUInt16LE(machine, 18);
    elf.writeUInt32LE(1, 20); // e_version
    elf.writeBigUInt64LE(BigInt(base), 24); // e_entry
    elf.writeBigUInt64LE(64n, 32); // e_phoff
    elf.writeBigUInt64LE(BigInt(e_shoff), 40);
    elf.writeUInt16LE(64, 52); // e_ehsize
    elf.writeUInt16LE(56, 54); // e_phentsize
    elf.writeUInt16LE(segments.length, 56);
    elf.writeUInt16LE(64, 58); // e_shentsize
    elf.writeUInt16LE(sections.length, 60);
    elf.writeUInt16LE(sections.length - 1, 62); // e_shstrndx
    segments.forEach((segment, i) => {
      const at = 64 + i * 56;
      elf.writeUInt32LE(1 /* PT_LOAD */, at);
      elf.writeUInt32LE(segment.flags, at + 4);
      [segment.offset, segment.vaddr, segment.vaddr, segment.filesz, segment.memsz, page].forEach((value, field) =>
        elf.writeBigUInt64LE(BigInt(value), at + 8 + field * 8),
      );
    });
    elf.fill(0xcc, 64 + segments.length * 56, page);
    elf.fill(0xdd, rw.offset, rw.offset + 0x100);
    names.copy(elf, shstrtab);
    sections.forEach((section, i) => {
      const at = e_shoff + i * 64;
      elf.writeUInt32LE(section.name, at);
      elf.writeUInt32LE(section.type, at + 4);
      [section.flags, section.addr, section.offset, section.size].forEach((value, field) =>
        elf.writeBigUInt64LE(BigInt(value), at + 8 + field * 8),
      );
    });
    return elf;
  }

  // The u64 header fields the tests read or change, by file offset. The writer
  // keeps the order of the headers, so the indexes are those of the template.
  function fieldsOf(elf: Buffer) {
    const programHeader = (index: number) => 64 + index * 56;
    const sectionHeader = (index: number) => Number(elf.readBigUInt64LE(40 /* e_shoff */)) + index * 64;
    return {
      re: { vaddr: programHeader(0) + 16 },
      rw: { offset: programHeader(1) + 8, filesz: programHeader(1) + 32, memsz: programHeader(1) + 40 },
      bun: { addr: sectionHeader(2) + 16, offset: sectionHeader(2) + 24, size: sectionHeader(2) + 32 },
      bss: { size: sectionHeader(3) + 32 },
      get: (at: number) => elf.readBigUInt64LE(at),
      set: (at: number, value: bigint) => void elf.writeBigUInt64LE(value, at),
      add: (at: number, n: number) => void elf.writeBigUInt64LE(elf.readBigUInt64LE(at) + BigInt(n), at),
    };
  }
  type Fields = ReturnType<typeof fieldsOf>;

  describe.each([
    ["x64", 62 /* EM_X86_64 */, 0x1000],
    ["aarch64", 183 /* EM_AARCH64 */, 0x10000],
  ])("bun-linux-%s", (arch, machine, page) => {
    const compileInto = (cwd: string, template: string, entry: string, outfile: string) => {
      const target = ["--target", `bun-linux-${arch}`, "--compile-executable-path", template];
      return spawn([bunExe(), "build", "--compile", ...target, entry, "--outfile", outfile], cwd);
    };

    test.concurrent("the new payload takes the place of the old one", async () => {
      // More than a page apart, so each payload takes a different number of
      // pages than the one it replaces and everything behind it moves.
      using dir = tempDir("elf-compile-into-compiled", {
        "large.js": `console.log("${Buffer.alloc(3 * page, "x").toString()}");`,
        "small.js": `console.log("small");`,
        "larger.js": `console.log("${Buffer.alloc(6 * page, "y").toString()}");`,
      });
      const cwd = String(dir);
      writeFileSync(join(cwd, "template"), minimalElf64Template(machine, page));

      expect(await compileInto(cwd, "template", "large.js", "large")).toEqual(built);
      expect(await compileInto(cwd, "large", "small.js", "small")).toEqual(built);
      expect(await compileInto(cwd, "small", "larger.js", "larger")).toEqual(built);
      expect(await compileInto(cwd, "template", "small.js", "direct/small")).toEqual(built);
      expect(await compileInto(cwd, "template", "larger.js", "direct/larger")).toEqual(built);
      const read = (name: string) => readFileSync(join(cwd, name));
      const [large, small, larger] = [read("large"), read("small"), read("larger")];

      // The bytes of a compile into the template: nothing of the payload before
      // is left, and the payload is where BUN_COMPILED already points.
      expect(small.equals(read("direct/small"))).toBe(true);
      expect(larger.equals(read("direct/larger"))).toBe(true);
      const payloadAddress = (elf: Buffer) => elf.readBigUInt64LE(fieldsOf(elf).bun.addr);
      expect([payloadAddress(small), payloadAddress(larger)]).toEqual(Array(2).fill(payloadAddress(large)));
      expect(small.length).toBeLessThan(large.length);
      expect(larger.length).toBeGreaterThan(large.length);
    });

    let compiled: Promise<Buffer> | undefined;
    const compiledExecutable = () =>
      (compiled ??= (async () => {
        using dir = tempDir("elf-compile-into-compiled-first", { "first.js": `console.log("first");` });
        const cwd = String(dir);
        writeFileSync(join(cwd, "template"), minimalElf64Template(machine, page));
        expect(await compileInto(cwd, "template", "first.js", "first")).toEqual(built);
        return readFileSync(join(cwd, "first"));
      })());

    // Each row takes away one thing the writer needs to replace a payload
    // where it is, and nothing else.
    test.concurrent.each<[string, (f: Fields) => void]>([
      ["a section longer than its payload", f => f.add(f.bun.size, 1)],
      [
        "a payload that does not start a page",
        f => {
          // 8 bytes further on: still [length][bytes], still the end of its segment.
          f.add(f.bun.addr, 8);
          f.add(f.bun.offset, 8);
          f.add(f.bun.size, -8);
          f.set(Number(f.get(f.bun.offset)), f.get(f.bun.size) - 8n);
          f.add(f.rw.filesz, 8);
          f.add(f.rw.memsz, 8);
        },
      ],
      // What the writer made of a compiled executable before it looked: a
      // second payload behind the first, and BUN_COMPILED still on the first.
      ["a payload a page or more past the sections", f => f.add(f.bss.size, -page)],
      ["a section header that disagrees with the segment", f => f.add(f.rw.offset, page)],
      ["a payload that the file does not back", f => f.add(f.rw.filesz, -page)],
      ["a segment above the payload", f => f.add(f.re.vaddr, 64 * page)],
      [
        "a segment that goes on behind the payload",
        f => {
          f.add(f.rw.filesz, page);
          f.add(f.rw.memsz, page);
        },
      ],
    ])("refuses %s", async (_, doctor) => {
      using dir = tempDir("elf-compile-into-compiled-refused", { "second.js": `console.log("second");` });
      const cwd = String(dir);
      const first = Buffer.from(await compiledExecutable());
      doctor(fieldsOf(first));
      writeFileSync(join(cwd, "first"), first);

      expect(await compileInto(cwd, "first", "second.js", "second")).toEqual({
        stdout: expect.any(String),
        stderr: expect.stringContaining("BunSectionAlreadyWritten"),
        exitCode: 1,
      });
      expect(existsSync(join(cwd, "second"))).toBe(false);
    });
  });

  // Compared in pieces: a debug build of bun is most of a GB.
  function sameBytes(a: string, b: string): boolean {
    const size = statSync(a).size;
    if (statSync(b).size !== size) return false;
    const fds = [openSync(a, "r"), openSync(b, "r")];
    try {
      const piece = 16 * 1024 * 1024;
      for (let at = 0; at < size; at += piece) {
        const length = Math.min(piece, size - at);
        if (!preadExact(fds[0], at, length).equals(preadExact(fds[1], at, length))) return false;
      }
      return true;
    } finally {
      fds.forEach(closeSync);
    }
  }

  test.skipIf(!(isLinux || isFreeBSD))(
    "the new executable runs",
    async () => {
      using dir = tempDir("elf-compile-into-compiled-run", {
        // Compiled, `./large <entry> <outfile>` compiles <entry>, the way a CLI built on bun does.
        "large.js": `const data = "${Buffer.alloc(100_000, "x").toString()}";
if (process.argv.length > 2) {
  await Bun.build({ entrypoints: [process.argv[2]], compile: { outfile: process.argv[3] } });
  console.log("compiled");
} else console.log("large-" + data.length);`,
        "small.js": `console.log("small");`,
        "larger.js": `const data = "${Buffer.alloc(200_000, "y").toString()}"; console.log("larger-" + data.length);`,
      });
      const cwd = String(dir);
      const [large, small, larger] = ["large", "small", "larger"].map(name => join(cwd, name));
      const [viaApi, direct] = ["api", "direct"].map(name => join(cwd, name, "small"));
      const compile = (args: string[], compiler = bunExe(), env = bunEnv) =>
        spawn([compiler, "build", "--compile", ...args], cwd, env);

      expect(await compile(["large.js", "--outfile", large])).toEqual(built);
      expect(
        await Promise.all([
          compile(["small.js", "--outfile", small], large, { ...bunEnv, BUN_BE_BUN: "1" }),
          spawn([large, "small.js", viaApi], cwd),
          compile(["small.js", "--outfile", direct]),
        ]),
      ).toEqual([built, { stdout: "compiled\n", stderr: "", exitCode: 0 }, built]);
      expect(await compile(["--compile-executable-path", small, "larger.js", "--outfile", larger])).toEqual(built);

      const ran = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
      expect(await spawn([small], cwd)).toEqual(ran("small\n"));
      expect(await spawn([viaApi], cwd)).toEqual(ran("small\n"));
      expect(await spawn([larger], cwd)).toEqual(ran("larger-200000\n"));
      expect(sameBytes(small, direct)).toBe(true);
      expect(sameBytes(viaApi, direct)).toBe(true);
      expectNoOverlap(larger);
    },
    180_000,
  );
});
