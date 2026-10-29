// Temporary measurement helper, removed before this change is ready.
// Reads the sections, the export table and the exception table (.pdata) of a PE32+ file, x64 or arm64.
import { preadExact } from "harness";
import { closeSync, openSync, statSync } from "node:fs";

const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;

export type PeFunction = { name: string; rva: number; length: number | null; hex: string };

export function readPe(path: string, exportedNames: string[]) {
  const fd = openSync(path, "r");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const peOff = dos.readUInt32LE(60);
    if (preadExact(fd, peOff, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");
    const coff = preadExact(fd, peOff + 4, 20);
    const machine = coff.readUInt16LE(0);
    const numberOfSections = coff.readUInt16LE(2);
    const sizeOfOptionalHeader = coff.readUInt16LE(16);
    const optional = preadExact(fd, peOff + 24, sizeOfOptionalHeader);
    if (optional.readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
    const directory = (index: number) => ({
      rva: optional.readUInt32LE(112 + index * 8),
      size: optional.readUInt32LE(116 + index * 8),
    });

    const table = preadExact(fd, peOff + 24 + sizeOfOptionalHeader, numberOfSections * 40);
    const sections = Array.from({ length: numberOfSections }, (_, i) => {
      const header = table.subarray(i * 40, i * 40 + 40);
      return {
        name: header.subarray(0, 8).toString("latin1").replace(/\0+$/, ""),
        virtualSize: header.readUInt32LE(8),
        virtualAddress: header.readUInt32LE(12),
        rawSize: header.readUInt32LE(16),
        rawPointer: header.readUInt32LE(20),
      };
    });
    /** Bytes of the image at `rva`, as far as the file has them. */
    const read = (rva: number, length: number) => {
      const section = sections.find(s => rva >= s.virtualAddress && rva < s.virtualAddress + s.rawSize);
      if (!section) throw new Error(`rva 0x${rva.toString(16)} is in no section`);
      const available = section.virtualAddress + section.rawSize - rva;
      return preadExact(fd, rva - section.virtualAddress + section.rawPointer, Math.min(length, available));
    };

    // Export directory: the addresses of the functions that have a name.
    const exportDirectory = directory(0);
    const exportData = read(exportDirectory.rva, exportDirectory.size);
    const inExports = (rva: number) => rva - exportDirectory.rva;
    const numberOfNames = exportData.readUInt32LE(24);
    const addressOfFunctions = inExports(exportData.readUInt32LE(28));
    const addressOfNames = inExports(exportData.readUInt32LE(32));
    const addressOfNameOrdinals = inExports(exportData.readUInt32LE(36));
    const exported = new Map<string, number>();
    for (let i = 0; i < numberOfNames; i++) {
      const nameAt = inExports(exportData.readUInt32LE(addressOfNames + i * 4));
      const name = exportData.subarray(nameAt, exportData.indexOf(0, nameAt)).toString("latin1");
      const ordinal = exportData.readUInt16LE(addressOfNameOrdinals + i * 2);
      exported.set(name, exportData.readUInt32LE(addressOfFunctions + ordinal * 4));
    }

    // Exception table: one entry for each function that has unwind data, sorted by address.
    const exceptionDirectory = directory(3);
    const pdata = read(exceptionDirectory.rva, exceptionDirectory.size);
    const entrySize = machine === IMAGE_FILE_MACHINE_AMD64 ? 12 : 8;
    const entries = pdata.length / entrySize;
    let xdata: { rva: number; bytes: Buffer } | undefined;
    const lengthOfEntry = (i: number): number => {
      const begin = pdata.readUInt32LE(i * entrySize);
      if (machine === IMAGE_FILE_MACHINE_AMD64) return pdata.readUInt32LE(i * entrySize + 4) - begin;
      if (machine !== IMAGE_FILE_MACHINE_ARM64) throw new Error(`machine 0x${machine.toString(16)}`);
      const unwind = pdata.readUInt32LE(i * entrySize + 4);
      // Packed unwind data has the function length in bits 2 to 12, in instructions.
      if (unwind & 3) return ((unwind >>> 2) & 0x7ff) * 4;
      // Otherwise it is the address of an .xdata record whose first word has the length in bits 0 to 17.
      if (!xdata || unwind < xdata.rva || unwind + 4 > xdata.rva + xdata.bytes.length) {
        const section = sections.find(s => unwind >= s.virtualAddress && unwind < s.virtualAddress + s.rawSize)!;
        xdata = { rva: section.virtualAddress, bytes: read(section.virtualAddress, section.rawSize) };
      }
      return (xdata.bytes.readUInt32LE(unwind - xdata.rva) & 0x3ffff) * 4;
    };
    let codeBytes = 0;
    const byAddress = new Map<number, number>();
    for (let i = 0; i < entries; i++) {
      const begin = pdata.readUInt32LE(i * entrySize);
      if (begin === 0) continue;
      const length = lengthOfEntry(i);
      codeBytes += length;
      if (!byAddress.has(begin)) byAddress.set(begin, length);
    }

    const functions: PeFunction[] = [];
    for (const name of exportedNames) {
      const rva = exported.get(name);
      if (rva === undefined) {
        functions.push({ name, rva: 0, length: null, hex: "not exported" });
        continue;
      }
      const length = byAddress.get(rva) ?? null;
      // A function with no unwind data has no length here: take 256 bytes and find its end in the disassembly.
      functions.push({ name, rva, length, hex: read(rva, length ?? 256).toString("hex") });
    }

    return {
      machine: machine === IMAGE_FILE_MACHINE_AMD64 ? "x64" : machine === IMAGE_FILE_MACHINE_ARM64 ? "arm64" : machine,
      fileBytes: statSync(path).size,
      sections: sections.map(({ name, virtualSize, rawSize }) => ({ name, virtualSize, rawSize })),
      exportedNames: exported.size,
      unwindEntries: entries,
      codeBytesWithUnwindData: codeBytes,
      functions,
    };
  } finally {
    closeSync(fd);
  }
}
