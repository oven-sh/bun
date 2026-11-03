export function packageOf(items: [name: string, size: number][], headerSize = 32): Buffer {
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(headerSize, 0);
  header.writeUInt16BE(0xda27, 2);
  header.write("CmnD\x01", 12, "latin1");
  const names = items.map(([name]) => Buffer.from(name + "\0", "latin1"));
  const entries = Buffer.alloc(4 + items.length * 8);
  entries.writeUInt32LE(items.length, 0);
  let at = entries.length;
  names.forEach((name, index) => {
    entries.writeUInt32LE(at, 4 + index * 8);
    at += name.length;
  });
  const bodies = items.map(([, size], index) => {
    const padding = (16 - (at % 16)) % 16;
    entries.writeUInt32LE(at + padding, 8 + index * 8);
    at += padding + size;
    return Buffer.alloc(padding + size, 0xaa);
  });
  return Buffer.concat([header, entries, ...names, ...bodies]);
}
