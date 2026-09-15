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
import type { Elf64ProgramHeader } from "harness";
import { bunEnv, bunExe, isFreeBSD, isLinux, readElf64ProgramHeaders, tempDir } from "harness";
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
