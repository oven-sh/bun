import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";

const C = zlib.constants;
const files = new Map();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { file, skip, size, count, quality, decodes, masks, rounds, budget } = JSON.parse(line);
  if (!files.has(file)) {
    const fd = fs.openSync(file);
    const bytes = Buffer.alloc(1 << 18);
    files.set(file, bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, skip)));
    fs.closeSync(fd);
  }
  const options = masks.map(mask => {
    const params = { [C.BROTLI_PARAM_QUALITY]: quality };
    if (mask !== null) params[C.BROTLI_PARAM_LGBLOCK] = 0x10000 | mask;
    return { params };
  });
  let parts = Array.from({ length: count }, (_, i) => files.get(file).subarray(i * size, (i + 1) * size));
  if (decodes) parts = parts.map(part => zlib.brotliCompressSync(part, options[0]));
  const sums = decodes ? [] : options.map(each => zlib.crc32(zlib.brotliCompressSync(parts[0], each)));
  const best = masks.map(() => Infinity);
  for (let round = 0; round < rounds; round++) {
    for (let step = 0; step < masks.length; step++) {
      const i = (step + round) % masks.length;
      const start = performance.now();
      let runs = 0;
      do {
        const before = performance.now();
        if (decodes) for (const part of parts) zlib.brotliDecompressSync(part);
        else for (const part of parts) zlib.brotliCompressSync(part, options[i]);
        best[i] = Math.min(best[i], performance.now() - before);
      } while (++runs < 2 || performance.now() - start < budget);
    }
  }
  fs.writeSync(1, JSON.stringify(best.map((time, i) => (sums[i] === sums[0] ? time : -time))) + "\n");
}
