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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

/** Read `len` bytes from `fd` at absolute `offset`. */
function preadExact(fd: number, offset: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, offset + got);
    if (n === 0) throw new Error(`short read at ${offset}`);
    got += n;
  }
  return buf;
}

interface LoadSegment {
  vaddr: bigint;
  memsz: bigint;
  align: bigint;
}

/** PT_LOAD program headers of an ELF64 little-endian file. */
function readLoadSegments(path: string): LoadSegment[] {
  const fd = openSync(path, "r");
  try {
    const ehdr = preadExact(fd, 0, 64);
    if (ehdr.readUInt32BE(0) !== 0x7f454c46) throw new Error("not ELF");
    if (ehdr[4] !== 2) throw new Error("only ELF64 supported"); // EI_CLASS
    if (ehdr[5] !== 1) throw new Error("only little-endian supported"); // EI_DATA

    const e_phoff = Number(ehdr.readBigUInt64LE(32));
    const e_phentsize = ehdr.readUInt16LE(54);
    const e_phnum = ehdr.readUInt16LE(56);

    const loads: LoadSegment[] = [];
    for (let i = 0; i < e_phnum; i++) {
      const ph = preadExact(fd, e_phoff + i * e_phentsize, e_phentsize);
      if (ph.readUInt32LE(0) !== 1 /* PT_LOAD */) continue;
      loads.push({
        vaddr: ph.readBigUInt64LE(16),
        memsz: ph.readBigUInt64LE(40),
        align: ph.readBigUInt64LE(48),
      });
    }
    return loads;
  } finally {
    closeSync(fd);
  }
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

test.skipIf(!isLinux)("bun binary has no PT_LOAD overlap under strict p_align", () => {
  expectNoOverlap(bunExe());
});

test.skipIf(!isLinux)(
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
    const [buildErr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
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
