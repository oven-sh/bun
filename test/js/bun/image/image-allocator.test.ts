import { dlopen } from "bun:ffi";
import { afterAll, expect, test } from "bun:test";
import { isASAN, isMacOS } from "harness";

// 24-bit BMP of noise: it needs no checksum to write, and as a PNG it stays about as large as its pixels.
function makeNoiseBmp(width: number, height: number): Uint8Array {
  const pixelBytes = width * 3 * height;
  const bmp = new Uint8Array(54 + pixelBytes);
  const header = new DataView(bmp.buffer);
  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  header.setUint32(2, bmp.length, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, width, true);
  header.setInt32(22, height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, pixelBytes, true);
  let state = 0x9e3779b9;
  for (let i = 54; i < bmp.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bmp[i] = state >>> 24;
  }
  return bmp;
}

const originalBackend = Bun.Image.backend;
afterAll(() => {
  Bun.Image.backend = originalBackend;
});

test.skipIf(!isMacOS || isASAN)("an encoded PNG is not held by the system allocator", async () => {
  // The bundled codecs only: ImageIO allocates as it likes.
  Bun.Image.backend = "bun";

  const libSystem = dlopen("/usr/lib/libSystem.B.dylib", {
    malloc_zone_statistics: { args: ["ptr", "ptr"], returns: "void" },
  });
  // malloc_statistics_t { unsigned blocks_in_use; size_t size_in_use, max_size_in_use, size_allocated; }
  const statistics = new BigUint64Array(4);
  const systemBytesInUse = () => {
    libSystem.symbols.malloc_zone_statistics(null, statistics);
    return Number(statistics[1]);
  };

  // Whatever the first image loads or starts stays out of the measurement.
  await new Bun.Image(makeNoiseBmp(8, 8)).png().bytes();

  const bmp = makeNoiseBmp(1024, 1024);
  const before = systemBytesInUse();
  const png = await new Bun.Image(bmp).png().bytes();
  const after = systemBytesInUse();

  expect(png.byteLength).toBeGreaterThan(2 * 1024 * 1024);
  expect(after - before).toBeLessThan(1024 * 1024);
});
