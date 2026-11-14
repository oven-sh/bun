import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { emitPostLink } from "../../scripts/build/bun.ts";
import { resolveConfig, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

const script = resolve(import.meta.dirname, "../../scripts/build/close-elf-gaps.ts");
const pageSize = 0x1000;
const [headerSize, programHeaderSize, sectionHeaderSize] = [64, 56, 64];
const [loadable, progBits] = [1, 1];
const [mayExecute, mayRead] = [1, 4];

function createElf(
  segments: { flags: number; offset: number; address: number; size: number }[],
  sections: { offset: number; size: number }[],
  size: number,
) {
  const file = Buffer.alloc(size + sections.length * sectionHeaderSize, 0xcc);
  file.fill(0, 0, headerSize + segments.length * programHeaderSize);
  file.fill(0, size);
  file.write("\x7fELF\x02\x01\x01", 0, "latin1");
  file.writeBigUInt64LE(BigInt(headerSize), 32);
  file.writeBigUInt64LE(BigInt(size), 40);
  file.writeUInt16LE(programHeaderSize, 54);
  file.writeUInt16LE(segments.length, 56);
  file.writeUInt16LE(sectionHeaderSize, 58);
  file.writeUInt16LE(sections.length, 60);
  segments.forEach(({ flags, offset, address, size }, index) => {
    const at = headerSize + index * programHeaderSize;
    file.writeUInt32LE(loadable, at);
    file.writeUInt32LE(flags, at + 4);
    [offset, address, address, size, size, pageSize].forEach((value, word) =>
      file.writeBigUInt64LE(BigInt(value), at + 8 + word * 8),
    );
  });
  sections.forEach(({ offset, size: length }, index) => {
    const at = size + index * sectionHeaderSize;
    file.writeUInt32LE(progBits, at + 4);
    file.writeBigUInt64LE(BigInt(offset), at + 24);
    file.writeBigUInt64LE(BigInt(length), at + 32);
    file.fill(index + 1, offset, offset + length);
  });
  return file;
}

test("drops the pages at the end of a read-only segment that no section covers", async () => {
  const original = createElf(
    [
      { flags: mayRead, offset: 0, address: 0, size: 4 * pageSize - 0x80 },
      { flags: mayRead | mayExecute, offset: 4 * pageSize, address: 4 * pageSize, size: 0x500 },
    ],
    [
      { offset: 0x200, size: 0x100 },
      { offset: 4 * pageSize, size: 0x500 },
    ],
    5 * pageSize,
  );
  using dir = tempDir("close-elf-gaps", { "program": original });
  const path = join(String(dir), "program");
  await using proc = Bun.spawn({ cmd: [bunExe(), script, path], env: bunEnv, stderr: "pipe" });
  expect({ stderr: await proc.stderr.text(), exitCode: await proc.exited }).toEqual({ stderr: "", exitCode: 0 });

  const expected = createElf(
    [
      { flags: mayRead, offset: 0, address: 0, size: 0x300 },
      { flags: mayRead | mayExecute, offset: pageSize, address: 4 * pageSize, size: 0x500 },
    ],
    [
      { offset: 0x200, size: 0x100 },
      { offset: pageSize, size: 0x500 },
    ],
    2 * pageSize,
  );
  expect(readFileSync(path).equals(expected)).toBe(true);
});

test.each([true, false])("the strip rule runs it when hardened is %p", hardened => {
  using dir = tempDir("close-elf-gaps-rule", {});
  const buildDir = String(dir);
  const tool = (name: string) => "/fake/bin/" + name;
  const toolchain = {
    cc: tool("clang"),
    cxx: tool("clang++"),
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/lib/clang/23",
    ar: tool("llvm-ar"),
    ld: tool("ld.lld"),
    ld64Lld: tool("ld64.lld"),
    rustLlvmVersion: "23.1.1",
    strip: tool("strip"),
    llvmStrip: tool("llvm-strip"),
    nm: tool("llvm-nm"),
    readobj: tool("llvm-readobj"),
    objdump: tool("llvm-objdump"),
    cxxfilt: tool("llvm-cxxfilt"),
    dsymutil: tool("dsymutil"),
    bun: tool("bun"),
    jsRuntime: tool("bun"),
    esbuild: tool("esbuild"),
    cmake: tool("cmake"),
  } as Toolchain;
  const cfg = resolveConfig(
    {
      buildDir,
      buildType: "Release",
      os: "linux",
      arch: "x64",
      abi: "gnu",
      webkit: "local",
      linuxSysroot: buildDir,
      hardened,
    },
    toolchain,
  );
  const ninja = new Ninja({ buildDir });
  const exe = resolve(buildDir, "bun-profile");
  emitPostLink(ninja, cfg, exe, "bun-profile", [], [exe + ".o"]);
  const command = /^rule strip\n  command = (.*)$/m.exec(ninja.toString().replace(/ \$\n +/g, " "))![1];
  const [strip, ...afterwards] = command.split(" && ");
  expect(strip).toEndWith("strip $stripflags $in -o $out");
  expect(afterwards).toEqual(hardened ? [`/fake/bin/bun ${script} $out`] : []);
});
