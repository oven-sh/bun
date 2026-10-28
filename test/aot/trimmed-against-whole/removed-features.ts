import { readFileSync } from "node:fs";

const stateSize = 536;
const removalOffset = 24;
const removalCount = 512;
const stateSignature = Buffer.from("BUNFEAT\0", "latin1");
const loadCommandHeaderSize = 8;

const fits = (file: Buffer, offset: number, length: number) => offset + length <= file.length;

const startsWith = (file: Buffer, bytes: number[]) => file.subarray(0, bytes.length).equals(Buffer.from(bytes));

function textAt(file: Buffer, offset: number, end: number): string {
  const bytes = file.subarray(offset, end);
  const nul = bytes.indexOf(0);
  return bytes.toString("latin1", 0, nul < 0 ? bytes.length : nul);
}

function elfSectionOffset(file: Buffer): number | undefined {
  if (!fits(file, 0, 0x40)) return undefined;
  const table = Number(file.readBigUInt64LE(0x28));
  const count = file.readUInt16LE(0x3c);
  const namesIndex = file.readUInt16LE(0x3e);
  if (namesIndex >= count || !fits(file, table, count * 64)) return undefined;
  const names = Number(file.readBigUInt64LE(table + namesIndex * 64 + 0x18));
  for (let index = 0; index < count; index++) {
    const header = table + index * 64;
    if (textAt(file, names + file.readUInt32LE(header), file.length) === ".bun_features") return Number(file.readBigUInt64LE(header + 0x18));
  }
  return undefined;
}

function machOSectionOffset(file: Buffer): number | undefined {
  if (!fits(file, 0, 32)) return undefined;
  const commandCount = file.readUInt32LE(16);
  let command = 32;
  for (let commandIndex = 0; commandIndex < commandCount; commandIndex++) {
    if (!fits(file, command, loadCommandHeaderSize)) return undefined;
    const commandSize = file.readUInt32LE(command + 4);
    if (commandSize < loadCommandHeaderSize) return undefined;
    if (file.readUInt32LE(command) === 0x19) {
      if (!fits(file, command, 72)) return undefined;
      const sectionCount = file.readUInt32LE(command + 64);
      if (!fits(file, command + 72, sectionCount * 80)) return undefined;
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
        const section = command + 72 + sectionIndex * 80;
        if (textAt(file, section, section + 16) === "__bun_features" && textAt(file, section + 16, section + 32) === "__TEXT") return file.readUInt32LE(section + 48);
      }
    }
    command += commandSize;
  }
  return undefined;
}

function peSectionOffset(file: Buffer): number | undefined {
  if (!fits(file, 0, 0x40)) return undefined;
  const pe = file.readUInt32LE(0x3c);
  if (!fits(file, pe, 24)) return undefined;
  const count = file.readUInt16LE(pe + 6);
  const table = pe + 24 + file.readUInt16LE(pe + 20);
  if (!fits(file, table, count * 40)) return undefined;
  for (let index = 0; index < count; index++) {
    const header = table + index * 40;
    if (textAt(file, header, header + 8) === ".bunfeat") return file.readUInt32LE(header + 20);
  }
  return undefined;
}

function stateSectionOffset(file: Buffer): number | undefined {
  if (startsWith(file, [0x7f, 0x45, 0x4c, 0x46])) return elfSectionOffset(file);
  if (startsWith(file, [0xcf, 0xfa, 0xed, 0xfe])) return machOSectionOffset(file);
  if (startsWith(file, [0x4d, 0x5a])) return peSectionOffset(file);
  return undefined;
}

export function readRemovedFeatures(path: string): number[] | undefined {
  const file = readFileSync(path);
  const offset = stateSectionOffset(file);
  if (offset === undefined || !fits(file, offset, stateSize)) return undefined;
  if (!file.subarray(offset, offset + stateSignature.length).equals(stateSignature)) return undefined;
  const removal = file.subarray(offset + removalOffset, offset + removalOffset + removalCount);
  return [...removal.keys()].filter(index => removal[index] !== 0);
}
