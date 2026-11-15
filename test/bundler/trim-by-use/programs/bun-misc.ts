console.log(
  Bun.stripANSI("\x1b[31mred\x1b[0m"),
  typeof Bun.which("sh"),
  Bun.indexOfLine(new Uint8Array([97, 10, 98]), 0),
  Bun.allocUnsafe(4).length,
  Bun.nanoseconds() > 0,
  Bun.peek(Promise.resolve(5)),
  Bun.peek.status(Promise.resolve(1)),
  Bun.concatArrayBuffers([new Uint8Array([1]), new Uint8Array([2])]).byteLength,
);
Bun.sleepSync(1);
await Bun.sleep(1);
Bun.gc(true);
Bun.shrink();
console.log("slept");
