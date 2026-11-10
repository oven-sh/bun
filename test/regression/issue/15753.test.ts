// On musl builds, loading a glibc-linked .node addon used to segfault inside
// the dynamic loader (gcompat satisfies the libc.so.6 soname but not the ABI).
// process.dlopen now inspects the ELF DT_NEEDED list first and throws a
// catchable ERR_DLOPEN_FAILED that names the libc mismatch.
// https://github.com/oven-sh/bun/issues/15753

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";

// Build a minimal ELF64-LE image whose PT_DYNAMIC carries the given DT_NEEDED
// soname. e_type is ET_NONE so both glibc and musl reject it at header
// validation (musl: map_library's e_type check; glibc: open_verify) before
// touching the absent hash/sym tables. Bun's pre-dlopen DT_NEEDED walk only
// checks magic/class/endian, so it still parses the dynamic section.
function minimalElfSharedObject(needed: string): Buffer {
  const strtabBody = "\0" + needed + "\0";
  const strtab = Buffer.from(strtabBody, "latin1");
  const neededOff = 1;

  const ehdrSize = 64;
  const phdrSize = 56;
  const dynEntSize = 16;
  const phCount = 2; // PT_LOAD, PT_DYNAMIC
  const dynEntries = 4; // DT_NEEDED, DT_STRTAB, DT_STRSZ, DT_NULL

  const phOff = ehdrSize;
  const strtabOff = phOff + phCount * phdrSize;
  const dynOff = strtabOff + strtab.length;
  const dynSize = dynEntries * dynEntSize;
  const total = dynOff + dynSize;

  const buf = Buffer.alloc(total);

  // Elf64_Ehdr
  buf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0); // magic, ELFCLASS64, LE, v1
  buf.writeUInt16LE(0, 16); // e_type = ET_NONE (see comment above)
  buf.writeUInt16LE(0, 18); // e_machine = EM_NONE
  buf.writeUInt32LE(1, 20); // e_version
  buf.writeBigUInt64LE(0n, 24); // e_entry
  buf.writeBigUInt64LE(BigInt(phOff), 32); // e_phoff
  buf.writeBigUInt64LE(0n, 40); // e_shoff
  buf.writeUInt32LE(0, 48); // e_flags
  buf.writeUInt16LE(ehdrSize, 52); // e_ehsize
  buf.writeUInt16LE(phdrSize, 54); // e_phentsize
  buf.writeUInt16LE(phCount, 56); // e_phnum
  buf.writeUInt16LE(0, 58); // e_shentsize
  buf.writeUInt16LE(0, 60); // e_shnum
  buf.writeUInt16LE(0, 62); // e_shstrndx

  // PT_LOAD covering the whole file at vaddr 0 so DT_STRTAB's vaddr == file offset
  let p = phOff;
  buf.writeUInt32LE(1, p + 0); // p_type = PT_LOAD
  buf.writeUInt32LE(5, p + 4); // p_flags = R|X
  buf.writeBigUInt64LE(0n, p + 8); // p_offset
  buf.writeBigUInt64LE(0n, p + 16); // p_vaddr
  buf.writeBigUInt64LE(0n, p + 24); // p_paddr
  buf.writeBigUInt64LE(BigInt(total), p + 32); // p_filesz
  buf.writeBigUInt64LE(BigInt(total), p + 40); // p_memsz
  buf.writeBigUInt64LE(0x1000n, p + 48); // p_align

  // PT_DYNAMIC
  p = phOff + phdrSize;
  buf.writeUInt32LE(2, p + 0); // p_type = PT_DYNAMIC
  buf.writeUInt32LE(6, p + 4); // p_flags = RW
  buf.writeBigUInt64LE(BigInt(dynOff), p + 8); // p_offset
  buf.writeBigUInt64LE(BigInt(dynOff), p + 16); // p_vaddr
  buf.writeBigUInt64LE(0n, p + 24); // p_paddr
  buf.writeBigUInt64LE(BigInt(dynSize), p + 32); // p_filesz
  buf.writeBigUInt64LE(BigInt(dynSize), p + 40); // p_memsz
  buf.writeBigUInt64LE(8n, p + 48); // p_align

  // .dynstr
  strtab.copy(buf, strtabOff);

  // .dynamic
  let d = dynOff;
  const writeDyn = (tag: bigint, val: bigint) => {
    buf.writeBigInt64LE(tag, d);
    buf.writeBigUInt64LE(val, d + 8);
    d += dynEntSize;
  };
  writeDyn(1n, BigInt(neededOff)); // DT_NEEDED -> "libc.so.6" (or whatever)
  writeDyn(5n, BigInt(strtabOff)); // DT_STRTAB
  writeDyn(10n, BigInt(strtab.length)); // DT_STRSZ
  writeDyn(0n, 0n); // DT_NULL

  return buf;
}

async function tryDlopen(addon: Buffer, force: boolean) {
  using dir = tempDir("issue-15753", { "addon.node": addon });
  const env = { ...bunEnv };
  if (force) env.BUN_INTERNAL_NAPI_FORCE_MUSL_CHECK = "1";
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try { process.dlopen({ exports: {} }, ${JSON.stringify(String(dir) + "/addon.node")}); console.log("LOADED"); }` +
        ` catch (e) { console.log("CODE:" + e.code); console.log("MSG:" + e.message); }`,
    ],
    env,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent.skipIf(!isLinux)("issue #15753: glibc addon on musl throws instead of segfaulting", () => {
  test.each(["libc.so.6", "libpthread.so.0", "ld-linux-aarch64.so.1"])(
    "glibc-linked addon (%s) is rejected with ERR_DLOPEN_FAILED",
    async soname => {
      // On a real musl host the check runs unconditionally; on glibc CI the
      // env var opts in so the ELF walk is still exercised.
      const { stdout, stderr, exitCode } = await tryDlopen(minimalElfSharedObject(soname), !isMusl);
      expect(stderr).toBe("");
      expect(stdout).toContain("CODE:ERR_DLOPEN_FAILED");
      expect(stdout).toContain("linked against glibc");
      expect(stdout).toContain(`DT_NEEDED ${soname}`);
      expect(stdout).toContain("musl");
      expect(stdout).not.toContain("LOADED");
      expect(exitCode).toBe(0);
    },
  );

  test("non-glibc DT_NEEDED is not rejected by the check", async () => {
    const { stdout, stderr, exitCode } = await tryDlopen(
      minimalElfSharedObject("libbun-issue-15753-nonexistent.so.0"),
      true,
    );
    // The libc check must pass it through to dlopen, which then fails on the
    // stub ELF with the loader's own message (not the glibc/musl hint).
    expect(stderr).toBe("");
    expect(stdout).toContain("CODE:ERR_DLOPEN_FAILED");
    expect(stdout).not.toContain("linked against glibc");
    expect(exitCode).toBe(0);
  });

  test("non-ELF file falls through to dlopen", async () => {
    const { stdout, exitCode } = await tryDlopen(Buffer.from("not an ELF"), true);
    expect(stdout).toContain("CODE:ERR_DLOPEN_FAILED");
    expect(stdout).not.toContain("linked against glibc");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isMusl)("check is off by default on glibc hosts", async () => {
    const { stdout, exitCode } = await tryDlopen(minimalElfSharedObject("libc.so.6"), false);
    // Without the force flag a glibc host proceeds to dlopen; the stub ELF is
    // rejected by the real loader, not by Bun's pre-check.
    expect(stdout).toContain("CODE:ERR_DLOPEN_FAILED");
    expect(stdout).not.toContain("linked against glibc");
    expect(exitCode).toBe(0);
  });
});
