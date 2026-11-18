// Stand-ins for the `bun` of another platform, for `--compile-executable-path`.

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;

// Not page-aligned on purpose, so the last hashed page is partial.
const TEMPLATE_SIG_OFF = 0x8100;

// Larger than the ad-hoc signature, so a missing truncate leaves a stale tail.
const TEMPLATE_SIG_SIZE = 0x2000;

// Minimal arm64 Mach-O: __TEXT, __BUN with one __bun section, __LINKEDIT ending in LC_CODE_SIGNATURE.
export function machoTemplate(): Buffer {
  const fileSize = TEMPLATE_SIG_OFF + TEMPLATE_SIG_SIZE;
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const sigCmdSize = 16; // sizeof(linkedit_data_command)
  const sizeofcmds = segCmdSize + (segCmdSize + sectSize) + segCmdSize + sigCmdSize;

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

  // LC_SEGMENT_64 __TEXT [0, 0x4000)
  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__TEXT");
  buf.writeBigUInt64LE(0x1_0000_0000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(5, o + 56); // maxprot r-x
  buf.writeInt32LE(5, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_SEGMENT_64 __BUN [0x4000, 0x8000) with one __bun section
  o += segCmdSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize + sectSize, o + 4);
  writeName(o + 8, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x4000n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(3, o + 56); // maxprot rw-
  buf.writeInt32LE(3, o + 60); // initprot
  buf.writeUInt32LE(1, o + 64); // nsects

  // section_64 __bun
  o += segCmdSize;
  writeName(o, "__bun");
  writeName(o + 16, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 32); // addr
  buf.writeBigUInt64LE(0x4000n, o + 40); // size
  buf.writeUInt32LE(0x4000, o + 48); // offset
  buf.writeUInt32LE(14, o + 52); // align = 2^14

  // LC_SEGMENT_64 __LINKEDIT [0x8000, fileSize)
  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0000_8000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x3000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x8000n, o + 40); // fileoff
  buf.writeBigUInt64LE(BigInt(fileSize - 0x8000), o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot r--
  buf.writeInt32LE(1, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_CODE_SIGNATURE (linkedit_data_command)
  o += segCmdSize;
  buf.writeUInt32LE(LC_CODE_SIGNATURE, o);
  buf.writeUInt32LE(sigCmdSize, o + 4);
  buf.writeUInt32LE(TEMPLATE_SIG_OFF, o + 8); // dataoff
  buf.writeUInt32LE(TEMPLATE_SIG_SIZE, o + 12); // datasize

  return buf;
}

// Build a minimal PE32+ image with one .text section and an optional Authenticode
// overlay past it. Large enough that the correct CheckSum exceeds 0xffff.
export function minimalPE64Template(certSize = 0): Buffer {
  const fileAlign = 512;
  const sectAlign = 4096;
  const peOff = 64;
  const optOff = peOff + 24;
  const optSize = 240;
  const shOff = optOff + optSize;
  const textRaw = 512;
  const textRawSize = 128 * 1024;
  const textVA = sectAlign;
  const lastRawEnd = textRaw + textRawSize;

  const tmpl = Buffer.alloc(lastRawEnd + certSize);
  // DOS header
  tmpl.writeUInt16LE(0x5a4d, 0); // "MZ"
  tmpl.writeUInt32LE(peOff, 0x3c); // e_lfanew
  // COFF header
  tmpl.writeUInt32LE(0x00004550, peOff); // "PE\0\0"
  tmpl.writeUInt16LE(0x8664, peOff + 4); // machine = AMD64
  tmpl.writeUInt16LE(1, peOff + 6); // NumberOfSections
  tmpl.writeUInt16LE(optSize, peOff + 20); // SizeOfOptionalHeader
  tmpl.writeUInt16LE(0x0022, peOff + 22); // Characteristics
  // Optional header (PE32+)
  tmpl.writeUInt16LE(0x020b, optOff); // Magic
  tmpl.writeUInt32LE(textVA, optOff + 16); // AddressOfEntryPoint
  tmpl.writeUInt32LE(textVA, optOff + 20); // BaseOfCode
  tmpl.writeBigUInt64LE(0x140000000n, optOff + 24); // ImageBase
  tmpl.writeUInt32LE(sectAlign, optOff + 32); // SectionAlignment
  tmpl.writeUInt32LE(fileAlign, optOff + 36); // FileAlignment
  tmpl.writeUInt16LE(6, optOff + 40); // MajorOSVersion
  tmpl.writeUInt16LE(6, optOff + 48); // MajorSubsystemVersion
  tmpl.writeUInt32LE(textVA + sectAlign, optOff + 56); // SizeOfImage
  tmpl.writeUInt32LE(512, optOff + 60); // SizeOfHeaders
  tmpl.writeUInt16LE(3, optOff + 68); // Subsystem = CUI
  tmpl.writeUInt32LE(16, optOff + 108); // NumberOfRvaAndSizes
  if (certSize > 0) {
    // Security directory (index 4): VirtualAddress is a file offset for this entry.
    const secDir = optOff + 112 + 4 * 8;
    tmpl.writeUInt32LE(lastRawEnd, secDir);
    tmpl.writeUInt32LE(certSize, secDir + 4);
  }
  // Section header: .text
  tmpl.write(".text\0\0\0", shOff, 8, "latin1");
  tmpl.writeUInt32LE(textRawSize, shOff + 8); // VirtualSize
  tmpl.writeUInt32LE(textVA, shOff + 12); // VirtualAddress
  tmpl.writeUInt32LE(textRawSize, shOff + 16); // SizeOfRawData
  tmpl.writeUInt32LE(textRaw, shOff + 20); // PointerToRawData
  tmpl.writeUInt32LE(0x60000020, shOff + 36); // Characteristics
  tmpl.fill(0xcc, textRaw, lastRawEnd); // .text body
  if (certSize > 0) tmpl.fill(0xab, lastRawEnd); // cert overlay marker
  return tmpl;
}
