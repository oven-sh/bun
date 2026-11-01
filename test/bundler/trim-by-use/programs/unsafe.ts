console.log(
  Bun.unsafe.arrayBufferToString(new Uint8Array([104, 105])),
  typeof Bun.unsafe.gcAggressionLevel(),
  typeof Bun.unsafe.mimallocDump,
);
