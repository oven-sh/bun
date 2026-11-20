import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";

function crc32(buf: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
// RGBA8 PNG from a flat RGBA array.
function png(w: number, h: number, rgba: number[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) rows.set(rgba.slice(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// 2x1: pure red, pure white.
const fixture = () => png(2, 1, [255, 0, 0, 255, 255, 255, 255, 255]);

describe("Bun.Image raw()", () => {
  test("RGBA is the default", async () => {
    const img = new Bun.Image(fixture());
    const px = await img.raw();
    expect(Array.from(px)).toEqual([255, 0, 0, 255, 255, 255, 255, 255]);
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
  });

  test("channels: 3 drops alpha", async () => {
    const px = await new Bun.Image(fixture()).raw({ channels: 3 });
    expect(Array.from(px)).toEqual([255, 0, 0, 255, 255, 255]);
  });

  test("channels: 1 is BT.709 luma, one byte per pixel", async () => {
    const px = await new Bun.Image(fixture()).raw({ channels: 1 });
    expect(px).toBeInstanceOf(Uint8Array);
    expect(Array.from(px)).toEqual([54, 255]);
  });

  test("runs the pipeline first", async () => {
    const img = new Bun.Image(fixture()).flop();
    expect(Array.from(await img.raw({ channels: 1 }))).toEqual([255, 54]);
  });

  test("resize sets the output length", async () => {
    const big = png(4, 4, Array.from({ length: 16 }, () => [10, 20, 30, 255]).flat());
    const px = await new Bun.Image(big).resize(2, 2).raw({ channels: 1 });
    expect(px.length).toBe(4);
  });

  test("rejects other channel counts", () => {
    expect(() => new Bun.Image(fixture()).raw({ channels: 2 as any })).toThrow(/channels must be 1, 3 or 4/);
  });
});
